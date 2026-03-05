/**
 * Terminate an agent and disable its heartbeat.
 * Usage: npx tsx scripts/terminate-agent.ts <agent-name-or-id-prefix>
 */
import { config } from "dotenv";
config();
import { getDb } from "../src/db/client.js";
import { agents, conversations } from "../src/db/schema.js";
import { eq, and, ne } from "drizzle-orm";

const target = process.argv[2];
if (!target) {
  console.error("Usage: npx tsx scripts/terminate-agent.ts <agent-name-or-id-prefix>");
  process.exit(1);
}

async function main() {
  const db = getDb();

  const allAgents = await db.select().from(agents).where(ne(agents.status, "terminated"));
  const matches = allAgents.filter(
    (a) => a.name === target || a.id.startsWith(target),
  );

  if (matches.length === 0) {
    console.error(`No active agent found: ${target}`);
    console.log("Available agents:");
    for (const a of allAgents) {
      console.log(`  ${a.id.substring(0, 8)}  ${a.name}  (${a.status})`);
    }
    process.exit(1);
  }

  for (const agent of matches) {
    console.log(`Terminating: ${agent.name} (${agent.id.substring(0, 8)}) — was ${agent.status}`);

    await db
      .update(agents)
      .set({
        status: "terminated",
        terminatedAt: new Date(),
        nextHeartbeatAt: null,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agent.id));

    // Deactivate conversations
    const convs = await db
      .update(conversations)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(conversations.agentId, agent.id), eq(conversations.isActive, true)))
      .returning();

    console.log(`  Deactivated ${convs.length} conversation(s)`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
