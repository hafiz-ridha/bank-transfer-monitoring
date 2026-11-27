#!/usr/bin/env bash
# Backup terenkripsi database Bank Transfer Monitor (PRD §11).
# Rotasi: harian 7, mingguan 4 (Minggu), bulanan 12 (tanggal 1). Salinan di luar VPS via rclone.
#
# Kebutuhan di VPS: postgresql-client (versi >= versi server Supabase), gpg, rclone (opsional), curl.
# Konfigurasi: salin backup.env.example -> /etc/btm/backup.env (chmod 600), lalu cron:
#   15 2 * * *  /opt/btm/ops/backup/backup.sh >> /var/log/btm-backup.log 2>&1
set -euo pipefail

CONFIG_FILE="${BTM_BACKUP_CONFIG:-/etc/btm/backup.env}"
# shellcheck disable=SC1090
[ -f "$CONFIG_FILE" ] && source "$CONFIG_FILE"

: "${DATABASE_URL:?DATABASE_URL wajib (connection string Supabase, session pooler/direct)}"
: "${GPG_RECIPIENT:?GPG_RECIPIENT wajib (key ID/email public key penerima backup)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/btm}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"          # contoh: b2:btm-backup  (kosong = tanpa salinan luar VPS)
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"

ts="$(date +%Y%m%d-%H%M%S)"
dow="$(date +%u)"   # 7 = Minggu
dom="$(date +%d)"
mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}
chmod 700 "$BACKUP_DIR"

notify() {
  local msg="$1"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=${msg}" >/dev/null || true
  fi
  if [ -n "${HEALTHCHECK_URL:-}" ]; then
    curl -fsS -m 10 "${HEALTHCHECK_URL}$( [[ "$msg" == ✅* ]] || echo /fail )" >/dev/null || true
  fi
}
trap 'notify "❌ Backup BTM GAGAL pada $(hostname) ${ts}"' ERR

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
dump="$tmp/btm-${ts}.dump"

# Hanya schema public (data aplikasi). Akun login dikelola Supabase Auth (backup Supabase sendiri).
pg_dump "$DATABASE_URL" --schema=public --format=custom --compress=9 --no-owner --no-privileges --file="$dump"
pg_restore --list "$dump" >/dev/null   # validasi arsip dapat dibaca

out="$BACKUP_DIR/daily/btm-${ts}.dump.gpg"
gpg --batch --yes --trust-model always --recipient "$GPG_RECIPIENT" --output "$out" --encrypt "$dump"
sha256sum "$out" > "$out.sha256"

[ "$dow" = "7" ] && cp "$out" "$out.sha256" "$BACKUP_DIR/weekly/"
[ "$dom" = "01" ] && cp "$out" "$out.sha256" "$BACKUP_DIR/monthly/"

prune() { # dir keep
  ls -1t "$1"/*.dump.gpg 2>/dev/null | tail -n +"$(( $2 + 1 ))" | while read -r f; do rm -f "$f" "$f.sha256"; done
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
prune "$BACKUP_DIR/monthly" "$KEEP_MONTHLY"

if [ -n "$RCLONE_REMOTE" ]; then
  rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE" --transfers 2 --checksum
fi

size="$(du -h "$out" | cut -f1)"
echo "[$(date -Is)] backup OK: $out ($size)"
notify "✅ Backup BTM OK ${ts} (${size})"
