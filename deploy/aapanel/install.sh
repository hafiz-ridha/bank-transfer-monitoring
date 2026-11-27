#!/usr/bin/env bash
# =====================================================================
# Installer Backend Bank Transfer Monitor untuk aaPanel (Docker)
#
#   cd /www/dk_project
#   git clone https://github.com/hafiz-ridha/bank-transfer-monitoring.git
#   cd bank-transfer-monitoring/deploy/aapanel && sudo bash install.sh
#
# Opsi:
#   --reconfigure   tulis ulang .env walau sudah ada
#   --image         pakai image siap pakai dari GHCR (tanpa build di server)
# Non-interaktif: set variabel lingkungan yang sama dengan nama di .env sebelum menjalankan
# (DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOOTSTRAP_ADMIN_EMAILS, CORS_ORIGINS, ...)
# dan BTM_NONINTERACTIVE=1.
# =====================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
ENV_FILE="$SCRIPT_DIR/.env"
DEFAULT_IMAGE="ghcr.io/hafiz-ridha/bank-transfer-monitoring-backend:latest"
RECONFIGURE=0
USE_IMAGE=0
for arg in "$@"; do
  case "$arg" in
    --reconfigure) RECONFIGURE=1 ;;
    --image) USE_IMAGE=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Opsi tidak dikenal: $arg"; exit 1 ;;
  esac
done

c_green='\033[0;32m'; c_yellow='\033[1;33m'; c_red='\033[0;31m'; c_bold='\033[1m'; c_off='\033[0m'
info() { echo -e "${c_green}==>${c_off} $*"; }
warn() { echo -e "${c_yellow}[!]${c_off} $*"; }
die()  { echo -e "${c_red}[x]${c_off} $*" >&2; exit 1; }

# ------------------------------------------------------------------ prasyarat
command -v docker >/dev/null 2>&1 || die "Docker belum terpasang. Pasang lewat aaPanel > App Store > Docker, lalu jalankan ulang."
docker info >/dev/null 2>&1 || die "Docker tidak dapat diakses. Jalankan dengan sudo/root, dan pastikan service Docker berjalan."
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  case "$(docker-compose version --short 2>/dev/null)" in
    1.*) die "docker-compose v1 tidak didukung. Perbarui Docker di aaPanel agar memakai Docker Compose v2." ;;
  esac
  COMPOSE=(docker-compose)
else
  die "Docker Compose tidak ditemukan. Perbarui Docker di aaPanel (Compose v2 disarankan)."
fi
command -v curl >/dev/null 2>&1 || die "curl dibutuhkan (apt install curl / yum install curl)."

if [ -d "$SCRIPT_DIR/../../backend" ] && [ "$USE_IMAGE" = "0" ]; then
  SOURCE_MODE="build"
else
  SOURCE_MODE="image"
fi

# `head` menutup pipa lebih dulu -> SIGPIPE pada `tr`; jangan biarkan pipefail menghentikan skrip.
random_secret() {
  local s
  s="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c "${1:-32}")" || true
  [ "${#s}" -ge 16 ] || die "Gagal membuat password acak."
  printf '%s' "$s"
}

# ask VAR "Pertanyaan" "default" [secret]
ask() {
  local var="$1" prompt="$2" def="${3:-}" secret="${4:-}" val=""
  if [ -n "${!var:-}" ]; then return 0; fi
  if [ "${BTM_NONINTERACTIVE:-0}" = "1" ]; then
    printf -v "$var" '%s' "$def"; return 0
  fi
  while :; do
    if [ -n "$secret" ]; then
      read -r -s -p "$prompt: " val; echo
    else
      read -r -p "$prompt${def:+ [$def]}: " val
    fi
    val="${val:-$def}"
    [ -n "$val" ] && break
    warn "Wajib diisi."
  done
  printf -v "$var" '%s' "$val"
}

# Nilai .env ditulis dengan kutip tunggal agar karakter khusus tidak diinterpolasi.
env_line() {
  local key="$1" val="$2"
  case "$val" in *"'"*) die "Nilai $key tidak boleh mengandung tanda kutip tunggal (')." ;; esac
  printf "%s='%s'\n" "$key" "$val"
}

port_in_use() {
  if command -v ss >/dev/null 2>&1; then ss -ltn | awk '{print $4}' | grep -qE "[:.]$1\$"; else return 1; fi
}

# ------------------------------------------------------------------ konfigurasi
if [ -f "$ENV_FILE" ] && [ "$RECONFIGURE" = "0" ]; then
  info "Memakai konfigurasi yang ada: $ENV_FILE (jalankan dengan --reconfigure untuk mengubah)."
else
  echo -e "\n${c_bold}Konfigurasi Backend Bank Transfer Monitor${c_off}\n"
  echo "Database:"
  echo "  1) Supabase PostgreSQL  (disarankan, sesuai PRD)"
  echo "  2) PostgreSQL lokal di container aaPanel"
  ask DB_CHOICE "Pilih 1/2" "1"

  if [ "$DB_CHOICE" = "2" ]; then
    POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(random_secret 32)}"
    DATABASE_URL="postgresql://btm:${POSTGRES_PASSWORD}@postgres:5432/btm"
    DATABASE_SSL="false"
    COMPOSE_PROFILES="local-db"
    ask BTM_DB_PORT "Port PostgreSQL di host (hanya 127.0.0.1, untuk backup)" "5433"
  else
    echo
    echo "Ambil dari Supabase > Project Settings > Database > Connection string (Session pooler, port 5432)."
    ask DATABASE_URL "DATABASE_URL" "" secret
    case "$DATABASE_URL" in postgres://*|postgresql://*) ;; *) die "DATABASE_URL harus diawali postgresql://";; esac
    case "$DATABASE_URL" in *:6543/*) warn "Port 6543 (transaction pooler) tidak didukung — gunakan session pooler port 5432.";; esac
    DATABASE_SSL="true"
    COMPOSE_PROFILES=""
    POSTGRES_PASSWORD=""
    BTM_DB_PORT="5433"
  fi

  echo
  echo "Supabase Auth (login dashboard): Project Settings > API."
  ask SUPABASE_URL "SUPABASE_URL (https://xxxx.supabase.co)" ""
  ask SUPABASE_SERVICE_ROLE_KEY "SUPABASE_SERVICE_ROLE_KEY (rahasia, tidak ditampilkan)" "" secret
  ask BOOTSTRAP_ADMIN_EMAILS "Email admin pertama (pisahkan koma)" ""
  ask CORS_ORIGINS "URL web dashboard (CORS), mis. https://dashboard.domainanda.com" ""
  ask BTM_PORT "Port backend di host (hanya 127.0.0.1)" "4000"
  if port_in_use "$BTM_PORT"; then warn "Port $BTM_PORT sedang dipakai proses lain — pilih port lain dengan --reconfigure bila container gagal start."; fi
  TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
  if [ "${BTM_NONINTERACTIVE:-0}" != "1" ]; then
    read -r -p "Token bot Telegram untuk alert (opsional, Enter untuk lewati): " TELEGRAM_BOT_TOKEN || true
  fi

  BTM_IMAGE_VALUE="bank-transfer-monitoring-backend:local"
  [ "$SOURCE_MODE" = "image" ] && BTM_IMAGE_VALUE="${BTM_IMAGE:-$DEFAULT_IMAGE}"

  umask 077
  {
    echo "# Dibuat oleh install.sh pada $(date -Is). Simpan rahasia ini dengan aman."
    echo "# --- Docker Compose"
    env_line COMPOSE_PROFILES "$COMPOSE_PROFILES"
    env_line BTM_IMAGE "$BTM_IMAGE_VALUE"
    env_line BTM_PORT "$BTM_PORT"
    env_line BTM_DB_PORT "$BTM_DB_PORT"
    env_line POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
    echo "# --- Aplikasi"
    env_line DATABASE_URL "$DATABASE_URL"
    env_line DATABASE_SSL "$DATABASE_SSL"
    env_line DB_POOL_MAX "10"
    env_line SUPABASE_URL "$SUPABASE_URL"
    env_line SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY"
    env_line BOOTSTRAP_ADMIN_EMAILS "$BOOTSTRAP_ADMIN_EMAILS"
    env_line CORS_ORIGINS "$CORS_ORIGINS"
    env_line TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN"
    env_line LOG_LEVEL "info"
    env_line JOBS_ENABLED "true"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  info "Konfigurasi disimpan di $ENV_FILE (chmod 600)."
fi

# Baca nilai yang dibutuhkan installer dari .env
read_env() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'\$//"; }
BTM_PORT="$(read_env BTM_PORT)"; BTM_PORT="${BTM_PORT:-4000}"
BTM_IMAGE_VALUE="$(read_env BTM_IMAGE)"
export COMPOSE_PROFILES="$(read_env COMPOSE_PROFILES)"

# ------------------------------------------------------------------ build / pull & start
if [ "$SOURCE_MODE" = "build" ] && [[ "$BTM_IMAGE_VALUE" == *":local" ]]; then
  info "Build image backend dari source (../../backend)…"
  "${COMPOSE[@]}" build backend
else
  info "Menarik image $BTM_IMAGE_VALUE …"
  if ! "${COMPOSE[@]}" pull backend; then
    warn "Gagal menarik image. Jika repository/package GHCR privat, login dulu:"
    warn "  echo <GITHUB_PAT_read:packages> | docker login ghcr.io -u <username> --password-stdin"
    die "Pull image gagal."
  fi
fi

info "Menjalankan container…"
if [ "$SOURCE_MODE" = "build" ]; then
  "${COMPOSE[@]}" up -d
else
  "${COMPOSE[@]}" up -d --no-build
fi

info "Menunggu backend siap (migrasi database berjalan otomatis)…"
ok=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${BTM_PORT}/readyz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != "1" ]; then
  warn "Backend belum siap dalam 120 detik. Log terakhir:"
  "${COMPOSE[@]}" logs --tail=60 backend || true
  die "Periksa DATABASE_URL / SUPABASE_* di $ENV_FILE lalu jalankan: sudo bash install.sh --reconfigure"
fi

echo
info "${c_bold}Backend berjalan${c_off}: http://127.0.0.1:${BTM_PORT}  ($(curl -fsS "http://127.0.0.1:${BTM_PORT}/readyz"))"
cat <<EOF

Langkah berikutnya di aaPanel:
  1. Website > Add site  -> domain API, mis. api.domainanda.com (PHP: Static / tanpa PHP).
  2. Buka site tersebut > Reverse proxy > Add reverse proxy
       Target URL : http://127.0.0.1:${BTM_PORT}
       Send domain: \$host
  3. Site > SSL > Let's Encrypt, lalu aktifkan "Force HTTPS".
  4. Uji: https://api.domainanda.com/readyz  ->  {"ok":true,"db":"pg"}
  5. Di aplikasi Android isi URL server: https://api.domainanda.com
  6. Container terlihat di aaPanel > Docker > Containers (btm-backend). Log: docker logs -f btm-backend

Perintah berguna (dari folder ini):
  ${COMPOSE[*]} ps | logs -f backend | restart backend
  sudo bash update.sh        # perbarui ke versi terbaru
EOF
