// Contoh integrasi POS (Node.js 20+, tanpa dependensi) untuk tim POS.
//   node pos-integration.mjs order 150000 "Budi Santoso"   -> buat order & tunggu lunas (polling)
//   node pos-integration.mjs webhook                       -> server penerima webhook di :8080/webhook
// Env: BTM_API_URL (mis. https://api.contoh.co.id), BTM_API_KEY, BTM_WEBHOOK_SECRET
import crypto from 'node:crypto';
import http from 'node:http';

const API = (process.env.BTM_API_URL ?? 'http://localhost:4000').replace(/\/$/, '') + '/api/v1/pos';
const KEY = process.env.BTM_API_KEY ?? '';
const SECRET = process.env.BTM_WEBHOOK_SECRET ?? '';

async function createOrder(amount, customer) {
  const now = new Date();
  const body = {
    order_id: `POS-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomInt(1000, 9999)}`,
    customer_name: customer,
    amount: Number(amount),
    payment_method: 'bank_transfer',
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
  };
  const res = await fetch(`${API}/orders`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`);
  console.log('Order dibuat:', body.order_id, '— minta pelanggan transfer Rp', body.amount.toLocaleString('id-ID'));
  // Polling cadangan (webhook tetap jalur utama). Hentikan saat lunas atau kedaluwarsa.
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const p = await (await fetch(`${API}/orders/${encodeURIComponent(body.order_id)}/payment`, { headers: { 'x-api-key': KEY } })).json();
    if (p.paid) return console.log('LUNAS:', p.transaction);
    if (p.review_pending) console.log('Ada transfer cocok tapi menunggu verifikasi admin…');
    if (['EXPIRED', 'CANCELLED'].includes(p.status)) return console.log('Order', p.status);
  }
}

/** Verifikasi signature webhook: HMAC-SHA256(secret, `${timestamp}.${rawBody}`), toleransi 5 menit. */
function verifySignature(headers, rawBody) {
  const ts = headers['x-btm-timestamp'];
  const sig = headers['x-btm-signature'] ?? '';
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(`${ts}.${rawBody}`).digest('hex');
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function webhookServer(port = 8080) {
  const processed = new Set(); // di produksi: simpan event_id di database POS (unik)
  http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhook') { res.writeHead(404).end(); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!verifySignature(req.headers, raw)) { res.writeHead(401).end('invalid signature'); return; }
      const ev = JSON.parse(raw);
      if (processed.has(ev.event_id)) { res.writeHead(200).end('duplicate'); return; }
      processed.add(ev.event_id);
      if (ev.event === 'payment.matched') {
        console.log(`Order ${ev.order_id} LUNAS Rp ${ev.amount} via ${ev.bank_code} (${ev.match_type}), trx ${ev.transaction_id}`);
        // TODO POS: tandai order lunas secara idempoten berdasarkan order_id.
      }
      res.writeHead(200).end('ok'); // balas cepat (< 10 detik)
    });
  }).listen(port, () => console.log(`Webhook receiver di http://localhost:${port}/webhook`));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'order') await createOrder(args[0] ?? 150000, args[1] ?? 'Pelanggan');
else if (cmd === 'webhook') webhookServer();
else console.log('Pakai: node pos-integration.mjs order <nominal> "<nama>" | webhook');
