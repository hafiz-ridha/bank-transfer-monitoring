'use client';
import { dateTime } from '@/lib/format';
import type { AuditEntry } from '@/lib/types';
import { Empty, JsonView } from './ui';

export const AUDIT_ACTION: Record<string, string> = {
  'match.auto': 'Dicocokkan otomatis',
  'match.manual_verify': 'Diverifikasi manual',
  'match.reject': 'Kandidat ditolak',
  'transaction.ignore': 'Transaksi diabaikan',
  'transaction.reopen': 'Dibuka kembali',
  'transaction.note': 'Catatan diubah',
  'device.create': 'Perangkat dibuat',
  'device.register': 'Perangkat terdaftar',
  'device.update': 'Perangkat diubah',
  'device.pairing_regenerate': 'Kode pairing dibuat ulang',
  'device.token_revoke': 'Token perangkat dicabut',
  'bank_source.create': 'Sumber bank ditambahkan',
  'bank_source.update': 'Sumber bank diubah',
  'settings.update': 'Pengaturan diubah',
  'webhook.rotate_secret': 'Webhook secret dirotasi',
  'webhook.retry': 'Webhook dikirim ulang',
  'api_client.create': 'API key dibuat',
  'api_client.revoke': 'API key dicabut',
  'user.create': 'Pengguna ditambahkan',
  'user.update': 'Pengguna diubah',
  'pos.order_create': 'Order POS masuk',
  'pos.order_cancel': 'Order POS dibatalkan',
};

export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return <Empty>Belum ada riwayat.</Empty>;
  return (
    <div className="card-body">
      <ul className="timeline">
        {entries.map((a) => (
          <li key={String(a.id)}>
            <div className="small muted num">{dateTime(a.created_at)}</div>
            <div>
              <div>
                <b>{AUDIT_ACTION[a.action] ?? a.action}</b>
                <span className="muted"> · {a.actor_type === 'system' ? 'Sistem' : a.actor_label ?? a.actor_type}</span>
              </div>
              {a.note && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>“{a.note}”</div>}
              {a.after != null && <JsonView value={a.after} summary="detail" />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
