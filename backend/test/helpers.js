import { createPgliteDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { randomUUID } from 'node:crypto';

export async function setup({ fetchImpl } = {}) {
  const db = await createPgliteDb();
  await migrate(db, { log: () => {} });
  const config = loadConfig({
    NODE_ENV: 'test', AUTH_MODE: 'dev', DB_DRIVER: 'pglite', BOOTSTRAP_ADMIN_EMAILS: 'admin@test.local',
    CORS_ORIGINS: 'http://localhost:3000',
  });
  const sent = [];
  const fakeFetch = fetchImpl ?? (async (url, opts) => {
    sent.push({ url, ...opts, json: JSON.parse(opts.body) });
    return new Response('ok', { status: 200 });
  });
  const app = await buildApp({ config, db, fetchImpl: fakeFetch, logger: false });
  await app.ready();

  const admin = { authorization: 'Bearer dev:admin@test.local' };
  const call = async (method, url, { headers = {}, body } = {}) => {
    const res = await app.inject({ method, url, headers, payload: body });
    let json = null;
    try { json = res.json(); } catch { /* bukan JSON */ }
    return { status: res.statusCode, body: json, raw: res.body, headers: res.headers };
  };

  /** Membuat perangkat lewat dashboard lalu registrasi dari "Android". */
  async function registerDevice(name = 'Android Monitoring 01') {
    const created = await call('POST', '/api/v1/devices', { headers: admin, body: { device_name: name } });
    const deviceUuid = `dev-${randomUUID()}`;
    const reg = await call('POST', '/api/v1/devices/register', {
      body: { pairing_code: created.body.pairing_code, device_uuid: deviceUuid, device_model: 'SM-A155F', manufacturer: 'samsung', android_version: '14', app_version: '1.0.0' },
    });
    const headers = () => ({ authorization: `Bearer ${reg.body.device_token}`, 'x-request-time': new Date().toISOString() });
    return { id: reg.body.device_id, uuid: deviceUuid, token: reg.body.device_token, headers, created, reg };
  }

  async function createBankSource(body = {}) {
    return call('POST', '/api/v1/bank-sources', {
      headers: admin,
      body: { bank_code: 'BCA', bank_name: 'Bank Central Asia', package_name: 'com.bca', account_alias: 'BCA Utama', account_identifier: '1234', ...body },
    });
  }

  async function createPosKey() {
    const r = await call('POST', '/api/v1/api-clients', { headers: admin, body: { name: 'POS Kasir' } });
    return { 'x-api-key': r.body.api_key };
  }

  function notification(overrides = {}) {
    const { parsed, ...rest } = overrides;
    return {
      event_id: randomUUID(),
      package_name: 'com.bca',
      dedupe_key: randomUUID().replace(/-/g, ''),
      title: 'Transfer Masuk',
      text: 'Dana masuk Rp 150.000 dari BUDI SANTOSO',
      received_at: new Date().toISOString(),
      classification: 'INCOMING_TRANSFER',
      parse_status: 'PARSED',
      parser_key: 'bca',
      parser_version: 'bca-1.0.0',
      parsed: { bank_code: 'BCA', sender_name: 'BUDI SANTOSO', amount: 150000, transaction_time: new Date().toISOString(), reference_number: null, ...parsed },
      ...rest,
    };
  }

  const waitFor = async (fn, { timeout = 3000, interval = 20 } = {}) => {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - start > timeout) throw new Error('waitFor timeout');
      await new Promise((r) => setTimeout(r, interval));
    }
  };

  async function close() {
    await app.close();
    await db.close();
  }

  return { app, db, call, admin, registerDevice, createBankSource, createPosKey, notification, waitFor, sent, close };
}
