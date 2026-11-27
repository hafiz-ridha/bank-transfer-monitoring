#!/usr/bin/env bash
# Memperbarui backend Bank Transfer Monitor di aaPanel ke versi terbaru.
#   sudo bash update.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
[ -f .env ] || { echo "Belum terpasang. Jalankan install.sh dulu."; exit 1; }

if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose); else COMPOSE=(docker-compose); fi
read_env() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'\$//"; }
export COMPOSE_PROFILES="$(read_env COMPOSE_PROFILES)"
IMAGE="$(read_env BTM_IMAGE)"
PORT="$(read_env BTM_PORT)"; PORT="${PORT:-4000}"

if [[ "$IMAGE" == *":local" ]]; then
  if git -C ../.. rev-parse >/dev/null 2>&1; then
    echo "==> git pull"
    git -C ../.. pull --ff-only
  fi
  echo "==> build"
  "${COMPOSE[@]}" build backend
  "${COMPOSE[@]}" up -d
else
  echo "==> pull $IMAGE"
  "${COMPOSE[@]}" pull backend
  "${COMPOSE[@]}" up -d --no-build
fi

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/readyz" >/dev/null 2>&1; then
    echo "==> OK: $(curl -fsS "http://127.0.0.1:${PORT}/readyz")"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 2
done
echo "[x] Backend belum siap. Log:"; "${COMPOSE[@]}" logs --tail=60 backend; exit 1
