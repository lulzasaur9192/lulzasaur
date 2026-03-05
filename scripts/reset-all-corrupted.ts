/**
 * Find and reset ALL agents with corrupted conversations.
 * Usage: npx tsx scripts/reset-all-corrupted.ts [--dry-run]
 */
import { config } from "dotenv";
config();

import { getDb } from "../src/db/client.js";
import { agents, conversations } from "../src/db/schema.js";
import { eq, and, ne } from "drizzle-orm";
import type { ConversationMessage } from "../src/db/schema.js";

const dryRun = process.argv.includes("--dry-run");

function detectCorruption(messages: ConversationMessage[]): string[] {
  const issues: string[] = [];
  const filtered = messages.filter((m) => m.role !== "tool");

  for (let i = 0; i < filtered.length; i++) {
    const msg = filtered[i]!;

    // Check assistant messages for orphaned tool_use
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");
      if (toolUseBlocks.length > 0) {
        const next = filtered[i + 1];
        const nextHasToolResult =
          next &&
          next.role === "user" &&
          Array.isArray(next.content) &&
          next.content.some((b) => b.type === "tool_result");

        if (!nextHasToolResult) {
          issues.push(`msg[${i}]: assistant has ${toolUseBlocks.length} tool_use blocks but next msg has no tool_result`);
        } else {
          // Check for partial matches
          const resultIds = new Set<string>();
          for (const b of next.content as any[]) {
            if (b.type === "tool_result") {
              const refId = b.toolUseId ?? b.tool_use_id;
              if (refId) resultIds.add(refId);
            }
          }
          for (const b of toolUseBlocks) {
            const id = b.id ?? b.toolUseId;
            if (id && !resultIds.has(id)) {
              issues.push(`msg[${i}]: tool_use ${id} has no matching tool_result`);
            }
          }
        }
      }
    }

    // Check user messages for orphaned tool_result
    if (msg.role === "user" && Array.isArray(msg.content) && msg.content.some((b) => b.type === "tool_result")) {
      const prev = i > 0 ? filtered[i - 1] : null;
      const validIds = new Set<string>();
      if (prev?.role === "assistant" && Array.isArray(prev.content)) {
        for (const b of prev.content) {
          if (b.type === "tool_use") {
            const id = b.id ?? b.toolUseId;
            if (id) validIds.add(id);
          }
        }
      }

      for (const b of msg.content as any[]) {
        if (b.type === "tool_result") {
          const refId = b.toolUseId ?? b.tool_use_id;
          if (refId && !validIds.has(refId)) {
            issues.push(`msg[${i}]: tool_result ${refId} has no matching tool_use`);
          }
        }
      }
    }
  }

  return issues;
}

async function main() {
  const db = getDb();

  const allAgents = await db
    .select()
    .from(agents)
    .where(ne(agents.status, "terminated"));

  let corruptedCount = 0;
  let resetCount = 0;

  for (const agent of allAgents) {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.agentId, agent.id), eq(conversations.isActive, true)))
      .limit(1);

    if (!conv) continue;

    const messages = conv.messages as ConversationMessage[];
    const issues = detectCorruption(messages);

    if (issues.length > 0) {
      corruptedCount++;
      console.log(`\n${agent.name} (${agent.id.substring(0, 8)}) — ${issues.length} issue(s), ${messages.length} messages:`);
      for (const issue of issues.slice(0, 5)) {
        console.log(`  - ${issue}`);
      }
      if (issues.length > 5) console.log(`  ... and ${issues.length - 5} more`);

      if (!dryRun) {
        await db
          .update(conversations)
          .set({ isActive: false, summary: "Reset by bulk cleanup — conversation was corrupted", updatedAt: new Date() })
          .where(eq(conversations.id, conv.id));

        await db.insert(conversations).values({
          agentId: agent.id,
          isActive: true,
          messages: [
            {
              role: "user",
              content: "[CONTEXT RECOVERY] Your previous conversation was reset due to corruption. You are starting fresh. Check your tasks and messages on next heartbeat.",
              timestamp: new Date().toISOString(),
            },
            {
              role: "assistant",
              content: "Understood. My conversation history was reset. I'll check my tasks and messages to recover context.",
              timestamp: new Date().toISOString(),
            },
          ],
          tokenCount: 100,
        });

        resetCount++;
        console.log(`  → RESET`);
      } else {
        console.log(`  → Would reset (dry run)`);
      }
    }
  }

  console.log(`\nSummary: ${corruptedCount} corrupted out of ${allAgents.length} agents.${dryRun ? " (dry run — no changes)" : ` Reset ${resetCount}.`}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
