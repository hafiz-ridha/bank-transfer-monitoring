# syntax=docker/dockerfile:1
# Bank Transfer Monitor — SATU image/container: backend API (Fastify) + web dashboard.
# Dashboard di-build sebagai static export lalu disajikan backend di origin yang sama:
#   https://domain/            -> dashboard (login, perangkat, transaksi, ...)
#   https://domain/api/v1/...  -> API (Android, POS, dashboard)
# Dipakai installer aaPanel (deploy/aapanel) & GitHub Actions -> GHCR. Build context: root repo.

# ---------------------------------------------------------------- dashboard
FROM node:22-alpine AS web
WORKDIR /web
ENV NEXT_TELEMETRY_DISABLED=1
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
# Konfigurasi Supabase / mode auth TIDAK ditanam saat build: dibaca runtime dari /app-config.js.
RUN npm run build

# ---------------------------------------------------------------- dependensi backend
FROM node:22-alpine AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---------------------------------------------------------------- runtime
FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    WEB_DIST_DIR=/app/web
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY --from=web /web/out ./web
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/readyz" >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
