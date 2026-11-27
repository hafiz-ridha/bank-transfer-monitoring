import 'dotenv/config';

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, def) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : def;
}

function list(v) {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(env = process.env, { validateAuth = true } = {}) {
  const config = {
    env: env.NODE_ENV ?? 'development',
    host: env.HOST ?? '0.0.0.0',
    port: int(env.PORT, 4000),
    logLevel: env.LOG_LEVEL ?? 'info',
    trustProxy: bool(env.TRUST_PROXY, true),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),

    dbDriver: env.DB_DRIVER ?? 'pg', // 'pg' | 'pglite'
    databaseUrl: env.DATABASE_URL,
    databaseSsl: bool(env.DATABASE_SSL, true),
    dbPoolMax: int(env.DB_POOL_MAX, 10),
    pgliteDataDir: env.PGLITE_DATA_DIR ?? './data/pglite',
    autoMigrate: bool(env.AUTO_MIGRATE, false),

    authMode: env.AUTH_MODE ?? 'supabase', // 'supabase' | 'dev'
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    bootstrapAdminEmails: list(env.BOOTSTRAP_ADMIN_EMAILS),

    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? '',
    jobsEnabled: bool(env.JOBS_ENABLED, true),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? '',
    // URL web dashboard untuk tautan undangan/reset password (default: origin CORS pertama).
    dashboardUrl: (env.DASHBOARD_URL ?? (env.CORS_ORIGINS ?? 'http://localhost:3000').split(',')[0]).trim().replace(/\/$/, ''),
  };

  if (config.env === 'production') {
    if (config.authMode !== 'supabase') {
      throw new Error('AUTH_MODE=dev tidak diizinkan saat NODE_ENV=production.');
    }
    if (config.dbDriver !== 'pg') {
      throw new Error('DB_DRIVER=pglite tidak diizinkan saat NODE_ENV=production.');
    }
  }
  if (validateAuth && config.authMode === 'supabase' && (!config.supabaseUrl || !config.supabaseServiceRoleKey)) {
    throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi untuk AUTH_MODE=supabase.');
  }
  return config;
}
