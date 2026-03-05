import EmbeddedPostgres from "embedded-postgres";
import { join } from "node:path";

const dataDir = join(import.meta.dirname ?? process.cwd(), "..", "tmp-pg");

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "lulzasaur",
  password: "lulzasaur",
  port: 5432,
  persistent: true,
});

try {
  await pg.initialise();
} catch {
  // Already initialized
}

await pg.start();

try {
  await pg.createDatabase("lulzasaur");
} catch {
  // Already exists
}

console.log("PostgreSQL running on port 5432");
console.log("Press Ctrl+C to stop");

process.on("SIGINT", async () => {
  await pg.stop();
  process.exit(0);
});

// Keep alive
setInterval(() => {}, 60000);
