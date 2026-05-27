import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(rootDir, "db", "migrations");
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const pool = new Pool({ connectionString });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const applied = await client.query(
      "SELECT version FROM schema_migrations WHERE version = $1",
      [version]
    );

    if (applied.rows.length > 0) {
      console.log(`skip ${version}`);
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
      version
    ]);
    console.log(`applied ${version}`);
  }

  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
