import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { buildApp } from './app.js';
import { startJobs } from './jobs/scheduler.js';

const config = loadConfig();
const db = await createDb(config);
if (config.autoMigrate || config.dbDriver === 'pglite') await migrate(db);

const app = await buildApp({ config, db });
const stopJobs = config.jobsEnabled ? startJobs(app) : () => {};

if (config.authMode === 'dev') app.log.warn('AUTH_MODE=dev aktif — HANYA untuk pengembangan lokal.');

async function shutdown(signal) {
  app.log.info({ signal }, 'shutting down');
  stopJobs();
  try {
    await app.close();
    await db.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
