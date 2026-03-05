import { config } from "dotenv";
config();
import { getDb } from "../src/db/client.js";
import { agents, soulDefinitions } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

async function main() {
  const db = getDb();
  const all = await db
    .select({ agent: agents, soul: soulDefinitions })
    .from(agents)
    .leftJoin(soulDefinitions, eq(agents.soulId, soulDefinitions.id));

  console.log("=== ALL AGENTS TOKEN AUDIT ===\n");
  
  let totalWakeupsPerHour = 0;
  
  for (const r of all) {
    const a = r.agent;
    const interval = a.heartbeatIntervalSeconds;
    const wakeupsPerHour = interval ? (3600 / interval) : 0;
    const status = a.status;
    const isActive = status !== "terminated";
    
    if (isActive && interval) totalWakeupsPerHour += wakeupsPerHour;
    
    const model = a.model ?? r.soul?.defaultModel ?? "unknown";
    const next = a.nextHeartbeatAt ? a.nextHeartbeatAt.toISOString() : "null";
    
    console.log(`${a.name}`);
    console.log(`  status=${status}  model=${model}  interval=${interval ?? 'none'}s  wakeups/hr=${wakeupsPerHour.toFixed(1)}  project=${a.projectId?.substring(0,8) ?? 'core'}`);
    console.log(`  next=${next}  persistent=${r.soul?.persistent ?? 'unknown'}`);
    console.log(`  schedules=${a.schedules ? JSON.stringify(a.schedules).substring(0, 120) : 'none'}`);
    console.log();
  }
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total active wakeups/hour: ${totalWakeupsPerHour.toFixed(1)}`);
  console.log(`Estimated API calls/hour: ${totalWakeupsPerHour.toFixed(0)} (each heartbeat = 1+ API calls)`);
  console.log(`Estimated API calls/day: ${(totalWakeupsPerHour * 24).toFixed(0)}`);
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
