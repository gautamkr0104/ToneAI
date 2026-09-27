import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "./pool.js";
import { logger } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Migration {
  id: number;
  name: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  const dir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((f) => {
    const m = /^(\d+)_/.exec(f);
    if (!m) throw new Error(`Migration file must be named NNN_name.sql: ${f}`);
    return {
      id: Number(m[1]),
      name: f,
      sql: fs.readFileSync(path.join(dir, f), "utf8"),
    };
  });
}

export async function runMigrations(): Promise<number> {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const { rows } = await pool.query<{ id: number }>(
    "SELECT id FROM schema_migrations",
  );
  const applied = new Set(rows.map((r) => r.id));

  let count = 0;
  for (const mig of loadMigrations()) {
    if (applied.has(mig.id)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(mig.sql);
      await client.query(
        "INSERT INTO schema_migrations (id, name) VALUES ($1, $2)",
        [mig.id, mig.name],
      );
      await client.query("COMMIT");
      count++;
      logger.info("migration applied", { id: mig.id, name: mig.name });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error("migration failed", {
        id: mig.id,
        name: mig.name,
        err: String(err),
      });
      throw err;
    } finally {
      client.release();
    }
  }
  return count;
}

const isDirectRun =
  process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isDirectRun) {
  runMigrations()
    .then((n) => {
      logger.info(`migrations complete (${n} applied)`);
      return closePool();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error("migrations failed", { err: String(err) });
      process.exit(1);
    });
}
