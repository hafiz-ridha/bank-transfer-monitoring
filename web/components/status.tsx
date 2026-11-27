'use client';
// Badge status untuk perangkat, transaksi, order, alert, webhook + bar skor matching.
import {
  ALERT_STATUS, CANDIDATE_STATUS, CONNECTION_STATE, DEVICE_STATUS, MATCH_STATUS, ORDER_STATUS, PAYMENT_STATUS,
  SEVERITY_LABEL, WEBHOOK_STATUS, severityTone, statusReasonLabel, statusSourceLabel,
} from '@/lib/labels';
import type {
  AlertStatus, CandidateStatus, ConnectionState, DeviceIssue, DeviceStatus, MatchStatus, OrderStatus, PaymentStatus,
  ScoreBreakdown, StatusSource, WebhookStatus,
} from '@/lib/types';
import { Badge, cx } from './ui';

export function DeviceStatusBadge({ status }: { status: DeviceStatus | null | undefined }) {
  const s = DEVICE_STATUS[status ?? 'UNKNOWN'] ?? DEVICE_STATUS.UNKNOWN;
  return <span className={cx('badge status-badge', s.tone)} title={s.hint}>{s.label}</span>;
}

export const deviceTone = (status: DeviceStatus | null | undefined) => (DEVICE_STATUS[status ?? 'UNKNOWN'] ?? DEVICE_STATUS.UNKNOWN).tone;

/** Sumber status: laporan eksplisit perangkat vs dugaan karena heartbeat hilang (PRD §4.3). */
export function StatusSourceNote({ source, reason }: { source: StatusSource | null | undefined; reason?: string | null }) {
  const label = statusSourceLabel(source, reason);
  return (
    <div className="small" style={{ marginTop: 3 }}>
      <span className={source === 'inferred' ? 'text-orange strong' : 'muted'}>{label}</span>
      {reason && reason !== 'ok' && <span className="muted"> · {statusReasonLabel(reason)}</span>}
    </div>
  );
}

export function ConnectionBadge({ state }: { state: ConnectionState | null | undefined }) {
  const s = CONNECTION_STATE[state ?? 'unknown'] ?? CONNECTION_STATE.unknown;
  return <Badge tone={s.tone} dot sm>{s.label}</Badge>;
}

export function IssueList({ issues, max }: { issues: DeviceIssue[] | null | undefined; max?: number }) {
  if (!issues?.length) return null;
  const shown = max ? issues.slice(0, max) : issues;
  return (
    <ul className="issues">
      {shown.map((i) => (
        <li key={i.code} className={i.severity} title={i.code}>{i.message}</li>
      ))}
      {max && issues.length > max && <li className="warning">+{issues.length - max} isu lain</li>}
    </ul>
  );
}

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  const s = MATCH_STATUS[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  const s = CANDIDATE_STATUS[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={s.tone} sm>{s.label}</Badge>;
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const s = PAYMENT_STATUS[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  const s = ALERT_STATUS[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={s.tone} sm>{s.label}</Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge tone={severityTone(severity)} sm>{SEVERITY_LABEL[severity] ?? severity}</Badge>;
}

export function WebhookStatusBadge({ status }: { status: WebhookStatus }) {
  const s = WEBHOOK_STATUS[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={s.tone} sm>{s.label}</Badge>;
}

const SCORE_PARTS: { key: keyof ScoreBreakdown; label: string; max: number }[] = [
  { key: 'amount', label: 'Nominal', max: 60 },
  { key: 'time', label: 'Waktu', max: 20 },
  { key: 'name', label: 'Nama', max: 15 },
  { key: 'account', label: 'Rekening', max: 5 },
];

/** Bar skor heuristik: nominal 60 / waktu 20 / nama 15 / rekening 5 (PRD §6.2). */
export function ScoreBar({ score, breakdown, compact }: { score: number | null | undefined; breakdown: ScoreBreakdown | null | undefined; compact?: boolean }) {
  const b = breakdown ?? { amount: 0, time: 0, name: 0, account: 0 };
  return (
    <div className="score" title="Skor heuristik, bukan probabilitas">
      <div className="score-top">
        <span className="score-value">{score ?? '-'}<span className="muted small"> / 100</span></span>
      </div>
      <div className="score-bar" aria-hidden>
        {SCORE_PARTS.map((p) => {
          const got = Math.max(0, Math.min(p.max, Number(b[p.key] ?? 0)));
          return (
            <span key={p.key} style={{ display: 'contents' }}>
              {got > 0 && <span className={`seg seg-${p.key}`} style={{ width: `${got}%` }} />}
              {p.max - got > 0 && <span className="seg seg-missing" style={{ width: `${p.max - got}%` }} />}
            </span>
          );
        })}
      </div>
      {!compact && (
        <div className="score-legend">
          {SCORE_PARTS.map((p) => (
            <span key={p.key}><span className={`sw seg-${p.key}`} />{p.label} {Number(b[p.key] ?? 0)}/{p.max}</span>
          ))}
        </div>
      )}
    </div>
  );
}
