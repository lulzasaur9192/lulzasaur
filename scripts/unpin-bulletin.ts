import { config } from "dotenv";
config();
import { getDb } from "../src/db/client.js";
import { bulletinBoard } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

async function main() {
  const db = getDb();
  const result = await db
    .update(bulletinBoard)
    .set({ pinned: false })
    .where(eq(bulletinBoard.pinned, true))
    .returning({ id: bulletinBoard.id });
  console.log(`Unpinned ${result.length} posts`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
