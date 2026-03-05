import { getDb } from '../src/db/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  const db = getDb();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  console.log('\n🧹 Agent Cleanup Starting...\n');
  
  // 1. Reset stuck "active" agents to "idle" (if created >1 hour ago)
  console.log('📋 Step 1: Resetting stuck "active" agents to "idle"...');
  const resetActive = await db.execute(sql`
    UPDATE agents 
    SET status = 'idle'
    WHERE status = 'active'
      AND created_at < ${oneHourAgo}
  `);
  
  console.log(`   ✅ Reset ${resetActive.count} stuck agents to idle`);
  
  // 2. Terminate very old idle agents (>24 hours, except main-orchestrator)
  console.log('\n📋 Step 2: Terminating old idle agents (>24 hours)...');
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const terminated = await db.execute(sql`
    UPDATE agents 
    SET status = 'terminated', terminated_at = NOW()
    WHERE status = 'idle'
      AND created_at < ${oneDayAgo}
      AND name != 'main-orchestrator'
  `);
  
  console.log(`   ✅ Terminated ${terminated.count} very old agents`);
  
  // 3. Show final counts
  console.log('\n📊 Current agent status:');
  const counts = await db.execute(sql`
    SELECT status, COUNT(*) as count
    FROM agents
    GROUP BY status
    ORDER BY 
      CASE status 
        WHEN 'active' THEN 1 
        WHEN 'idle' THEN 2 
        WHEN 'sleeping' THEN 3 
        WHEN 'terminated' THEN 4 
      END
  `);
  
  for (const row of counts.rows as any[]) {
    console.log(`   ${row.status}: ${row.count}`);
  }
  
  console.log('\n✅ Cleanup complete!\n');
}

main().catch(console.error);
