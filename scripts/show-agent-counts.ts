import { getDb } from '../src/db/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  const db = getDb();
  
  const result = await db.execute(sql`
    SELECT status, COUNT(*) as count
    FROM agents
    GROUP BY status
    ORDER BY count DESC
  `);
  
  console.log('\n📊 Agent Status Summary:\n');
  let total = 0;
  const rows = Array.from(result as any);
  for (const row of rows) {
    console.log(`   ${row.status}: ${row.count}`);
    total += parseInt(row.count);
  }
  console.log(`\n   TOTAL: ${total}\n`);
}

main().catch(console.error);
