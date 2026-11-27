// Dashboard: Bank Source Management (§5.8), Users & Settings (§5.10), webhook, API key, audit log.
import { badRequest, conflict, notFound, pageParams, pagination, randomToken, sha256 } from '../lib/util.js';
import { audit, userActor } from '../services/audit.js';
import { devUuid } from '../auth/index.js';

const uuidParam = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };

const bankSourceBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    bank_code: { type: 'string', minLength: 2, maxLength: 30, pattern: '^[A-Z0-9_]+$' },
    bank_name: { type: 'string', minLength: 2, maxLength: 100 },
    package_name: { type: 'string', minLength: 3, maxLength: 200, pattern: '^[a-zA-Z0-9_.]+$' },
    account_alias: { type: 'string', minLength: 1, maxLength: 100 },
    account_identifier: { type: ['string', 'null'], maxLength: 40 },
    account_holder: { type: ['string', 'null'], maxLength: 200 },
    parser_key: { type: ['string', 'null'], maxLength: 60 },
    is_default: { type: 'boolean' },
    is_active: { type: 'boolean' },
  },
};

export default async function dashboardAdminRoutes(app) {
  const { db, settings, webhooks, identity } = app.services;
  const anyUser = { preHandler: app.requireUser() };
  const adminOnly = { preHandler: app.requireUser(['admin']) };

  // ---------------------------------------------------------------- bank sources
  app.get('/bank-sources', anyUser, async () => ({
    data: await db.many(
      `SELECT bs.*, (SELECT count(*) FROM notification_events ne WHERE ne.bank_source_id = bs.id AND ne.parse_status = 'ERROR'
                     AND ne.server_received_at > now() - interval '7 days') AS parse_errors_7d,
              (SELECT count(*) FROM incoming_transactions t WHERE t.bank_source_id = bs.id) AS transaction_count
       FROM bank_sources bs ORDER BY bs.bank_code, bs.account_alias`,
    ),
  }));

  app.post('/bank-sources', {
    ...adminOnly,
    schema: { body: { ...bankSourceBody, required: ['bank_code', 'bank_name', 'package_name', 'account_alias'] } },
  }, async (req, reply) => {
    const b = req.body;
    const row = await db.tx(async (tx) => {
      const r = await tx.one(
        `INSERT INTO bank_sources (bank_code, bank_name, package_name, account_alias, account_identifier, account_holder, parser_key, is_default, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (package_name, account_alias) DO NOTHING RETURNING *`,
        [b.bank_code, b.bank_name, b.package_name, b.account_alias, b.account_identifier ?? null, b.account_holder ?? null,
          b.parser_key ?? b.bank_code.toLowerCase(), b.is_default ?? true, b.is_active ?? true],
      );
      if (!r) throw conflict('Kombinasi package & alias rekening sudah ada');
      if (r.is_default) await tx.query('UPDATE bank_sources SET is_default = FALSE WHERE package_name = $1 AND id <> $2', [r.package_name, r.id]);
      await audit(tx, { actor: userActor(req.user), action: 'bank_source.create', entityType: 'bank_source', entityId: r.id, after: b, req });
      return r;
    });
    return reply.status(201).send(row);
  });

  app.patch('/bank-sources/:id', { ...adminOnly, schema: { params: uuidParam, body: bankSourceBody } }, async (req) => {
    const b = req.body;
    return db.tx(async (tx) => {
      const before = await tx.one('SELECT * FROM bank_sources WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!before) throw notFound('Sumber bank tidak ditemukan');
      const fields = ['bank_code', 'bank_name', 'package_name', 'account_alias', 'account_identifier', 'account_holder', 'parser_key', 'is_default', 'is_active'];
      const sets = [];
      const params = [req.params.id];
      for (const f of fields) if (f in b) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
      if (!sets.length) return before;
      const r = await tx.one(`UPDATE bank_sources SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, params);
      if (b.is_default) await tx.query('UPDATE bank_sources SET is_default = FALSE WHERE package_name = $1 AND id <> $2', [r.package_name, r.id]);
      await audit(tx, { actor: userActor(req.user), action: 'bank_source.update', entityType: 'bank_source', entityId: r.id, before, after: b, req });
      return r;
    });
  });

  app.get('/bank-sources/:id/notifications', { ...anyUser, schema: { params: uuidParam } }, async (req) => ({
    data: await db.many(
      `SELECT id, event_id, title, text, classification, parse_status, parse_error, parser_version, parsed, server_received_at, transaction_id
       FROM notification_events WHERE bank_source_id = $1 ORDER BY server_received_at DESC LIMIT 50`,
      [req.params.id],
    ),
  }));

  // ---------------------------------------------------------------- settings
  app.get('/settings', anyUser, async () => ({ data: await settings.describe() }));

  app.put('/settings', {
    ...adminOnly,
    schema: { body: { type: 'object', required: ['values'], properties: { values: { type: 'object' } } } },
  }, async (req) => {
    const entries = Object.entries(req.body.values);
    if (!entries.length) throw badRequest('Tidak ada pengaturan yang diubah');
    if (entries.some(([k]) => k === 'webhook.secret')) throw badRequest('Gunakan endpoint rotate-secret untuk mengganti webhook secret');
    const before = await settings.all();
    await db.tx(async (tx) => {
      for (const [k, v] of entries) await settings.set(k, v, req.user.id, tx);
      await audit(tx, {
        actor: userActor(req.user), action: 'settings.update', entityType: 'settings',
        before: Object.fromEntries(entries.map(([k]) => [k, before[k]])), after: req.body.values, req,
      });
    });
    settings.invalidate();
    return { data: await settings.describe() };
  });

  app.post('/settings/webhook/rotate-secret', adminOnly, async (req) => {
    const secret = `whsec_${randomToken(32)}`;
    await db.tx(async (tx) => {
      await settings.set('webhook.secret', secret, req.user.id, tx);
      await audit(tx, { actor: userActor(req.user), action: 'webhook.rotate_secret', entityType: 'settings', entityId: 'webhook.secret', req });
    });
    settings.invalidate();
    // Secret hanya ditampilkan sekali — simpan di konfigurasi POS.
    return { secret };
  });

  app.post('/settings/webhook/test', adminOnly, async () => webhooks.sendTest());

  // ---------------------------------------------------------------- webhook deliveries
  app.get('/webhook-deliveries', anyUser, async (req) => {
    const { page, pageSize, offset } = pageParams(req.query);
    const params = [];
    let where = '';
    if (req.query.status) { params.push(String(req.query.status).toUpperCase().split(',')); where = `WHERE w.status = ANY($1::text[])`; }
    const total = (await db.one(`SELECT count(*) AS n FROM webhook_deliveries w ${where}`, params)).n;
    const rows = await db.many(
      `SELECT w.*, o.order_id AS pos_order_id, t.transaction_code FROM webhook_deliveries w
       LEFT JOIN pos_orders o ON o.id = w.order_id LEFT JOIN incoming_transactions t ON t.id = w.transaction_id
       ${where} ORDER BY w.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    return { data: rows, pagination: pagination(page, pageSize, total) };
  });

  app.post('/webhook-deliveries/:id/retry', { ...adminOnly, schema: { params: uuidParam } }, async (req) => {
    const r = await webhooks.retry(req.params.id);
    await audit(db, { actor: userActor(req.user), action: 'webhook.retry', entityType: 'webhook_delivery', entityId: req.params.id, req });
    return r;
  });

  // ---------------------------------------------------------------- API clients (POS)
  app.get('/api-clients', adminOnly, async () => ({
    data: await db.many('SELECT id, name, key_prefix, scopes, is_active, last_used_at, created_at, revoked_at FROM api_clients ORDER BY created_at DESC'),
  }));

  app.post('/api-clients', {
    ...adminOnly,
    schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 2, maxLength: 100 } } } },
  }, async (req, reply) => {
    const key = `btm_pos_${randomToken(32)}`;
    const row = await db.tx(async (tx) => {
      const r = await tx.one(
        `INSERT INTO api_clients (name, key_prefix, key_hash, created_by) VALUES ($1,$2,$3,$4)
         RETURNING id, name, key_prefix, scopes, is_active, created_at`,
        [req.body.name, key.slice(0, 12), sha256(key), req.user.id],
      );
      await audit(tx, { actor: userActor(req.user), action: 'api_client.create', entityType: 'api_client', entityId: r.id, after: { name: r.name }, req });
      return r;
    });
    return reply.status(201).send({ ...row, api_key: key });
  });

  app.post('/api-clients/:id/revoke', { ...adminOnly, schema: { params: uuidParam } }, async (req) => db.tx(async (tx) => {
    const r = await tx.one(`UPDATE api_clients SET is_active = FALSE, revoked_at = now() WHERE id = $1 RETURNING id, name, revoked_at`, [req.params.id]);
    if (!r) throw notFound('API client tidak ditemukan');
    await audit(tx, { actor: userActor(req.user), action: 'api_client.revoke', entityType: 'api_client', entityId: r.id, req });
    return r;
  }));

  // ---------------------------------------------------------------- users
  app.get('/users', adminOnly, async () => ({
    data: await db.many('SELECT id, email, full_name, role, is_active, last_login_at, created_at FROM users ORDER BY created_at'),
  }));

  app.post('/users', {
    ...adminOnly,
    schema: {
      body: {
        type: 'object', required: ['email', 'role'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 200 },
          full_name: { type: ['string', 'null'], maxLength: 200 },
          role: { type: 'string', enum: ['admin', 'operator'] },
          password: { type: ['string', 'null'], minLength: 8, maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    const email = req.body.email.toLowerCase();
    if (await db.one('SELECT 1 AS x FROM users WHERE email = $1', [email])) throw conflict('Email sudah terdaftar');
    let authId;
    let invited = false;
    if (identity.mode === 'dev') {
      authId = devUuid(email);
    } else if (req.body.password) {
      const { data, error } = await identity.admin.createUser({ email, password: req.body.password, email_confirm: true });
      if (error) throw badRequest(`Gagal membuat akun Supabase: ${error.message}`);
      authId = data.user.id;
    } else {
      const { data, error } = await identity.admin.inviteUserByEmail(email, {
        redirectTo: `${app.services.config.dashboardUrl}/reset-password?mode=invite`,
      });
      if (error) throw badRequest(`Gagal mengirim undangan: ${error.message}`);
      authId = data.user.id;
      invited = true;
    }
    const row = await db.tx(async (tx) => {
      const r = await tx.one(
        `INSERT INTO users (id, email, full_name, role) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, role = EXCLUDED.role, is_active = TRUE
         RETURNING id, email, full_name, role, is_active, created_at`,
        [authId, email, req.body.full_name ?? null, req.body.role],
      );
      await audit(tx, { actor: userActor(req.user), action: 'user.create', entityType: 'user', entityId: r.id, after: { email, role: r.role }, req });
      return r;
    });
    return reply.status(201).send({ ...row, invited });
  });

  app.patch('/users/:id', {
    ...adminOnly,
    schema: {
      params: uuidParam,
      body: { type: 'object', properties: { role: { type: 'string', enum: ['admin', 'operator'] }, is_active: { type: 'boolean' }, full_name: { type: ['string', 'null'], maxLength: 200 } } },
    },
  }, async (req) => {
    if (req.params.id === req.user.id && (req.body.role === 'operator' || req.body.is_active === false)) {
      throw badRequest('Tidak dapat menurunkan role atau menonaktifkan akun sendiri');
    }
    return db.tx(async (tx) => {
      const before = await tx.one('SELECT id, email, role, is_active, full_name FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!before) throw notFound('Pengguna tidak ditemukan');
      const r = await tx.one(
        `UPDATE users SET role = COALESCE($2, role), is_active = COALESCE($3, is_active), full_name = COALESCE($4, full_name), updated_at = now()
         WHERE id = $1 RETURNING id, email, full_name, role, is_active, last_login_at, created_at`,
        [req.params.id, req.body.role ?? null, req.body.is_active ?? null, req.body.full_name ?? null],
      );
      const admins = await tx.one(`SELECT count(*) AS n FROM users WHERE role = 'admin' AND is_active`);
      if (admins.n === 0) throw badRequest('Minimal harus ada satu admin aktif');
      await audit(tx, { actor: userActor(req.user), action: 'user.update', entityType: 'user', entityId: r.id, before, after: req.body, req });
      return r;
    });
  });

  // ---------------------------------------------------------------- audit log
  app.get('/audit-logs', adminOnly, async (req) => {
    const { page, pageSize, offset } = pageParams(req.query, { defaultSize: 50 });
    const where = [];
    const params = [];
    if (req.query.entity_type) { params.push(req.query.entity_type); where.push(`entity_type = $${params.length}`); }
    if (req.query.entity_id) { params.push(req.query.entity_id); where.push(`entity_id = $${params.length}`); }
    if (req.query.action) { params.push(`${req.query.action}%`); where.push(`action LIKE $${params.length}`); }
    if (req.query.actor_type) { params.push(req.query.actor_type); where.push(`actor_type = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await db.one(`SELECT count(*) AS n FROM audit_logs ${whereSql}`, params)).n;
    const rows = await db.many(`SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`, params);
    return { data: rows, pagination: pagination(page, pageSize, total) };
  });
}
