import pg from "pg";

const client = new pg.Client({
  connectionString: "postgresql://lulzasaur:lulzasaur@localhost:5432/lulzasaur",
});

await client.connect();
await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
console.log("DB nuked successfully — all tables dropped");
await client.end();
