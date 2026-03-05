import { eq, and } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { conversations, agents, tasks, projects } from "../db/schema.js";
import { getProvider } from "../llm/registry.js";
import { estimateMessagesTokens } from "../llm/token-counter.js";
import { buildSystemPrompt } from "./soul.js";
import { createChildLogger } from "../utils/logger.js";
import type { ConversationMessage } from "../db/schema.js";
import type { LLMMessage, LLMContentBlock } from "./types.js";

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

  const systemPrompt = buildSystemPrompt(soul, project);
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
 * 3. Keep the last N messages in full for immediate context
 * This makes the summarization LLM call much cheaper.
 */
const KEEP_RECENT_COUNT = 10;

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

  // Split messages: older ones to summarize, recent ones to keep in full
  const toSummarize = messages.length > KEEP_RECENT_COUNT
    ? messages.slice(0, -KEEP_RECENT_COUNT)
    : [];
  const toKeep = messages.length > KEEP_RECENT_COUNT
    ? messages.slice(-KEEP_RECENT_COUNT)
    : messages;

  // If nothing to summarize, just return as-is
  if (toSummarize.length === 0) {
    return messages;
  }

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
