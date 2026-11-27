// Lapisan database tipis: { query(text, params), one(), many(), tx(fn) }.
// Produksi memakai `pg` (Supabase PostgreSQL via connection string).
// Pengembangan/pengujian dapat memakai PGlite (PostgreSQL WASM) tanpa server.
import pg from 'pg';
import { mkdirSync } from 'node:fs';

const INT8_OID = 20;
const NUMERIC_OID = 1700;

// Nominal rupiah disimpan BIGINT; nilai realistis jauh di bawah 2^53 sehingga aman sebagai Number.
pg.types.setTypeParser(INT8_OID, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(NUMERIC_OID, (v) => (v === null ? null : Number(v)));

function wrap(executor, txRunner, execMulti) {
  const api = {
    // Menjalankan SQL multi-statement tanpa parameter (dipakai migrasi).
    async exec(sql) {
      await execMulti(sql);
    },
    async query(text, params = []) {
      const res = await executor(text, params);
      return { rows: res.rows, rowCount: res.rowCount ?? res.affectedRows ?? res.rows.length };
    },
    async one(text, params) {
      const { rows } = await api.query(text, params);
      return rows[0] ?? null;
    },
    async many(text, params) {
      const { rows } = await api.query(text, params);
      return rows;
    },
    tx: txRunner,
  };
  return api;
}

export function createPgDb({ connectionString, max = 10, ssl }) {
  const pool = new pg.Pool({
    connectionString,
    max,
    ssl,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    // Jangan biarkan error koneksi idle mematikan proses.
    console.error('[db] idle client error', err.message);
  });

  const db = wrap(
    (text, params) => pool.query(text, params),
    async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txDb = wrap(
          (t, p) => client.query(t, p),
          async (inner) => inner(txDb),
          (sql) => client.query(sql),
        );
        const result = await fn(txDb);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* koneksi mungkin sudah putus */ }
        throw err;
      } finally {
        client.release();
      }
    },
    (sql) => pool.query(sql),
  );
  db.kind = 'pg';
  db.close = () => pool.end();
  return db;
}

export async function createPgliteDb({ dataDir } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const parsers = { [INT8_OID]: (v) => Number(v), [NUMERIC_OID]: (v) => Number(v) };
  const pgl = dataDir ? new PGlite(dataDir, { parsers }) : new PGlite({ parsers });
  await pgl.waitReady;

  const db = wrap(
    (text, params) => pgl.query(text, params),
    (fn) =>
      pgl.transaction(async (tx) => {
        const txDb = wrap(
          (t, p) => tx.query(t, p),
          async (inner) => inner(txDb),
          (sql) => tx.exec(sql),
        );
        return fn(txDb);
      }),
    (sql) => pgl.exec(sql),
  );
  db.kind = 'pglite';
  db.close = () => pgl.close();
  return db;
}

export async function createDb(config) {
  if (config.dbDriver === 'pglite') {
    return createPgliteDb({ dataDir: config.pgliteDataDir });
  }
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL wajib diisi (atau set DB_DRIVER=pglite untuk mode pengembangan).');
  }
  return createPgDb({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  });
}
