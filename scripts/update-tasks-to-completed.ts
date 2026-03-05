import pg from "pg";

const client = new pg.Client({
  connectionString: "postgresql://lulzasaur:lulzasaur@localhost:5432/lulzasaur",
});

const taskIds = [
  '805e2467-9a4e-448e-bd7b-9d534588d0da',
  'f27e9c82-96bb-4c3d-8316-2c1842104de7',
  'e859eb05-4566-4aed-8491-e64ede73ae90',
  '71569f28-5728-422b-81a9-b99b608cd508',
  'c3fb79ea-43cb-45ce-8ed8-5af6c62bfbb9',
  '676da5d4-cdc2-4f6c-9b5d-e300a8a737e5',
  '4aea655c-d36e-41be-9b39-8a44a3f5f623',
  '2c90294f-8780-40a4-98e6-6089cbcd2716'
];

await client.connect();

// Update tasks to completed
const updateResult = await client.query(
  `UPDATE tasks 
   SET status = 'completed', completed_at = NOW() 
   WHERE id = ANY($1::uuid[])`,
  [taskIds]
);

console.log(`✅ Updated ${updateResult.rowCount} tasks to completed status`);

// Verify the updates
const verifyResult = await client.query(
  `SELECT id, title, status, completed_at 
   FROM tasks 
   WHERE id = ANY($1::uuid[])
   ORDER BY title`,
  [taskIds]
);

console.log('\n📋 Task Status Verification:');
console.log('================================');
for (const row of verifyResult.rows) {
  console.log(`✓ ${row.title}`);
  console.log(`  ID: ${row.id}`);
  console.log(`  Status: ${row.status}`);
  console.log(`  Completed: ${row.completed_at}`);
  console.log('');
}

await client.end();
