#!/usr/bin/env bash
# Memperbarui Bank Transfer Monitor (API + dashboard, satu container) di aaPanel ke versi terbaru.
#   sudo bash update.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
[ -f .env ] || { echo "Belum terpasang. Jalankan install.sh dulu."; exit 1; }

if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose); else COMPOSE=(docker-compose); fi
read_env() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'\$//"; }
IMAGE="$(read_env BTM_IMAGE)"

if [[ "$IMAGE" == *":local" ]]; then
  if git -C ../.. rev-parse >/dev/null 2>&1; then
    echo "==> git pull"
    git -C ../.. pull --ff-only
  fi
fi

# .env versi lama (API saja) belum punya nilai untuk dashboard: install.sh menanyakan yang kurang
# saja (nilai lain tidak diubah), lalu build/pull & menjalankan ulang container.
if ! grep -qE '^SUPABASE_ANON_KEY=' .env || ! grep -qE '^DASHBOARD_URL=' .env; then
  echo "==> .env perlu dilengkapi untuk dashboard — menjalankan install.sh"
  if [[ "$IMAGE" == *":local" ]]; then exec bash ./install.sh; else exec bash ./install.sh --image; fi
fi

export COMPOSE_PROFILES="$(read_env COMPOSE_PROFILES)"
PORT="$(read_env BTM_PORT)"; PORT="${PORT:-4000}"

if [[ "$IMAGE" == *":local" ]]; then
  echo "==> build (dashboard + backend)"
  "${COMPOSE[@]}" build backend
  "${COMPOSE[@]}" up -d --remove-orphans
else
  echo "==> pull $IMAGE"
  "${COMPOSE[@]}" pull backend
  "${COMPOSE[@]}" up -d --no-build --remove-orphans
fi

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/readyz" >/dev/null 2>&1; then
    echo "==> OK: $(curl -fsS "http://127.0.0.1:${PORT}/readyz")"
    echo "==> Dashboard: $(read_env DASHBOARD_URL)"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 2
done
echo "[x] Aplikasi belum siap. Log:"; "${COMPOSE[@]}" logs --tail=60 backend; exit 1
