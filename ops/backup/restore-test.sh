#!/usr/bin/env bash
# Tes restore bulanan (PRD §11): dekripsi backup terbaru, restore ke database sementara, cek isi, hapus.
# Kebutuhan: PostgreSQL lokal untuk uji (mis. `apt install postgresql`), gpg dengan PRIVATE key penerima
# (simpan private key HANYA di mesin uji restore / laptop admin bila memungkinkan).
# Cron (tanggal 1, 03:30):  30 3 1 * * /opt/btm/ops/backup/restore-test.sh >> /var/log/btm-restore-test.log 2>&1
set -euo pipefail

CONFIG_FILE="${BTM_BACKUP_CONFIG:-/etc/btm/backup.env}"
# shellcheck disable=SC1090
[ -f "$CONFIG_FILE" ] && source "$CONFIG_FILE"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/btm}"
RESTORE_ADMIN_URL="${RESTORE_ADMIN_URL:-postgresql://postgres@localhost:5432/postgres}"
file="${1:-$(ls -1t "$BACKUP_DIR"/daily/*.dump.gpg | head -n1)}"
db="btm_restore_test_$(date +%Y%m%d%H%M%S)"
tmp="$(mktemp -d)"
cleanup() {
  psql "$RESTORE_ADMIN_URL" -qc "DROP DATABASE IF EXISTS ${db};" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

echo "[$(date -Is)] uji restore: $file"
sha256sum -c "$file.sha256"
gpg --batch --yes --output "$tmp/restore.dump" --decrypt "$file"

psql "$RESTORE_ADMIN_URL" -qc "CREATE DATABASE ${db};"
target="${RESTORE_ADMIN_URL%/*}/${db}"
pg_restore --no-owner --no-privileges --dbname="$target" "$tmp/restore.dump"

echo "Isi hasil restore:"
psql "$target" -At -c "
  SELECT 'incoming_transactions', count(*) FROM incoming_transactions UNION ALL
  SELECT 'pos_orders', count(*) FROM pos_orders UNION ALL
  SELECT 'payment_matches', count(*) FROM payment_matches UNION ALL
  SELECT 'devices', count(*) FROM devices UNION ALL
  SELECT 'audit_logs', count(*) FROM audit_logs UNION ALL
  SELECT 'schema_migrations', count(*) FROM schema_migrations;"

# Sanity: tidak ada order dibayar dua kali dan tidak ada transaksi dipakai dua kali.
dups="$(psql "$target" -At -c "
  SELECT (SELECT count(*) FROM (SELECT order_id FROM payment_matches WHERE status IN ('MATCHED','MANUAL_VERIFIED') GROUP BY 1 HAVING count(*) > 1) a)
       + (SELECT count(*) FROM (SELECT transaction_id FROM payment_matches WHERE status IN ('MATCHED','MANUAL_VERIFIED') GROUP BY 1 HAVING count(*) > 1) b);")"
[ "$dups" = "0" ] || { echo "GAGAL: ditemukan duplikasi pembayaran ($dups)"; exit 1; }

echo "[$(date -Is)] RESTORE TEST OK ($file)"
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  curl -fsS -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=✅ Tes restore bulanan BTM OK: $(basename "$file")" >/dev/null || true
fi
