import { config } from "dotenv";
config();

import { getDb } from "../src/db/client.js";
import { projects } from "../src/db/schema.js";

async function main() {
  const db = getDb();
  const rows = await db.select().from(projects);
  for (const r of rows) {
    console.log(`${r.id.substring(0, 8)}  ${r.name}  active=${r.active}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
