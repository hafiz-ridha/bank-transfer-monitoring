// PM2: pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'btm-backend',
      cwd: __dirname,
      script: 'src/index.js',
      instances: 1, // job latar (monitor perangkat, webhook) berjalan di instance ini
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      kill_timeout: 10000,
      env: { NODE_ENV: 'production' },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
