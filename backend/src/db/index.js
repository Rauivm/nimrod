import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

export async function runMigrations() {
  // Create a tracking table so each file runs exactly once.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = join(__dirname, '../../migrations');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    // Skip if already recorded as applied
    const check = await pool.query(
      'SELECT 1 FROM _migrations WHERE filename = $1',
      [file]
    );
    if (check.rowCount > 0) {
      console.log(`✓ Already applied: ${file}`);
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      console.log(`✓ Migration applied: ${file}`);
    } catch (err) {
      console.error(`✗ Migration failed: ${file}`, err.message);
      throw err;
    }
  }
}
