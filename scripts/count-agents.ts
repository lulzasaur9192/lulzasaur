import { getDb } from '../src/db/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  const db = getDb();
  
  const result = await db.execute(sql`
    SELECT 
      status,
      COUNT(*) as count
    FROM agents 
    WHERE status != 'terminated'
    GROUP BY status
    ORDER BY count DESC
  `);

  console.log('\n=== AGENT STATUS SUMMARY ===\n');
  
  let total = 0;
  for (const row of result.rows as any[]) {
    console.log(`${row.status.toUpperCase()}: ${row.count}`);
    total += parseInt(row.count);
  }
  
  console.log(`\nTOTAL NON-TERMINATED: ${total}\n`);
}

main().catch(console.error);
