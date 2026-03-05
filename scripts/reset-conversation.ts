/**
 * Reset an agent's active conversation.
 * Usage: npx tsx scripts/reset-conversation.ts [agent-name-or-id-prefix]
 * Default: main-orchestrator
 */
import { config } from "dotenv";
config();

import { getDb } from "../src/db/client.js";
import { agents, conversations } from "../src/db/schema.js";
import { eq, and, ne } from "drizzle-orm";

const target = process.argv[2] || "main-orchestrator";

async function main() {
  const db = getDb();

  // Find agent
  const allAgents = await db
    .select()
    .from(agents)
    .where(ne(agents.status, "terminated"));

  const agent = allAgents.find(
    (a) => a.name === target || a.id.startsWith(target),
  );

  if (!agent) {
    console.error(`Agent not found: ${target}`);
    console.log("Available agents:");
    for (const a of allAgents) {
      console.log(`  ${a.id.substring(0, 8)}  ${a.name}  (${a.status})`);
    }
    process.exit(1);
  }

  console.log(`Resetting conversation for: ${agent.name} (${agent.id.substring(0, 8)})`);

  // Deactivate all active conversations
  const updated = await db
    .update(conversations)
    .set({ isActive: false, summary: "Reset by admin — conversation was corrupted", updatedAt: new Date() })
    .where(and(eq(conversations.agentId, agent.id), eq(conversations.isActive, true)))
    .returning();

  console.log(`  Deactivated ${updated.length} conversation(s)`);

  // Create fresh active conversation
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

  console.log("  Created fresh active conversation");
  console.log("Done. Restart the server.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
