// PM2 — Web Dashboard Bank Transfer Monitor
// Pemakaian (di folder web/, setelah `npm ci && npm run build`):
//   pm2 start ecosystem.config.cjs && pm2 save
// Nginx (HestiaCP) mem-proxy domain dashboard ke http://127.0.0.1:3000
module.exports = {
  apps: [
    {
      name: 'btm-web',
      cwd: __dirname,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000 -H 127.0.0.1',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        // Variabel NEXT_PUBLIC_* dibaca saat BUILD (lihat .env.production), bukan di sini.
      },
      out_file: './logs/web-out.log',
      error_file: './logs/web-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
