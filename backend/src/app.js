import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { HttpError } from './lib/util.js';
import { registerAuth, createIdentityVerifier } from './auth/index.js';
import { createSettingsService } from './services/settings.js';
import { createDeviceService } from './services/devices.js';
import { createNotificationService } from './services/notifications.js';
import { createMatchingService } from './services/matching.js';
import { createWebhookService } from './services/webhooks.js';
import { createOrderService } from './services/orders.js';
import { createAlertService } from './services/alerts.js';
import { createReportService } from './services/reports.js';
import androidRoutes from './routes/android.js';
import posRoutes from './routes/pos.js';
import dashboardDeviceRoutes from './routes/dashboard-devices.js';
import dashboardTransactionRoutes from './routes/dashboard-transactions.js';
import dashboardAdminRoutes from './routes/dashboard-admin.js';

/**
 * Membangun aplikasi Fastify. Dependensi dapat diinjeksi untuk pengujian.
 * @param {{config, db, verifier?, fetchImpl?, logger?}} opts
 */
export async function buildApp({ config, db, verifier, fetchImpl, logger }) {
  const app = Fastify({
    logger: logger ?? { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers["x-api-key"]'] },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: true, coerceTypes: 'array', useDefaults: true, allErrors: false } },
  });

  // ------------------------------------------------------------ services
  const log = app.log;
  const settings = createSettingsService(db);
  const webhooks = createWebhookService({ db, settings, log, fetchImpl });
  const kickWebhooks = () => setImmediate(() => webhooks.processDue().catch((err) => log.error({ err }, 'webhook worker error')));
  const matching = createMatchingService({ db, settings, log, onMatched: kickWebhooks });
  const runMatch = (id) => matching.matchTransaction(id).catch((err) => log.error({ err, transaction_id: id }, 'matching gagal'));
  const devices = createDeviceService({ db, settings, log });
  const notifications = createNotificationService({ db, log, onNewTransaction: runMatch });
  const orders = createOrderService({
    db, settings, log,
    onNewOrder: (o) => matching.matchForOrder(o).catch((err) => log.error({ err, order_id: o.order_id }, 'matching order gagal')),
  });
  const alerts = createAlertService({ db, settings, devices, log, telegramBotToken: config.telegramBotToken, fetchImpl });
  const reports = createReportService({ db, settings });
  const identity = verifier ?? createIdentityVerifier(config);

  const services = { db, settings, webhooks, matching, devices, notifications, orders, alerts, reports, identity, config };
  app.decorate('services', services);
  app.decorateRequest('user', null);
  app.decorateRequest('device', null);
  app.decorateRequest('apiClient', null);

  // ------------------------------------------------------------ plugins
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-api-key', 'x-request-time', 'idempotency-key'],
    exposedHeaders: ['content-disposition'],
  });
  await app.register(rateLimit, {
    global: true,
    max: 1200,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, code: 'RATE_LIMITED', message: `Terlalu banyak request, coba lagi dalam ${ctx.after}` }),
  });

  registerAuth(app, { db, config, verifier: identity, deviceService: devices, settings });

  app.setErrorHandler((err, req, reply) => {
    if (err.validation) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: err.message, details: err.validation } });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.code === '23505') {
      return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'Data duplikat ditolak oleh database' } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: err.code ?? 'REQUEST_ERROR', message: err.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server' } });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} tidak ada` } }));

  // ------------------------------------------------------------ routes
  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ ok: true, time: new Date().toISOString() }));
  app.get('/readyz', { config: { rateLimit: false } }, async (req, reply) => {
    try {
      await db.one('SELECT 1 AS ok');
      return { ok: true, db: db.kind };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  await app.register(androidRoutes, { prefix: '/api/v1' });
  await app.register(posRoutes, { prefix: '/api/v1/pos' });
  await app.register(dashboardDeviceRoutes, { prefix: '/api/v1' });
  await app.register(dashboardTransactionRoutes, { prefix: '/api/v1' });
  await app.register(dashboardAdminRoutes, { prefix: '/api/v1' });

  return app;
}
