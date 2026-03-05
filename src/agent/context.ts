import { eq, and, isNull } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { conversations, agents, tasks, projects, knowledgeEntities, knowledgeRelations, memoryBlocks } from "../db/schema.js";
import { getProvider } from "../llm/registry.js";
import { estimateMessagesTokens } from "../llm/token-counter.js";
import { buildSystemPrompt } from "../core/soul.js";
import { createChildLogger } from "../utils/logger.js";
import type { ConversationMessage } from "../db/schema.js";
import type { LLMMessage, LLMContentBlock } from "../core/types.js";

const EXTRACTION_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  huggingface: "Qwen/Qwen2.5-72B-Instruct",
};

const log = createChildLogger("context-manager");

const COMPACTION_THRESHOLD = 0.4; // Compact at 40% of budget — keeps agents under ~60K tokens

export interface ContextBuildResult {
  messages: LLMMessage[];
  systemPrompt: string;
  tokenEstimate: number;
  wasCompacted: boolean;
}

/**
 * Build the full context for an agent turn.
 * If token count exceeds budget threshold, compact first.
 */
export async function buildContext(
  agentId: string,
  soul: { name: string; purpose: string; intent?: string | null; goals?: string[]; personality: string | null; constraints: string | null; capabilities: string[] },
  contextBudget: number,
): Promise<ContextBuildResult> {
  const db = getDb();

  // Get active conversation
  const [activeConv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.agentId, agentId), eq(conversations.isActive, true)))
    .limit(1);

  if (!activeConv) {
    throw new Error(`No active conversation for agent ${agentId}`);
  }

  // Load project if agent belongs to one
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  let project = null;
  if (agent?.projectId) {
    const [p] = await db.select().from(projects).where(eq(projects.id, agent.projectId)).limit(1);
    project = p ?? null;
  }

  let systemPrompt = buildSystemPrompt(soul, project);
  let convMessages = activeConv.messages as ConversationMessage[];
  let wasCompacted = false;

  // Repair orphaned tool blocks — run iteratively until stable since
  // fixing one case (e.g. dropping orphaned tool_results) can expose another
  // (e.g. the tool_use that was paired with the dropped tool_result is now orphaned too)
  let totalRepairs = 0;
  for (let pass = 0; pass < 5; pass++) {
    const repaired = repairOrphanedToolUse(convMessages);
    if (!repaired.wasRepaired) break;
    convMessages = repaired.messages;
    totalRepairs += repaired.repairCount;
  }
  if (totalRepairs > 0) {
    await db
      .update(conversations)
      .set({ messages: convMessages, updatedAt: new Date() })
      .where(eq(conversations.id, activeConv.id));
    log.warn({ agentId, repairCount: totalRepairs }, "Repaired orphaned tool blocks in conversation DB");
  }

  // Check if we need compaction
  const llmMessages = conversationToLLM(convMessages);
  const tokenEstimate = estimateMessagesTokens(llmMessages) + estimateMessagesTokens([{ role: "system", content: systemPrompt }]);

  if (tokenEstimate > contextBudget * COMPACTION_THRESHOLD) {
    log.info({ agentId, tokenEstimate, budget: contextBudget }, "Compacting conversation");
    convMessages = await compactConversation(agentId, activeConv.id, convMessages, soul, contextBudget);
    wasCompacted = true;

    // Re-run repair after compaction — compaction can orphan tool_result blocks
    // when the corresponding tool_use was in the summarized portion
    let postCompactRepairs = 0;
    for (let pass = 0; pass < 5; pass++) {
      const repaired = repairOrphanedToolUse(convMessages);
      if (!repaired.wasRepaired) break;
      convMessages = repaired.messages;
      postCompactRepairs += repaired.repairCount;
    }
    if (postCompactRepairs > 0) {
      // Persist the repaired post-compaction messages
      const [newConv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.agentId, agentId), eq(conversations.isActive, true)))
        .limit(1);
      if (newConv) {
        await db
          .update(conversations)
          .set({ messages: convMessages, updatedAt: new Date() })
          .where(eq(conversations.id, newConv.id));
      }
      log.warn({ agentId, repairCount: postCompactRepairs }, "Repaired orphaned tool blocks after compaction");
    }
  }

  // ── Inject core memory blocks into system prompt ──
  let blocks = await db
    .select()
    .from(memoryBlocks)
    .where(eq(memoryBlocks.agentId, agentId))
    .orderBy(memoryBlocks.label);

  // Backfill: if agent has 0 blocks (existing agent), create defaults on the fly
  if (blocks.length === 0) {
    const agentName = agent?.name ?? "Agent";
    const defaultBlocks = [
      {
        label: "persona",
        description: "Your self-understanding — who you are, your role, your approach to work. Update as you learn about yourself.",
        value: `I am ${agentName}.`,
        charLimit: 2000,
      },
      {
        label: "learned_preferences",
        description: "User and project preferences you've discovered. Coding style, communication preferences, tool choices, naming conventions.",
        value: "",
        charLimit: 2000,
      },
      {
        label: "working_context",
        description: "Your current work state — what you're doing now, what's pending, blockers. Update frequently. This is your scratchpad.",
        value: "",
        charLimit: 3000,
      },
      {
        label: "domain_knowledge",
        description: "Key facts about your domain — architecture decisions, system behavior, important patterns. Distilled from experience.",
        value: "",
        charLimit: 3000,
      },
    ];
    await db.insert(memoryBlocks).values(
      defaultBlocks.map((b) => ({ ...b, agentId })),
    );
    blocks = await db
      .select()
      .from(memoryBlocks)
      .where(eq(memoryBlocks.agentId, agentId))
      .orderBy(memoryBlocks.label);
  }

  if (blocks.length > 0) {
    const blockSection = [
      "",
      "## Core Memory Blocks",
      "These are YOUR persistent memory blocks. You can update them with update_memory_block.",
      "They survive context compaction and are always available to you.",
      "",
    ];
    for (const block of blocks) {
      blockSection.push(`### ${block.label}`);
      blockSection.push(`*${block.description}*`);
      if (block.value) {
        blockSection.push(block.value);
      } else {
        blockSection.push("*(empty — write to this block as you learn)*");
      }
      blockSection.push(`[${block.value.length}/${block.charLimit} chars]`);
      blockSection.push("");
    }
    systemPrompt += "\n" + blockSection.join("\n");
  }

  const finalMessages = conversationToLLM(convMessages);
  const finalEstimate = estimateMessagesTokens(finalMessages) + estimateMessagesTokens([{ role: "system", content: systemPrompt }]);

  return {
    messages: finalMessages,
    systemPrompt,
    tokenEstimate: finalEstimate,
    wasCompacted,
  };
}

/**
 * Compact a conversation using incremental rolling summary.
 * Instead of summarizing the ENTIRE conversation, we:
 * 1. Take the existing rolling summary + oldest unsummarized messages
 * 2. Send only those to the LLM for summary update
 * 3. Keep recent messages that fit within 25% of context budget
 * This makes the summarization LLM call much cheaper.
 */
const MIN_KEEP_MESSAGES = 2;  // Always keep at least 2 messages
const MAX_KEEP_MESSAGES = 10; // Never keep more than 10
const KEEP_TOKEN_RATIO = 0.25; // Keep messages that fit in 25% of budget

async function compactConversation(
  agentId: string,
  conversationId: string,
  messages: ConversationMessage[],
  soul: { name: string; purpose: string; personality: string | null; constraints: string | null; capabilities: string[] },
  contextBudget: number,
): Promise<ConversationMessage[]> {
  const db = getDb();

  // Get the agent to find its provider/model
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const provider = getProvider(agent.provider ?? "anthropic");

  // Load existing rolling summary from the conversation record
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  const existingSummary = conv?.summary ?? null;

  // Determine how many recent messages to keep based on token budget.
  // Walk backwards from the end, accumulating tokens until we hit 25% of budget.
  const keepBudget = contextBudget * KEEP_TOKEN_RATIO;
  let keepCount = 0;
  let keepTokens = 0;
  for (let i = messages.length - 1; i >= 0 && keepCount < MAX_KEEP_MESSAGES; i--) {
    const msgTokens = estimateMessagesTokens(conversationToLLM([messages[i]!]));
    if (keepTokens + msgTokens > keepBudget && keepCount >= MIN_KEEP_MESSAGES) {
      break; // Adding this message would exceed our keep budget
    }
    keepTokens += msgTokens;
    keepCount++;
  }
  keepCount = Math.max(keepCount, MIN_KEEP_MESSAGES);

  const toSummarize = messages.length > keepCount
    ? messages.slice(0, -keepCount)
    : [];
  const toKeep = messages.length > keepCount
    ? messages.slice(-keepCount)
    : messages;

  // If nothing to summarize, just return as-is
  if (toSummarize.length === 0) {
    return messages;
  }

  log.info({ agentId, totalMessages: messages.length, keepCount, keepTokens, keepBudget }, "Compaction: keeping recent messages within token budget");

  // ── Pre-compaction knowledge extraction ──
  await extractKnowledgeBeforeCompaction(agentId, agent.name, toSummarize, agent.provider ?? "anthropic");

  // Build the summarization prompt — only the new messages + existing summary
  const serializedNew = toSummarize
    .map((m) => `[${m.role}]: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
    .join("\n\n");

  const summaryPrompt = existingSummary
    ? `Current rolling summary:\n${existingSummary}\n\nNew messages to incorporate:\n${serializedNew}\n\nUpdate the summary to include the new information. Keep it concise but preserve all key decisions, context, and pending work.`
    : `Summarize this conversation concisely, preserving all important context, decisions, and pending work:\n\n${serializedNew}`;

  const summaryResponse = await provider.chat(
    [{ role: "user", content: summaryPrompt }],
    {
      model: agent.model ?? "claude-sonnet-4-5",
      maxTokens: 2000,
      systemPrompt: "You are a conversation summarizer. Produce a concise but complete rolling summary.",
    },
  );

  const summaryText = summaryResponse.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Mark old conversation as inactive
  await db
    .update(conversations)
    .set({
      isActive: false,
      summary: summaryText,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  // Build new conversation with summary + recent messages
  const newMessages: ConversationMessage[] = [
    {
      role: "user",
      content: `[CONTEXT RECOVERY] ${summaryText}`,
      timestamp: new Date().toISOString(),
    },
    {
      role: "assistant",
      content: "Context recovered. Continuing.",
      timestamp: new Date().toISOString(),
    },
    ...toKeep,
  ];

  await db.insert(conversations).values({
    agentId,
    isActive: true,
    messages: newMessages,
    summary: summaryText, // Store rolling summary for next incremental compaction
    tokenCount: estimateMessagesTokens(conversationToLLM(newMessages)),
  });

  log.info(
    { agentId, oldMessages: messages.length, keptMessages: toKeep.length, summarized: toSummarize.length, summaryLength: summaryText.length },
    "Conversation compacted (rolling summary)",
  );
  return newMessages;
}

/**
 * Try to extract a JSON array from model output that may contain extra text,
 * markdown fences, thinking blocks, etc. Returns null if no valid array found.
 */
function extractJsonArray(text: string): unknown[] | null {
  // Strategy 1: Direct parse (model followed instructions perfectly)
  const trimmed = text.trim();
  try {
    const result = JSON.parse(trimmed);
    if (Array.isArray(result)) return result;
  } catch { /* continue */ }

  // Strategy 2: Strip markdown code fences
  const fenceStripped = trimmed.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  try {
    const result = JSON.parse(fenceStripped);
    if (Array.isArray(result)) return result;
  } catch { /* continue */ }

  // Strategy 3: Find the first `[` ... last `]` substring (handles surrounding text/thinking)
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      const result = JSON.parse(text.substring(firstBracket, lastBracket + 1));
      if (Array.isArray(result)) return result;
    } catch { /* continue */ }
  }

  return null;
}

/**
 * Extract structured knowledge from messages about to be compacted.
 * Uses a cheap model to identify entities worth preserving in the KG.
 * Non-fatal — if extraction fails, compaction proceeds normally.
 */
async function extractKnowledgeBeforeCompaction(
  agentId: string,
  agentName: string,
  toSummarize: ConversationMessage[],
  providerName: string,
): Promise<void> {
  try {
    const db = getDb();

    // Serialize messages, cap at 12000 chars (~3000 tokens)
    const serialized = toSummarize
      .map((m) => `[${m.role}]: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
      .join("\n\n")
      .substring(0, 12000);

    const extractionModel = EXTRACTION_MODELS[providerName] ?? EXTRACTION_MODELS.anthropic!;
    const provider = getProvider(providerName);

    const response = await provider.chat(
      [{
        role: "user",
        content: `Extract structured knowledge from this conversation that would be valuable to remember long-term. Focus on decisions made, lessons learned, important facts discovered, and key concepts.

Return a JSON array of entities (max 10). Each entity should have:
- name: canonical kebab-case name (e.g. "auth-uses-jwt", "redis-cache-decision")
- entity_type: one of "decision", "lesson", "research", "concept", "preference", "system"
- content: prose description of what was learned (1-3 sentences)
- confidence: 0-100 how certain this knowledge is
- relations: optional array of {target: "entity-name", relation_type: "relates_to|caused_by|depends_on|led_to|supports|implements"}

Only extract genuinely useful knowledge. If there's nothing worth extracting, return an empty array [].

Conversation:
${serialized}

Respond with ONLY the JSON array, no other text.`,
      }],
      {
        model: extractionModel,
        maxTokens: 1000,
        systemPrompt: "You extract structured knowledge from conversations. Respond only with valid JSON arrays.",
      },
    );

    const responseText = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Parse JSON — HF models often wrap output in markdown fences, extra text, or thinking.
    // Try progressively more aggressive extraction strategies.
    let entities: Array<{
      name: string;
      entity_type: string;
      content: string;
      confidence?: number;
      relations?: Array<{ target: string; relation_type: string }>;
    }>;

    const parsed = extractJsonArray(responseText) as typeof entities | null;
    if (!parsed) {
      log.warn({ agentId, agentName, responseSnippet: responseText.substring(0, 200) }, "Pre-compaction extraction returned invalid JSON, skipping");
      return;
    }
    entities = parsed;

    if (!Array.isArray(entities) || entities.length === 0) return;

    // Cap at 10 entities
    entities = entities.slice(0, 10);

    // Get agent's projectId
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    const projectId = agent?.projectId ?? null;

    for (const entity of entities) {
      if (!entity.name || !entity.entity_type || !entity.content) continue;

      // Validate entity_type
      const validTypes = ["project", "decision", "research", "lesson", "preference", "person", "system", "concept"];
      if (!validTypes.includes(entity.entity_type)) continue;

      // Upsert entity by name + agentId + projectId
      const nameConditions = [
        eq(knowledgeEntities.name, entity.name),
        eq(knowledgeEntities.agentId, agentId),
      ];
      if (projectId) {
        nameConditions.push(eq(knowledgeEntities.projectId, projectId));
      } else {
        nameConditions.push(isNull(knowledgeEntities.projectId));
      }

      const [existing] = await db
        .select()
        .from(knowledgeEntities)
        .where(and(...nameConditions))
        .limit(1);

      let entityId: string;

      if (existing) {
        await db
          .update(knowledgeEntities)
          .set({
            entityType: entity.entity_type as any,
            content: entity.content,
            confidence: entity.confidence ?? existing.confidence,
            tags: ["auto-extracted", "compaction"],
            metadata: { source: "pre-compaction-extraction" },
            updatedAt: new Date(),
          })
          .where(eq(knowledgeEntities.id, existing.id));
        entityId = existing.id;
      } else {
        const [inserted] = await db
          .insert(knowledgeEntities)
          .values({
            name: entity.name,
            entityType: entity.entity_type as any,
            content: entity.content,
            agentId,
            projectId,
            confidence: entity.confidence ?? 80,
            tags: ["auto-extracted", "compaction"],
            metadata: { source: "pre-compaction-extraction" },
          })
          .returning();
        entityId = inserted!.id;
      }

      // Create relations where targets exist
      if (entity.relations && Array.isArray(entity.relations)) {
        for (const rel of entity.relations) {
          if (!rel.target || !rel.relation_type) continue;

          const targetConditions = [eq(knowledgeEntities.name, rel.target)];
          if (projectId) {
            targetConditions.push(
              eq(knowledgeEntities.projectId, projectId),
            );
          }

          const [targetEntity] = await db
            .select()
            .from(knowledgeEntities)
            .where(and(...targetConditions))
            .limit(1);

          if (!targetEntity) continue; // skip missing targets

          // Upsert relation
          const [existingRel] = await db
            .select()
            .from(knowledgeRelations)
            .where(and(
              eq(knowledgeRelations.sourceEntityId, entityId),
              eq(knowledgeRelations.targetEntityId, targetEntity.id),
              eq(knowledgeRelations.relationType, rel.relation_type),
              eq(knowledgeRelations.agentId, agentId),
            ))
            .limit(1);

          if (!existingRel) {
            await db.insert(knowledgeRelations).values({
              sourceEntityId: entityId,
              targetEntityId: targetEntity.id,
              relationType: rel.relation_type,
              strength: 50,
              context: "auto-extracted during compaction",
              agentId,
            });
          }
        }
      }
    }

    log.info({ agentId, agentName, entitiesExtracted: entities.length }, "Pre-compaction knowledge extraction complete");
  } catch (error) {
    // Non-fatal — compaction proceeds normally
    log.warn({ agentId, agentName, error }, "Pre-compaction knowledge extraction failed, continuing with compaction");
  }
}

/**
 * Append a message to the active conversation.
 */
export async function appendToConversation(
  agentId: string,
  message: ConversationMessage,
): Promise<void> {
  const db = getDb();

  const [activeConv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.agentId, agentId), eq(conversations.isActive, true)))
    .limit(1);

  if (!activeConv) {
    throw new Error(`No active conversation for agent ${agentId}`);
  }

  const updatedMessages = [...(activeConv.messages as ConversationMessage[]), message];
  const tokenCount = estimateMessagesTokens(conversationToLLM(updatedMessages));

  await db
    .update(conversations)
    .set({
      messages: updatedMessages,
      tokenCount,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, activeConv.id));
}

/**
 * Repair conversation messages to fix two classes of tool-call corruption:
 *
 * Case A — Orphaned tool_use: assistant has tool_use blocks but the next message
 *   is missing the corresponding tool_result → inject synthetic error results.
 *
 * Case B — Orphaned tool_result: user message has tool_result blocks whose
 *   tool_use_id doesn't match any tool_use in the previous assistant message
 *   → strip the orphaned tool_result blocks (or the entire message if all are orphaned).
 *
 * Both cases cause Anthropic 400 errors and must be repaired before sending to the API.
 */
function repairOrphanedToolUse(messages: ConversationMessage[]): {
  messages: ConversationMessage[];
  wasRepaired: boolean;
  repairCount: number;
} {
  const filtered = messages.filter((m) => m.role !== "tool");
  const result: ConversationMessage[] = [];
  let repairCount = 0;

  for (let i = 0; i < filtered.length; i++) {
    const msg = filtered[i]!;

    // ── Case B + C: check user messages with tool_result blocks ──
    if (msg.role === "user" && Array.isArray(msg.content) && msg.content.some((b) => b.type === "tool_result")) {
      // Find the previous assistant message to get valid tool_use_ids
      const prevAssistant = result.length > 0 ? result[result.length - 1] : null;
      const validToolUseIds = new Set<string>();

      if (prevAssistant?.role === "assistant" && Array.isArray(prevAssistant.content)) {
        for (const b of prevAssistant.content) {
          if (b.type === "tool_use") {
            const id = b.id ?? b.toolUseId;
            if (id) validToolUseIds.add(id);
          }
        }
      }

      if (validToolUseIds.size === 0) {
        // No valid tool_use in previous message — skip this entire tool_result message
        repairCount++;
        continue;
      }

      // Case B: Filter to only tool_results that have a matching tool_use
      let blocks = msg.content.filter((b) => {
        if (b.type !== "tool_result") return true; // keep non-tool_result blocks
        const refId = b.toolUseId ?? (b as any).tool_use_id;
        return refId && validToolUseIds.has(refId);
      });

      const droppedCount = msg.content.length - blocks.length;
      if (droppedCount > 0) {
        repairCount += droppedCount;
        if (blocks.length === 0) {
          // All blocks were orphaned — inject synthetic results for all tool_use blocks
          result.push({
            ...msg,
            content: [...validToolUseIds].map((id) => ({
              type: "tool_result" as const,
              toolUseId: id,
              content: "[Error: tool result lost — previous turn may have crashed]",
              isError: true,
            })),
          });
          repairCount++;
          continue;
        }
      }

      // Case C: Inject synthetic results for any tool_use blocks missing their tool_result
      const existingResultIds = new Set<string>();
      for (const b of blocks) {
        if (b.type === "tool_result") {
          const refId = b.toolUseId ?? (b as any).tool_use_id;
          if (refId) existingResultIds.add(refId);
        }
      }

      const missingIds = [...validToolUseIds].filter((id) => !existingResultIds.has(id));
      if (missingIds.length > 0) {
        blocks = [
          ...blocks,
          ...missingIds.map((id) => ({
            type: "tool_result" as const,
            toolUseId: id,
            content: "[Error: tool result lost — previous turn may have crashed]",
            isError: true,
          })),
        ];
        repairCount += missingIds.length;
      }

      if (droppedCount > 0 || missingIds.length > 0) {
        result.push({ ...msg, content: blocks });
        continue;
      }
    }

    result.push(msg);

    // ── Case A: check assistant messages for orphaned tool_use ──
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");

      if (toolUseBlocks.length > 0) {
        const next = filtered[i + 1];
        const nextHasToolResult = next
          && next.role === "user"
          && Array.isArray(next.content)
          && next.content.some((b) => b.type === "tool_result");

        if (!nextHasToolResult) {
          // Insert synthetic tool_result as a ConversationMessage
          result.push({
            role: "user",
            content: toolUseBlocks.map((b) => ({
              type: "tool_result" as const,
              toolUseId: b.toolUseId ?? b.id ?? "unknown",
              content: "[Error: tool result lost — previous turn may have crashed]",
              isError: true,
            })),
            timestamp: new Date().toISOString(),
          });
          repairCount++;
        }
      }
    }
  }

  return { messages: result, wasRepaired: repairCount > 0, repairCount };
}

function conversationToLLM(messages: ConversationMessage[]): LLMMessage[] {
  // DB should already be repaired by repairOrphanedToolUse, so this is a simple conversion
  return messages
    .filter((m) => m.role !== "tool")
    .map(convertToLLM);
}

function convertToLLM(m: ConversationMessage): LLMMessage {
  if (typeof m.content === "string") {
    return { role: m.role, content: m.content };
  }
  const blocks: LLMContentBlock[] = m.content.map((b) => ({
    type: b.type,
    text: b.text,
    id: b.id,
    name: b.name,
    input: b.input,
    tool_use_id: b.toolUseId,
    content: b.content,
    is_error: b.isError,
  }));
  return { role: m.role, content: blocks };
}
