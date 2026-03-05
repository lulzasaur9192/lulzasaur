import { eq, and, lt, lte, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { agents, knowledgeEntities, memoryBlocks } from "../db/schema.js";
import { getProvider } from "../llm/registry.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("memory-consolidation");

const EXTRACTION_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  huggingface: "Qwen/Qwen2.5-72B-Instruct",
};

/**
 * Run memory consolidation for an agent during proactive sessions.
 * 1. Decay stale, unaccessed KG entities
 * 2. Compress overfull memory blocks using a cheap model
 */
export async function consolidateMemory(
  agent: typeof agents.$inferSelect,
): Promise<{ decayed: number; deleted: number; compressed: number }> {
  const db = getDb();
  let decayed = 0;
  let deleted = 0;
  let compressed = 0;

  // ── 1. Decay stale entities ──
  // Entities with accessCount === 0 and updatedAt older than 14 days → reduce confidence by 10
  const staleThreshold = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const staleEntities = await db
    .select()
    .from(knowledgeEntities)
    .where(and(
      eq(knowledgeEntities.agentId, agent.id),
      eq(knowledgeEntities.accessCount, 0),
      lt(knowledgeEntities.updatedAt, staleThreshold),
    ));

  for (const entity of staleEntities) {
    const newConfidence = entity.confidence - 10;
    if (newConfidence < 20) {
      // Delete very low confidence, never-accessed entities
      await db.delete(knowledgeEntities).where(eq(knowledgeEntities.id, entity.id));
      deleted++;
    } else {
      await db
        .update(knowledgeEntities)
        .set({ confidence: newConfidence, updatedAt: new Date() })
        .where(eq(knowledgeEntities.id, entity.id));
      decayed++;
    }
  }

  if (decayed > 0 || deleted > 0) {
    log.info({ agentId: agent.id, decayed, deleted }, "Decayed stale KG entities");
  }

  // ── 2. Compress overfull memory blocks ──
  const blocks = await db
    .select()
    .from(memoryBlocks)
    .where(eq(memoryBlocks.agentId, agent.id));

  for (const block of blocks) {
    if (block.value.length > block.charLimit * 0.8) {
      try {
        const providerName = agent.provider ?? "anthropic";
        const model = EXTRACTION_MODELS[providerName] ?? EXTRACTION_MODELS.anthropic!;
        const provider = getProvider(providerName);

        const response = await provider.chat(
          [{
            role: "user",
            content: `Compress the following memory block content while preserving ALL key information. The block is at ${block.value.length}/${block.charLimit} chars and needs to be shortened to under ${Math.floor(block.charLimit * 0.6)} chars.

Block: ${block.label}
Purpose: ${block.description}

Current content:
${block.value}

Return ONLY the compressed content, no other text. Preserve the most important facts, remove redundancy, and use concise language.`,
          }],
          {
            model,
            maxTokens: Math.ceil(block.charLimit / 4),
            systemPrompt: "You compress text while preserving key information. Return only the compressed text.",
          },
        );

        const compressedValue = response.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");

        if (compressedValue.length > 0 && compressedValue.length < block.value.length) {
          await db
            .update(memoryBlocks)
            .set({ value: compressedValue, updatedAt: new Date() })
            .where(eq(memoryBlocks.id, block.id));
          compressed++;
          log.info(
            { agentId: agent.id, block: block.label, before: block.value.length, after: compressedValue.length },
            "Compressed memory block",
          );
        }
      } catch (error) {
        log.warn({ agentId: agent.id, block: block.label, error }, "Failed to compress memory block");
      }
    }
  }

  return { decayed, deleted, compressed };
}
