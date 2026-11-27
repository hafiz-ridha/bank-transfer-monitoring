// Dashboard + API dalam satu container: backend menyajikan static export web/out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup } from './helpers.js';

let ctx;
let apiOnly;
let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btm-web-'));
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('index.html', '<html>beranda</html>');
  write('login.html', '<html>login</html>');
  write('devices.html', '<html>daftar perangkat</html>');
  write('devices/detail.html', '<html>detail perangkat</html>');
  write('devices/__next._tree.txt', 'rsc');
  write('devices/__next.!KGFwcCk/devices/__PAGE__.txt', 'segmen');
  write('__next.!KGFwcCk/__PAGE__.txt', 'segmen-root');
  write('404.html', '<html>tidak ditemukan</html>');
  write('_next/static/chunks/app.js', 'console.log(1)');
  write('.env', 'RAHASIA=1');
  ctx = await setup({
    env: { WEB_DIST_DIR: dir, SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'anon-key-publik</script>' },
  });
  apiOnly = await setup();
});

after(async () => {
  await ctx?.close();
  await apiOnly?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dashboard: halaman disajikan dari path tanpa .html', async () => {
  const home = await ctx.call('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-type'], /text\/html/);
  assert.equal(home.raw, '<html>beranda</html>');
  assert.equal(home.headers['cache-control'], 'no-cache');

  assert.equal((await ctx.call('GET', '/login')).raw, '<html>login</html>');
  // /devices adalah file devices.html sekaligus folder devices/ — harus tetap halaman daftar.
  assert.equal((await ctx.call('GET', '/devices')).raw, '<html>daftar perangkat</html>');
  assert.equal((await ctx.call('GET', '/devices/detail?id=abc')).raw, '<html>detail perangkat</html>');
  assert.equal((await ctx.call('GET', '/devices/__next._tree.txt?_rsc=1')).raw, 'rsc');
  // Prefetch segmen Next.js 16: nama bertitik -> folder bersarang di static export.
  assert.equal((await ctx.call('GET', '/devices/__next.!KGFwcCk.devices.__PAGE__.txt?_rsc=1')).raw, 'segmen');
  assert.equal((await ctx.call('GET', '/__next.!KGFwcCk.__PAGE__.txt?_rsc=1')).raw, 'segmen-root');

  const asset = await ctx.call('GET', '/_next/static/chunks/app.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers['cache-control'], /immutable/);
});

test('dashboard: 404 HTML untuk halaman, JSON untuk API; file tersembunyi & traversal ditolak', async () => {
  const page = await ctx.call('GET', '/tidak-ada');
  assert.equal(page.status, 404);
  assert.equal(page.raw, '<html>tidak ditemukan</html>');

  const api = await ctx.call('GET', '/api/v1/tidak-ada');
  assert.equal(api.status, 404);
  assert.equal(api.body.error.code, 'NOT_FOUND');

  assert.equal((await ctx.call('GET', '/.env')).status, 404);
  assert.equal((await ctx.call('GET', '/..%2f..%2fpackage.json')).status, 404);
  assert.equal((await ctx.call('GET', '/%2e%2e/%2e%2e/package.json')).status, 404);
});

test('dashboard: API & health tetap bekerja di origin yang sama', async () => {
  assert.equal((await ctx.call('GET', '/readyz')).body.ok, true);
  const me = await ctx.call('GET', '/api/v1/me', { headers: ctx.admin });
  assert.equal(me.status, 200);
});

test('app-config.js: konfigurasi publik runtime tanpa rahasia', async () => {
  const res = await ctx.call('GET', '/app-config.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(res.raw.startsWith('window.__BTM_CONFIG__='));
  assert.ok(!res.raw.includes('</script>'), '< harus di-escape');
  const cfg = JSON.parse(res.raw.slice('window.__BTM_CONFIG__='.length).trim().replace(/;$/, ''));
  assert.deepEqual(cfg, { apiUrl: '', authMode: 'dev', supabaseUrl: 'https://abc.supabase.co', supabaseAnonKey: 'anon-key-publik</script>' });
  assert.ok(!res.raw.toLowerCase().includes('service'), 'service role key tidak boleh ikut');
});

test('mode API saja (tanpa folder dashboard): GET / menjawab info service', async () => {
  const res = await apiOnly.call('GET', '/');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.dashboard, false);
  assert.equal((await apiOnly.call('GET', '/app-config.js')).status, 404);
});
