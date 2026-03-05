// Manual migration to add schedules columns
import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/lulzasaur'
});

async function migrate() {
  try {
    await client.connect();
    console.log('Connected to database');
    
    // Add schedules column to soul_definitions
    await client.query(`
      ALTER TABLE soul_definitions 
      ADD COLUMN IF NOT EXISTS schedules jsonb;
    `);
    console.log('✅ Added schedules column to soul_definitions');
    
    // Add schedules column to agents  
    await client.query(`
      ALTER TABLE agents
      ADD COLUMN IF NOT EXISTS schedules jsonb;
    `);
    console.log('✅ Added schedules column to agents');
    
    // Verify
    const result = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'agents' AND column_name = 'schedules';
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Migration successful - schedules columns added');
    } else {
      console.log('⚠️  Warning: Could not verify schedules column');
    }
    
  } catch (error) {
    console.error('Migration error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
