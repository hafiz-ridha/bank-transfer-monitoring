// Endpoint untuk Android Monitoring App (PRD §8 Android)
import { forbidden } from '../lib/util.js';

const ts = { type: ['string', 'null'], format: 'date-time' };
const str = (max) => ({ type: ['string', 'null'], maxLength: max });

const notificationSchema = {
  type: 'object',
  required: ['event_id', 'package_name', 'classification', 'parse_status'],
  additionalProperties: false,
  properties: {
    event_id: { type: 'string', minLength: 8, maxLength: 100 },
    package_name: { type: 'string', minLength: 1, maxLength: 200 },
    notification_key: str(500),
    dedupe_key: str(128),
    title: str(2000),
    text: str(8000),
    big_text: str(8000),
    posted_at: ts,
    received_at: ts,
    classification: { type: 'string', enum: ['INCOMING_TRANSFER', 'OUTGOING_TRANSFER', 'NON_TRANSACTION', 'UNKNOWN'] },
    parse_status: { type: 'string', enum: ['PARSED', 'ERROR', 'IGNORED'] },
    parser_key: str(60),
    parser_version: str(60),
    parse_error: str(2000),
    parsed: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        bank_code: str(30),
        sender_name: str(300),
        amount: { type: ['integer', 'null'] },
        transaction_time: ts,
        reference_number: str(120),
        recipient_account: str(60),
        notification_type: str(60),
      },
    },
  },
};

const heartbeatSchema = {
  type: 'object',
  required: ['device_id', 'notification_access', 'listener_connected', 'reported_at'],
  additionalProperties: false,
  properties: {
    device_id: { type: 'string', maxLength: 100 },
    heartbeat_id: str(100),
    trigger: str(40),
    app_version: str(40),
    notification_access: { type: 'boolean' },
    listener_connected: { type: 'boolean' },
    network_connected: { type: 'boolean' },
    battery_optimization_exempt: { type: ['boolean', 'null'] },
    background_restricted: { type: ['boolean', 'null'] },
    pending_queue: { type: 'integer', minimum: 0, default: 0 },
    failed_queue: { type: 'integer', minimum: 0, default: 0 },
    last_notification_at: ts,
    last_listener_connected_at: ts,
    last_successful_sync_at: ts,
    last_error: str(1000),
    reported_at: { type: 'string', format: 'date-time' },
  },
};

const deviceEventSchema = {
  type: 'object',
  required: ['event_id', 'event_type', 'occurred_at'],
  additionalProperties: false,
  properties: {
    event_id: { type: 'string', minLength: 8, maxLength: 100 },
    event_type: { type: 'string', maxLength: 60 },
    severity: { type: 'string', enum: ['info', 'warning', 'error'] },
    message: str(2000),
    data: { type: ['object', 'null'] },
    occurred_at: { type: 'string', format: 'date-time' },
  },
};

export default async function androidRoutes(app) {
  const { devices, notifications } = app.services;
  const deviceAuth = { preHandler: app.requireDevice };

  app.post('/devices/register', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req) => req.ip } },
    schema: {
      body: {
        type: 'object',
        required: ['pairing_code', 'device_uuid'],
        additionalProperties: false,
        properties: {
          pairing_code: { type: 'string', minLength: 6, maxLength: 20 },
          device_uuid: { type: 'string', minLength: 8, maxLength: 100 },
          device_name: str(100),
          device_model: str(100),
          manufacturer: str(100),
          android_version: str(40),
          app_version: str(40),
        },
      },
    },
  }, async (req, reply) => {
    const { device, token } = await devices.register(req.body, req);
    const config = await devices.configFor(device);
    return reply.status(201).send({ device_id: device.id, device_uuid: device.device_uuid, device_name: device.device_name, device_token: token, config });
  });

  app.post('/devices/heartbeat', { ...deviceAuth, schema: { body: heartbeatSchema } }, async (req) => {
    if (req.body.device_id !== req.device.device_uuid) throw forbidden('device_id tidak sesuai dengan token perangkat');
    const r = await devices.heartbeat(req.device, req.body);
    const config = await devices.configFor(r.device);
    return {
      accepted: true,
      duplicate: r.duplicate,
      stale: !!r.stale,
      status: r.device.status,
      status_reason: r.device.status_reason,
      server_time: new Date().toISOString(),
      config_version: config.config_version,
      heartbeat_interval_seconds: config.heartbeat_interval_seconds,
      update_required: config.update_required,
    };
  });

  app.get('/devices/config', deviceAuth, async (req) => {
    await devices.touch(req.device.id);
    return devices.configFor(req.device);
  });

  app.post('/devices/events', {
    ...deviceAuth,
    schema: {
      body: {
        type: 'object', required: ['events'], additionalProperties: false,
        properties: { events: { type: 'array', minItems: 1, maxItems: 200, items: deviceEventSchema } },
      },
    },
  }, async (req) => ({ results: await devices.recordEvents(req.device, req.body.events) }));

  app.post('/notifications', { ...deviceAuth, schema: { body: notificationSchema } }, async (req, reply) => {
    const [r] = await notifications.ingestBatch(req.device, [req.body]);
    return reply.status(r.status === 'rejected' ? 503 : r.status === 'accepted' ? 201 : 200).send(r);
  });

  app.post('/notifications/batch', {
    ...deviceAuth,
    schema: {
      body: {
        type: 'object', required: ['events'], additionalProperties: false,
        properties: { events: { type: 'array', minItems: 1, maxItems: 100, items: notificationSchema } },
      },
    },
  }, async (req) => ({ results: await notifications.ingestBatch(req.device, req.body.events) }));

  // Informasi perangkat untuk layar Status Monitoring di Android.
  app.get('/devices/me', deviceAuth, async (req) => devices.get(req.device.id));
}
