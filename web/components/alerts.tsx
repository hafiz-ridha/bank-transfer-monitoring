'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { dateTime, timeAgo } from '@/lib/format';
import { ALERT_TYPE } from '@/lib/labels';
import type { Alert } from '@/lib/types';
import { AlertStatusBadge, SeverityBadge } from './status';
import { useToast } from './toast';
import { Empty, Spinner } from './ui';

/** Daftar alert perangkat (PRD §5.3) dengan tombol "Tandai diketahui". */
export function AlertList({ alerts, onChanged, emptyText = 'Tidak ada alert aktif. Semua perangkat normal.' }: {
  alerts: Alert[];
  onChanged: () => void;
  emptyText?: string;
}) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const ack = async (a: Alert) => {
    setBusyId(a.id);
    try {
      await api.post(`/alerts/${a.id}/acknowledge`);
      toast.success('Alert ditandai sudah diketahui');
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!alerts.length) return <Empty>{emptyText}</Empty>;
  return (
    <ul className="alert-list">
      {alerts.map((a) => (
        <li key={a.id} className="alert-item">
          <span className={`sev ${a.severity}`} />
          <div className="body">
            <div className="row" style={{ gap: 6 }}>
              <SeverityBadge severity={a.severity} />
              <span className="strong">{ALERT_TYPE[a.alert_type] ?? a.alert_type}</span>
              <AlertStatusBadge status={a.status} />
            </div>
            <div className="mt-1">{a.message}</div>
            <div className="meta">
              {a.device_id ? <Link href={`/devices/${a.device_id}`}>{a.device_name ?? 'Perangkat'}</Link> : a.device_name ?? '-'}
              {' · '}dibuka {dateTime(a.opened_at)} ({timeAgo(a.opened_at)})
              {a.acknowledged_at && <> · diketahui {dateTime(a.acknowledged_at)}</>}
              {a.resolved_at && <> · selesai {dateTime(a.resolved_at)}</>}
              {a.notify_count > 0 && <> · notifikasi terkirim {a.notify_count}×</>}
            </div>
          </div>
          {a.status === 'OPEN' && (
            <button type="button" className="btn sm" onClick={() => void ack(a)} disabled={busyId === a.id}>
              {busyId === a.id && <Spinner sm />} Tandai diketahui
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
