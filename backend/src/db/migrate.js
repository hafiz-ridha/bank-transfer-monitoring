// Runner migrasi sederhana: menjalankan file migrations/*.sql berurutan, sekali saja.
// CLI: `npm run migrate`
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function migrate(db, { log = console.log } = {}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;`);

  const applied = new Set((await db.many('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.tx(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    log(`[migrate] applied ${file}`);
    ran.push(file);
  }
  if (ran.length === 0) log('[migrate] database sudah terbaru');
  return ran;
}

// Dijalankan langsung dari CLI
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { loadConfig } = await import('../config.js');
  const { createDb } = await import('./index.js');
  const config = loadConfig(process.env, { validateAuth: false });
  const db = await createDb(config);
  try {
    await migrate(db);
  } catch (err) {
    console.error('[migrate] gagal:', err.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
