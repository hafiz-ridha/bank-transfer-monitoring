// Autentikasi: pengguna dashboard (Supabase Auth JWT), perangkat Android (device token), POS (API key).
import { createClient } from '@supabase/supabase-js';
import { forbidden, unauthorized, sha256, HttpError } from '../lib/util.js';

function bearer(req) {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

/** UUID deterministik dari email — hanya untuk AUTH_MODE=dev. */
function devUuid(email) {
  const h = sha256(`dev-user:${email}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function createIdentityVerifier(config) {
  if (config.authMode === 'dev') {
    return {
      mode: 'dev',
      async verify(token) {
        if (!token?.startsWith('dev:')) return null;
        const email = token.slice(4).trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null;
        return { id: devUuid(email), email };
      },
      admin: null,
    };
  }
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cache = new Map(); // tokenHash -> { identity, exp }
  return {
    mode: 'supabase',
    async verify(token) {
      if (!token) return null;
      const key = sha256(token);
      const hit = cache.get(key);
      if (hit && hit.exp > Date.now()) return hit.identity;
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) return null;
      const identity = { id: data.user.id, email: (data.user.email ?? '').toLowerCase() };
      cache.set(key, { identity, exp: Date.now() + 60_000 });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return identity;
    },
    admin: supabase.auth.admin,
  };
}

export function registerAuth(app, { db, config, verifier, deviceService, settings }) {
  async function resolveUser(identity) {
    let user = await db.one('SELECT * FROM users WHERE id = $1', [identity.id]);
    if (!user) {
      const bootstrap = config.bootstrapAdminEmails.includes(identity.email);
      const firstUser = verifier.mode === 'dev' && (await db.one('SELECT count(*) AS n FROM users')).n === 0;
      if (!bootstrap && !firstUser) return null;
      user = await db.one(
        `INSERT INTO users (id, email, role) VALUES ($1, $2, 'admin')
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email RETURNING *`,
        [identity.id, identity.email],
      );
    }
    return user;
  }

  /** preHandler: wajib login dashboard; `roles` opsional membatasi role. */
  app.decorate('requireUser', (roles = null) => async (req) => {
    const identity = await verifier.verify(bearer(req));
    if (!identity) throw unauthorized('Sesi tidak valid atau kedaluwarsa');
    const user = await resolveUser(identity);
    if (!user) throw forbidden('Akun belum terdaftar sebagai pengguna dashboard');
    if (!user.is_active) throw forbidden('Akun dinonaktifkan');
    if (roles && !roles.includes(user.role)) throw forbidden('Role Anda tidak memiliki akses untuk tindakan ini');
    req.user = user;
    if (!user.last_login_at || Date.now() - new Date(user.last_login_at).getTime() > 10 * 60_000) {
      db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]).catch(() => {});
    }
  });

  /** preHandler: perangkat Android. Proteksi replay: X-Request-Time harus dekat dengan jam server. */
  app.decorate('requireDevice', async (req) => {
    const device = await deviceService.authenticate(bearer(req));
    if (!device) throw unauthorized('Token perangkat tidak valid atau sudah dicabut', 'INVALID_DEVICE_TOKEN');
    const raw = req.headers['x-request-time'];
    if (!raw) throw new HttpError(400, 'MISSING_REQUEST_TIME', 'Header X-Request-Time wajib');
    const t = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
    const maxSkew = (await settings.get('security.max_request_skew_seconds')) * 1000;
    if (!Number.isFinite(t) || Math.abs(Date.now() - t) > maxSkew) {
      throw new HttpError(401, 'CLOCK_SKEW', 'Jam perangkat berbeda terlalu jauh dari server. Aktifkan tanggal & waktu otomatis.', { server_time: new Date().toISOString() });
    }
    req.device = device;
  });

  /** preHandler: integrasi POS lewat API key (X-API-Key). */
  app.decorate('requirePos', async (req) => {
    const key = req.headers['x-api-key'] ?? bearer(req);
    if (!key) throw unauthorized('API key wajib (header X-API-Key)', 'INVALID_API_KEY');
    const client = await db.one(
      `UPDATE api_clients SET last_used_at = now() WHERE key_hash = $1 AND is_active AND revoked_at IS NULL RETURNING id, name, scopes`,
      [sha256(String(key))],
    );
    if (!client || !(client.scopes ?? []).includes('pos')) throw unauthorized('API key tidak valid', 'INVALID_API_KEY');
    req.apiClient = client;
  });
}

export { devUuid };
