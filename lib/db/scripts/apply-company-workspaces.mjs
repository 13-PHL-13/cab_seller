import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Load the API .env file or set it in the current shell.");
}

const migrationUrl = new URL("../company-workspaces.migration.sql", import.meta.url);
const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  process.stdout.write("Company workspace migration applied successfully.\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
