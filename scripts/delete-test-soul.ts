import { config } from "dotenv";
config();
import { getDb } from "../src/db/client.js";
import { soulDefinitions, agents } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

async function main() {
  const db = getDb();
  const souls = await db.select().from(soulDefinitions).where(eq(soulDefinitions.name, "test-agent"));
  console.log("Found", souls.length, "test-agent soul(s):");
  for (const s of souls) {
    console.log("  id:", s.id, "project:", s.projectId, "persistent:", s.persistent);

    // Nullify FK references from agents
    const updated = await db
      .update(agents)
      .set({ soulId: null })
      .where(eq(agents.soulId, s.id))
      .returning();
    console.log("  Nullified soulId on", updated.length, "agent(s)");
  }

  if (souls.length > 0) {
    await db.delete(soulDefinitions).where(eq(soulDefinitions.name, "test-agent"));
    console.log("Deleted test-agent soul definition(s)");
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
