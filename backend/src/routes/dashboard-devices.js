// Dashboard: monitoring perangkat (PRD §5.2, §5.3) & ringkasan (§5.1)
import { pageParams, pagination } from '../lib/util.js';

const uuidParam = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };

export default async function dashboardDeviceRoutes(app) {
  const { devices, alerts, reports, db } = app.services;
  const anyUser = { preHandler: app.requireUser() };
  const adminOnly = { preHandler: app.requireUser(['admin']) };

  app.get('/me', anyUser, async (req) => {
    const { id, email, full_name, role, is_active, last_login_at } = req.user;
    return { id, email, full_name, role, is_active, last_login_at };
  });

  app.get('/dashboard/summary', anyUser, async () => {
    const summary = await reports.summary();
    const deviceList = await devices.list();
    const activeAlerts = await alerts.list({ status: 'active', limit: 20 });
    const active = deviceList.filter((d) => d.is_active);
    return {
      ...summary,
      devices: active,
      pending_queue_total: active.reduce((a, d) => a + (d.pending_queue ?? 0), 0),
      alerts: activeAlerts,
    };
  });

  app.get('/devices', anyUser, async () => ({ data: await devices.list() }));

  app.post('/devices', {
    ...adminOnly,
    schema: { body: { type: 'object', required: ['device_name'], properties: { device_name: { type: 'string', minLength: 2, maxLength: 100 } } } },
  }, async (req, reply) => {
    const r = await devices.createDevice(req.body, req.user, req);
    return reply.status(201).send({ ...r, device: await devices.get(r.device.id) });
  });

  app.get('/devices/:id', { ...anyUser, schema: { params: uuidParam } }, async (req) => devices.get(req.params.id));

  app.patch('/devices/:id', {
    ...adminOnly,
    schema: {
      params: uuidParam,
      body: { type: 'object', properties: { device_name: { type: 'string', minLength: 2, maxLength: 100 }, is_active: { type: 'boolean' } } },
    },
  }, async (req) => {
    await devices.update(req.params.id, req.body, req.user, req);
    return devices.get(req.params.id);
  });

  // Respons mutasi menyertakan data kesehatan yang sama dengan GET /devices/:id.
  app.post('/devices/:id/pairing-code', { ...adminOnly, schema: { params: uuidParam } }, async (req) => {
    const r = await devices.regeneratePairing(req.params.id, req.user, req);
    return { ...r, device: await devices.get(req.params.id) };
  });
  app.post('/devices/:id/revoke-token', { ...adminOnly, schema: { params: uuidParam } }, async (req) => {
    await devices.revokeToken(req.params.id, req.user, req);
    return devices.get(req.params.id);
  });

  app.get('/devices/:id/health', { ...anyUser, schema: { params: uuidParam } }, async (req) => {
    const d = await devices.get(req.params.id);
    const last24h = await db.one(
      `SELECT count(*) AS heartbeats,
         count(*) FILTER (WHERE listener_connected IS FALSE) AS listener_down,
         count(*) FILTER (WHERE notification_access IS FALSE) AS permission_down,
         max(pending_queue) AS max_pending_queue
       FROM device_heartbeats WHERE device_id = $1 AND received_at > now() - interval '24 hours'`,
      [d.id],
    );
    const pendingParse = await db.one(
      `SELECT count(*) AS n FROM notification_events WHERE device_id = $1 AND parse_status = 'ERROR' AND server_received_at > now() - interval '24 hours'`,
      [d.id],
    );
    return {
      device_id: d.id,
      status: d.status,
      status_reason: d.status_reason,
      status_source: d.status_source,
      connection_state: d.connection_state,
      heartbeat_age_seconds: d.heartbeat_age_seconds,
      issues: d.issues,
      checks: {
        listener_connected: d.listener_connected,
        notification_access: d.notification_access,
        network_connected: d.network_connected,
        battery_optimization_exempt: d.battery_optimization_exempt,
        background_restricted: d.background_restricted,
        pending_queue: d.pending_queue,
        failed_queue: d.failed_queue,
      },
      timestamps: {
        last_heartbeat_at: d.last_heartbeat_at,
        last_listener_connected_at: d.last_listener_connected_at,
        last_notification_at: d.last_notification_at,
        last_successful_sync_at: d.last_successful_sync_at,
        last_seen_at: d.last_seen_at,
      },
      last_error: d.last_error,
      last_24h: { ...last24h, parse_errors: pendingParse.n },
    };
  });

  app.get('/devices/:id/heartbeats', { ...anyUser, schema: { params: uuidParam } }, async (req) => {
    const { page, pageSize, offset } = pageParams(req.query, { defaultSize: 50, maxSize: 500 });
    const total = (await db.one('SELECT count(*) AS n FROM device_heartbeats WHERE device_id = $1', [req.params.id])).n;
    const rows = await db.many(
      `SELECT id, heartbeat_id, trigger, app_version, notification_access, listener_connected, network_connected,
         battery_optimization_exempt, background_restricted, pending_queue, failed_queue, last_notification_at,
         last_successful_sync_at, last_error, reported_at, received_at,
         EXTRACT(EPOCH FROM (received_at - lag(received_at) OVER (ORDER BY received_at)))::int AS gap_seconds
       FROM device_heartbeats WHERE device_id = $1 ORDER BY received_at DESC LIMIT $2 OFFSET $3`,
      [req.params.id, pageSize, offset],
    );
    return { data: rows, pagination: pagination(page, pageSize, total) };
  });

  app.get('/devices/:id/events', { ...anyUser, schema: { params: uuidParam } }, async (req) => {
    const { page, pageSize, offset } = pageParams(req.query, { defaultSize: 50, maxSize: 500 });
    const params = [req.params.id];
    let filter = '';
    if (req.query.type) {
      params.push(String(req.query.type).split(',').map((s) => s.trim().toUpperCase()));
      filter = `AND event_type = ANY($${params.length}::text[])`;
    }
    if (req.query.severity) {
      params.push(req.query.severity);
      filter += ` AND severity = $${params.length}`;
    }
    const total = (await db.one(`SELECT count(*) AS n FROM device_events WHERE device_id = $1 ${filter}`, params)).n;
    const rows = await db.many(
      `SELECT * FROM device_events WHERE device_id = $1 ${filter} ORDER BY occurred_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    return { data: rows, pagination: pagination(page, pageSize, total) };
  });

  app.get('/devices/:id/parse-errors', { ...anyUser, schema: { params: uuidParam } }, async (req) => {
    const { page, pageSize, offset } = pageParams(req.query, { defaultSize: 50 });
    const total = (await db.one(`SELECT count(*) AS n FROM notification_events WHERE device_id = $1 AND parse_status = 'ERROR'`, [req.params.id])).n;
    const rows = await db.many(
      `SELECT ne.id, ne.event_id, ne.package_name, ne.title, ne.text, ne.parser_key, ne.parser_version, ne.parse_error,
         ne.server_received_at, ne.device_received_at, bs.account_alias, bs.bank_code
       FROM notification_events ne LEFT JOIN bank_sources bs ON bs.id = ne.bank_source_id
       WHERE ne.device_id = $1 AND ne.parse_status = 'ERROR' ORDER BY ne.server_received_at DESC LIMIT $2 OFFSET $3`,
      [req.params.id, pageSize, offset],
    );
    return { data: rows, pagination: pagination(page, pageSize, total) };
  });

  app.get('/devices/:id/app-versions', { ...anyUser, schema: { params: uuidParam } }, async (req) => ({
    data: await db.many(
      `SELECT app_version, min(received_at) AS first_seen_at, max(received_at) AS last_seen_at, count(*) AS heartbeats
       FROM device_heartbeats WHERE device_id = $1 AND app_version IS NOT NULL GROUP BY app_version ORDER BY min(received_at) DESC`,
      [req.params.id],
    ),
  }));

  app.get('/alerts', anyUser, async (req) => ({
    data: await alerts.list({ status: req.query.status ?? 'active', deviceId: req.query.device_id, limit: Number(req.query.limit ?? 100) }),
  }));
  app.post('/alerts/:id/acknowledge', { ...anyUser, schema: { params: uuidParam } }, async (req) => alerts.acknowledge(req.params.id, req.user));
}
