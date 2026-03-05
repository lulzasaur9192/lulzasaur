import { config } from "dotenv";
config();
import { getDb } from "../src/db/client.js";
import { agents, soulDefinitions } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

const target = process.argv[2] || "smoke-test-orchestrator";

async function main() {
  const db = getDb();
  const rows = await db
    .select({ agent: agents, soul: soulDefinitions })
    .from(agents)
    .leftJoin(soulDefinitions, eq(agents.soulId, soulDefinitions.id))
    .where(eq(agents.name, target));

  if (rows.length === 0) {
    console.log("Agent not found:", target);
    process.exit(1);
  }

  for (const r of rows) {
    console.log("=== Agent ===");
    console.log("  ID:", r.agent.id);
    console.log("  Name:", r.agent.name);
    console.log("  Status:", r.agent.status);
    console.log("  Parent:", r.agent.parentId ?? "none");
    console.log("  Project:", r.agent.projectId ?? "none");
    console.log("  Model:", r.agent.model);
    console.log("  Heartbeat:", r.agent.heartbeatIntervalSeconds ?? "none");
    console.log("  Created:", r.agent.createdAt);
    console.log("=== Soul ===");
    console.log("  Soul name:", r.soul?.name ?? "none");
    console.log("  Purpose:", r.soul?.purpose?.substring(0, 200) ?? "none");
    console.log("  Capabilities:", r.soul?.capabilities ?? "none");
    console.log("  Persistent:", r.soul?.persistent ?? "unknown");
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
