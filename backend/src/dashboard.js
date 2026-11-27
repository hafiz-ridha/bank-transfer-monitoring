// Menyajikan web dashboard (Next.js static export, folder web/out) dari backend yang sama,
// sehingga dashboard + API berjalan di SATU container dan SATU domain (tanpa CORS).
import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';

const IMMUTABLE = 'public, max-age=31536000, immutable';

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Folder dashboard dianggap ada bila berisi index.html. */
export function dashboardRoot(config) {
  const dir = config.webDistDir ? path.resolve(config.webDistDir) : '';
  return dir && isFile(path.join(dir, 'index.html')) ? dir : null;
}

/**
 * Mendaftarkan:
 *  - GET /app-config.js : konfigurasi publik runtime (window.__BTM_CONFIG__) dari .env backend
 *  - GET /*             : file dashboard; /login -> login.html, /devices/detail -> devices/detail.html
 * Route API (/api/v1/*, /healthz, /readyz) tetap diprioritaskan oleh router Fastify.
 * @returns {Promise<string|null>} folder dashboard, atau null bila tidak ada (mode API saja)
 */
export async function registerDashboard(app, config) {
  const root = dashboardRoot(config);
  if (!root) {
    app.get('/', { config: { rateLimit: false } }, async () => ({
      service: 'Bank Transfer Monitor API',
      ok: true,
      dashboard: false,
      health: '/readyz',
    }));
    return null;
  }
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

  await app.register(fastifyStatic, { root, serve: false, cacheControl: false, dotfiles: 'ignore' });

  app.get('/app-config.js', { config: { rateLimit: false } }, async (_req, reply) => {
    const publicConfig = {
      apiUrl: '', // origin yang sama
      authMode: config.authMode === 'dev' ? 'dev' : 'supabase',
      supabaseUrl: config.supabaseUrl ?? '',
      supabaseAnonKey: config.supabaseAnonKey ?? '',
    };
    // Escape '<' agar tidak bisa menutup tag <script>.
    const json = JSON.stringify(publicConfig).replace(/</g, '\\u003c');
    return reply
      .header('cache-control', 'no-store')
      .type('application/javascript; charset=utf-8')
      .send(`window.__BTM_CONFIG__=${json};\n`);
  });

  /** URL -> path relatif file di folder dashboard, atau null. */
  function resolveFile(rawUrl) {
    let p;
    try {
      p = decodeURIComponent(rawUrl.split('?')[0].split('#')[0]);
    } catch {
      return null;
    }
    if (p.includes('\0') || !p.startsWith('/')) return null;
    const candidates = p.endsWith('/') ? [`${p}index.html`] : [p, `${p}.html`, `${p}/index.html`];
    // Prefetch segmen Next.js: client meminta /alerts/__next.!KGFwcCk.alerts.__PAGE__.txt,
    // sedangkan static export menulisnya sebagai alerts/__next.!KGFwcCk/alerts/__PAGE__.txt.
    const seg = /^(.*\/)__next\.([^/]+)\.txt$/.exec(p);
    if (seg) {
      const parts = seg[2].split('.');
      if (parts.length > 1) candidates.push(`${seg[1]}__next.${parts[0]}/${parts.slice(1).join('/')}.txt`);
    }
    for (const c of candidates) {
      const abs = path.resolve(root, `.${c}`);
      if (!abs.startsWith(rootWithSep)) continue; // cegah path traversal
      if (path.basename(abs).startsWith('.')) continue;
      if (isFile(abs)) return path.relative(root, abs).split(path.sep).join('/');
    }
    return null;
  }

  app.get('/*', { config: { rateLimit: false } }, async (req, reply) => {
    if (req.url.startsWith('/api/')) return reply.callNotFound();
    const rel = resolveFile(req.url);
    if (!rel) return reply.callNotFound();
    reply.header('cache-control', rel.startsWith('_next/static/') ? IMMUTABLE : 'no-cache');
    return reply.sendFile(rel);
  });

  return root;
}

/** Halaman 404 dashboard untuk GET non-API; null bila harus dijawab JSON. */
export function dashboardNotFound(root, req, reply) {
  if (!root || (req.method !== 'GET' && req.method !== 'HEAD')) return null;
  if (req.url.startsWith('/api/') || !isFile(path.join(root, '404.html'))) return null;
  return reply.code(404).header('cache-control', 'no-cache').type('text/html; charset=utf-8').sendFile('404.html');
}
