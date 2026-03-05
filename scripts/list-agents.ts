import { getDb } from '../src/db/client.js';
import { agents } from '../src/db/schema.js';
import { ne } from 'drizzle-orm';

async function main() {
  const db = getDb();
  const result = await db.select({
    name: agents.name,
    soul: agents.soulName,
    status: agents.status,
    created: agents.createdAt,
  }).from(agents).where(ne(agents.status, 'terminated'));

  const grouped: Record<string, any[]> = { active: [], idle: [], sleeping: [] };
  result.forEach(r => { if (grouped[r.status]) grouped[r.status].push(r); });

  console.log('\n=== AGENTS STATUS ===\n');
  ['active', 'idle', 'sleeping'].forEach(s => {
    if (grouped[s].length > 0) {
      console.log(`${s.toUpperCase()}: ${grouped[s].length}`);
      grouped[s].slice(0, 8).forEach((a: any) => {
        const age = Math.floor((Date.now() - new Date(a.created).getTime()) / 60000);
        console.log(`  - ${a.name} (${a.soul}) - ${age}min ago`);
      });
      if (grouped[s].length > 8) console.log(`  ... +${grouped[s].length - 8} more`);
    }
  });
  console.log(`\nTOTAL: ${result.length} agents\n`);
}

main();
