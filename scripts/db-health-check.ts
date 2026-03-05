import pg from "pg";

const client = new pg.Client({
  connectionString: "postgresql://lulzasaur:lulzasaur@localhost:5432/lulzasaur",
});

await client.connect();
console.log("✅ Database connection: OK");

// Check table counts
const result = await client.query(`
  SELECT 
    (SELECT COUNT(*) FROM agents) as agents,
    (SELECT COUNT(*) FROM tasks) as tasks,
    (SELECT COUNT(*) FROM messages) as messages
`);

console.log("✅ Database tables accessible");
console.log(`   - Agents: ${result.rows[0].agents}`);
console.log(`   - Tasks: ${result.rows[0].tasks}`);
console.log(`   - Messages: ${result.rows[0].messages}`);

await client.end();
console.log("✅ Database health check: PASSED");
