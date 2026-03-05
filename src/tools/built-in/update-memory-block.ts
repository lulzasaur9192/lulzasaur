import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { memoryBlocks } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";

// ── update_memory_block — edit core memory blocks ──────────────────

registerTool({
  name: "update_memory_block",
  description:
    "Update one of your core memory blocks. Use this to persist learnings, " +
    "preferences, and context that should always be available to you. " +
    "Available blocks: persona, learned_preferences, working_context, domain_knowledge.",
  capability: "memory_blocks",
  inputSchema: {
    type: "object",
    properties: {
      label: {
        type: "string",
        enum: ["persona", "learned_preferences", "working_context", "domain_knowledge"],
        description: "Which memory block to update",
      },
      value: {
        type: "string",
        description: "The new content for this block (replaces existing content, or appended if mode='append')",
      },
      mode: {
        type: "string",
        enum: ["replace", "append"],
        description: "Replace entire block or append to it (default: replace)",
      },
    },
    required: ["label", "value"],
  },
  execute: async (agentId: string, input: any) => {
    const db = getDb();
    const { label, value, mode } = input;

    // Find the block
    const [block] = await db
      .select()
      .from(memoryBlocks)
      .where(and(eq(memoryBlocks.agentId, agentId), eq(memoryBlocks.label, label)))
      .limit(1);

    if (!block) {
      return { error: `Memory block "${label}" not found. Available blocks: persona, learned_preferences, working_context, domain_knowledge` };
    }

    // Compute new value
    let newValue: string;
    if (mode === "append") {
      newValue = block.value ? block.value + "\n" + value : value;
    } else {
      newValue = value;
    }

    // Validate char limit
    if (newValue.length > block.charLimit) {
      return {
        error: `Content exceeds char limit for "${label}": ${newValue.length}/${block.charLimit} chars. Shorten your content or compress existing entries.`,
        current_length: block.value.length,
        attempted_length: newValue.length,
        char_limit: block.charLimit,
      };
    }

    // Update
    await db
      .update(memoryBlocks)
      .set({ value: newValue, updatedAt: new Date() })
      .where(eq(memoryBlocks.id, block.id));

    return {
      updated: true,
      label,
      char_count: newValue.length,
      char_limit: block.charLimit,
      mode: mode ?? "replace",
    };
  },
});
