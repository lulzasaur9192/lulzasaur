import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { agents, conversations, memoryBlocks } from "../../db/schema.js";
import { getProvider } from "../../llm/registry.js";
import { registerTool } from "../tool-registry.js";
import type { ConversationMessage } from "../../db/schema.js";

const EXTRACTION_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  huggingface: "Qwen/Qwen2.5-72B-Instruct",
};

// ── reflect — analyze recent conversation and extract learnings ────

registerTool({
  name: "reflect",
  description:
    "Reflect on your recent conversation to extract learnings. " +
    "Analyzes your last messages and suggests updates to your memory blocks " +
    "and knowledge graph. Call this periodically or when you've learned something important.",
  capability: "memory_blocks",
  inputSchema: {
    type: "object",
    properties: {
      focus: {
        type: "string",
        enum: ["preferences", "domain", "mistakes", "all"],
        description: "Optional focus area (default: 'all')",
      },
    },
  },
  execute: async (agentId: string, input: any) => {
    const db = getDb();
    const focus = input.focus ?? "all";

    // 1. Load agent info
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (!agent) return { error: "Agent not found" };

    // 2. Load active conversation — last 15 messages
    const [activeConv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.agentId, agentId), eq(conversations.isActive, true)))
      .limit(1);

    if (!activeConv) return { error: "No active conversation found" };

    const allMessages = activeConv.messages as ConversationMessage[];
    const recentMessages = allMessages.slice(-15);

    if (recentMessages.length < 2) {
      return { suggestions: [], message: "Not enough conversation history to reflect on." };
    }

    // 3. Load current memory blocks
    const blocks = await db
      .select()
      .from(memoryBlocks)
      .where(eq(memoryBlocks.agentId, agentId))
      .orderBy(memoryBlocks.label);

    const blocksContext = blocks.map((b) =>
      `### ${b.label} [${b.value.length}/${b.charLimit} chars]\n${b.value || "(empty)"}`,
    ).join("\n\n");

    // 4. Serialize recent messages
    const serialized = recentMessages
      .map((m) => `[${m.role}]: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
      .join("\n\n")
      .substring(0, 10000);

    // 5. Build focus-specific prompt
    let focusInstruction = "";
    if (focus === "preferences") {
      focusInstruction = "Focus specifically on user preferences, coding style, communication style, and tool preferences.";
    } else if (focus === "domain") {
      focusInstruction = "Focus specifically on domain knowledge, architecture decisions, system patterns, and technical facts.";
    } else if (focus === "mistakes") {
      focusInstruction = "Focus specifically on mistakes made, lessons learned, approaches that failed, and things to avoid.";
    } else {
      focusInstruction = "Extract all types of learnings: preferences, domain knowledge, self-understanding, and mistakes.";
    }

    // 6. Send to cheap model
    const providerName = agent.provider ?? "anthropic";
    const extractionModel = EXTRACTION_MODELS[providerName] ?? EXTRACTION_MODELS.anthropic!;
    const provider = getProvider(providerName);

    const response = await provider.chat(
      [{
        role: "user",
        content: `You are analyzing a conversation to extract learnings for an AI agent's persistent memory.

${focusInstruction}

Current memory blocks:
${blocksContext}

Recent conversation:
${serialized}

Extract suggestions for updating memory blocks and knowledge graph entities. Return a JSON object with:
{
  "suggestions": [
    { "block": "persona|learned_preferences|working_context|domain_knowledge", "action": "replace|append", "content": "..." }
  ],
  "kg_entities": [
    { "name": "kebab-case-name", "type": "decision|lesson|preference|concept", "content": "1-2 sentence description" }
  ]
}

Rules:
- Only suggest changes that add genuinely new information not already in the memory blocks
- For working_context, suggest a replace with an updated state summary
- For other blocks, prefer append unless the content should be restructured
- Keep suggestions concise — memory blocks have char limits
- Return empty arrays if nothing meaningful to extract

Respond with ONLY the JSON object, no other text.`,
      }],
      {
        model: extractionModel,
        maxTokens: 1000,
        systemPrompt: "You extract structured learnings from conversations. Respond only with valid JSON.",
      },
    );

    const responseText = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    // Parse response
    const jsonStr = responseText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    try {
      const result = JSON.parse(jsonStr);
      return {
        suggestions: result.suggestions ?? [],
        kg_entities: result.kg_entities ?? [],
        message: "Review these suggestions and use update_memory_block / kg_store to apply the ones you agree with.",
      };
    } catch {
      return {
        suggestions: [],
        kg_entities: [],
        message: "Reflection produced no structured output. Try again or manually update your memory blocks.",
      };
    }
  },
});
