// Mengisi data demo lewat API (backend harus berjalan dengan AUTH_MODE=dev).
// Pemakaian: npm run seed:demo  [API_URL=http://localhost:4000] [ADMIN_EMAIL=admin@local.test]
// Mensimulasikan: sumber bank, perangkat Android terdaftar + heartbeat, order POS, notifikasi transfer
// (matched, ambiguous, unmatched, parsing error).
import { randomUUID } from 'node:crypto';

const API = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '') + '/api/v1';
const ADMIN = { authorization: `Bearer dev:${process.env.ADMIN_EMAIL ?? 'admin@local.test'}` };

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return json;
}

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const ahead = (min) => new Date(Date.now() + min * 60_000).toISOString();

const sources = [
  { bank_code: 'BCA', bank_name: 'Bank Central Asia', package_name: 'com.bca', account_alias: 'BCA Toko', account_identifier: '7781' },
  { bank_code: 'BRI', bank_name: 'Bank Rakyat Indonesia', package_name: 'id.co.bri.brimo', account_alias: 'BRI Operasional', account_identifier: '0412' },
  { bank_code: 'MANDIRI', bank_name: 'Bank Mandiri', package_name: 'id.bmri.livin', account_alias: 'Mandiri Utama', account_identifier: '9920' },
];

console.log('> sumber bank');
for (const s of sources) await call('POST', '/bank-sources', { headers: ADMIN, body: s });

console.log('> perangkat');
const created = await call('POST', '/devices', { headers: ADMIN, body: { device_name: 'Android Monitoring 01' } });
const deviceUuid = `demo-${randomUUID()}`;
const reg = await call('POST', '/devices/register', {
  body: { pairing_code: created.pairing_code, device_uuid: deviceUuid, device_model: 'Galaxy A15', manufacturer: 'samsung', android_version: '14', app_version: '1.0.0' },
});
const dev = () => ({ authorization: `Bearer ${reg.device_token}`, 'x-request-time': new Date().toISOString() });
await call('POST', '/devices/heartbeat', {
  headers: dev(),
  body: {
    device_id: deviceUuid, heartbeat_id: randomUUID(), trigger: 'app_open', app_version: '1.0.0', notification_access: true,
    listener_connected: true, network_connected: true, battery_optimization_exempt: true, background_restricted: false,
    pending_queue: 0, failed_queue: 0, last_listener_connected_at: ago(120), reported_at: new Date().toISOString(),
  },
});
await call('POST', '/devices/events', {
  headers: dev(),
  body: {
    events: [
      { event_id: randomUUID(), event_type: 'BOOT_COMPLETED', occurred_at: ago(180), message: 'Perangkat dinyalakan ulang' },
      { event_id: randomUUID(), event_type: 'LISTENER_CONNECTED', occurred_at: ago(179) },
      { event_id: randomUUID(), event_type: 'NETWORK_LOST', occurred_at: ago(90) },
      { event_id: randomUUID(), event_type: 'NETWORK_RESTORED', occurred_at: ago(85) },
    ],
  },
});

// Perangkat kedua yang sudah lama tidak mengirim heartbeat (untuk demo INACTIVE/alert)
const created2 = await call('POST', '/devices', { headers: ADMIN, body: { device_name: 'Android Cadangan' } });
const uuid2 = `demo-${randomUUID()}`;
const reg2 = await call('POST', '/devices/register', {
  body: { pairing_code: created2.pairing_code, device_uuid: uuid2, device_model: 'Redmi Note 13', manufacturer: 'Xiaomi', android_version: '13', app_version: '0.9.0' },
});
await call('POST', '/devices/heartbeat', {
  headers: { authorization: `Bearer ${reg2.device_token}`, 'x-request-time': new Date().toISOString() },
  body: { device_id: uuid2, app_version: '0.9.0', notification_access: true, listener_connected: false, battery_optimization_exempt: false, pending_queue: 14, reported_at: new Date().toISOString() },
});

console.log('> API key POS');
const key = await call('POST', '/api-clients', { headers: ADMIN, body: { name: 'POS Kasir (demo)' } });
const POS = { 'x-api-key': key.api_key };

console.log('> order & notifikasi');
const customers = ['Budi Santoso', 'Siti Aminah', 'Andi Wijaya', 'Rina Kartika', 'Dewi Lestari', 'Agus Salim', 'Pelanggan'];
let n = 0;
const notif = (bank, pkg, amount, sender, minAgo, extra = {}) => ({
  event_id: randomUUID(), package_name: pkg, dedupe_key: randomUUID().replace(/-/g, ''),
  title: `${bank} - Transfer Masuk`, text: `Dana masuk Rp ${amount.toLocaleString('id-ID')} dari ${sender}`,
  received_at: ago(minAgo), posted_at: ago(minAgo), classification: 'INCOMING_TRANSFER', parse_status: 'PARSED',
  parser_key: bank.toLowerCase(), parser_version: `${bank.toLowerCase()}-1.0.0`,
  parsed: { bank_code: bank, sender_name: sender.toUpperCase(), amount, transaction_time: ago(minAgo), reference_number: `${bank}${Date.now()}${n++}` },
  ...extra,
});

// 1) Order yang akan cocok otomatis
for (let i = 0; i < 8; i++) {
  const amount = 50_000 + i * 12_500 + 7;
  const name = customers[i % customers.length];
  await call('POST', '/pos/orders', { headers: POS, body: { order_id: `POS-DEMO-${Date.now()}-${i}`, customer_name: name, amount, created_at: ago(60 - i * 5), expires_at: ahead(30) } });
  const [bank, pkg] = i % 3 === 0 ? ['BRI', 'id.co.bri.brimo'] : i % 3 === 1 ? ['MANDIRI', 'id.bmri.livin'] : ['BCA', 'com.bca'];
  await call('POST', '/notifications', { headers: dev(), body: notif(bank, pkg, amount, name, 55 - i * 5) });
}
// 2) Dua order nominal sama => AMBIGUOUS
await call('POST', '/pos/orders', { headers: POS, body: { order_id: `POS-DEMO-AMB-A-${Date.now()}`, customer_name: 'Rina Kartika', amount: 125_000, created_at: ago(20), expires_at: ahead(20) } });
await call('POST', '/pos/orders', { headers: POS, body: { order_id: `POS-DEMO-AMB-B-${Date.now()}`, customer_name: 'Dewi Lestari', amount: 125_000, created_at: ago(18), expires_at: ahead(20) } });
await call('POST', '/notifications', { headers: dev(), body: notif('BCA', 'com.bca', 125_000, 'DEWI LESTARI', 10) });
// 3) Transfer tanpa order => UNMATCHED
await call('POST', '/notifications', { headers: dev(), body: notif('BCA', 'com.bca', 980_000, 'PT SUMBER REZEKI', 30) });
await call('POST', '/notifications', { headers: dev(), body: notif('BRI', 'id.co.bri.brimo', 45_500, 'JOKO', 12) });
// 4) Order masih menunggu pembayaran
await call('POST', '/pos/orders', { headers: POS, body: { order_id: `POS-DEMO-WAIT-${Date.now()}`, customer_name: 'Agus Salim', amount: 310_000, created_at: ago(3), expires_at: ahead(27) } });
// 5) Parsing error (format baru)
await call('POST', '/notifications', {
  headers: dev(),
  body: { ...notif('MANDIRI', 'id.bmri.livin', 1, 'X', 5), classification: 'UNKNOWN', parse_status: 'ERROR', parsed: null, parse_error: 'Format notifikasi tidak dikenali (livin-1.0.0)', text: 'Kamu menerima saldo Rp75.000,00 via BI-FAST' },
});

console.log('\nSelesai. Device token demo (untuk uji manual):', reg.device_token);
console.log('POS API key demo:', key.api_key);
