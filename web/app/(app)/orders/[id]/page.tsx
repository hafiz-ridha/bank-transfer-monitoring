'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CandidateStatusBadge, MatchStatusBadge, OrderStatusBadge, PaymentStatusBadge, ScoreBar, WebhookStatusBadge } from '@/components/status';
import { Callout, Card, Empty, ErrorBox, JsonView, Loading, PageHeader } from '@/components/ui';
import { dateTime, rupiah } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { OrderDetail } from '@/lib/types';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const state = useApi<OrderDetail>(`/orders/${encodeURIComponent(decodeURIComponent(id))}`);

  if (state.error && !state.data) {
    return (
      <>
        <PageHeader title="Detail order" breadcrumb={[{ href: '/orders', label: 'Order POS' }]} />
        <ErrorBox error={state.error} onRetry={() => void state.reload()} />
      </>
    );
  }
  if (!state.data) return <Loading />;
  const { order: o, transaction: t, candidates, webhooks } = state.data;
  const pendingReview = o.payment_status === 'UNPAID' && candidates.some((c) => c.status === 'CANDIDATE');

  return (
    <>
      <PageHeader
        breadcrumb={[{ href: '/orders', label: 'Order POS' }]}
        title={<span className="row" style={{ gap: 10 }}><span style={{ fontFamily: 'var(--mono)' }}>{o.order_id}</span> <OrderStatusBadge status={o.status} /> <PaymentStatusBadge status={o.payment_status} /></span>}
        subtitle={`${o.customer_name ?? 'Pelanggan tanpa nama'} · ${rupiah(o.amount)}`}
        updatedAt={state.updatedAt}
        onRefresh={() => void state.reload()}
      />
      <div className="stack gap-lg">
        {pendingReview && (
          <Callout kind="warn" title="Menunggu verifikasi admin">
            Ada transfer dengan nominal sama yang ambigu. POS menerima <code>review_pending: true</code> dan order belum dianggap lunas.
          </Callout>
        )}
        <div className="grid grid-2">
          <Card title="Detail order">
            <dl className="kv">
              <dt>Order ID</dt><dd className="mono">{o.order_id}</dd>
              <dt>Pelanggan</dt><dd>{o.customer_name ?? '-'}</dd>
              <dt>Nominal</dt><dd className="strong">{rupiah(o.amount)}</dd>
              <dt>Metode</dt><dd>{o.payment_method}</dd>
              <dt>Rekening tujuan</dt><dd>{o.destination_account ?? '-'}</dd>
              <dt>Waktu order</dt><dd>{dateTime(o.order_created_at)}</dd>
              <dt>Batas pembayaran</dt><dd>{o.expires_at ? dateTime(o.expires_at) : 'Tidak ada (memakai rentang default)'}</dd>
              <dt>Status</dt><dd><OrderStatusBadge status={o.status} /></dd>
              <dt>Pembayaran</dt><dd><PaymentStatusBadge status={o.payment_status} />{o.matched_by && <span className="muted"> · {o.matched_by === 'AUTO' ? 'otomatis' : 'verifikasi manual'}</span>}</dd>
              <dt>Dibayar pada</dt><dd>{dateTime(o.paid_at)}</dd>
              <dt>Diterima server</dt><dd>{dateTime(o.created_at)}</dd>
              <dt>Metadata</dt><dd><JsonView value={o.metadata} summary="metadata" /></dd>
            </dl>
          </Card>
          <Card title="Transaksi pembayaran">
            {t ? (
              <dl className="kv">
                <dt>Transaction ID</dt><dd><Link href={`/transactions/${t.id}`} className="strong">{t.transaction_code}</Link></dd>
                <dt>Status</dt><dd>{t.match_status && <MatchStatusBadge status={t.match_status} />}</dd>
                <dt>Bank / rekening</dt><dd>{t.bank_code} · {t.account_alias ?? '-'}</dd>
                <dt>Pengirim</dt><dd>{t.sender_name ?? '-'}</dd>
                <dt>Nominal</dt><dd>{rupiah(t.amount)}</dd>
                <dt>Referensi</dt><dd className="mono">{t.reference_number ?? '-'}</dd>
                <dt>Waktu transaksi</dt><dd>{dateTime(t.transaction_time)}</dd>
                <dt>Diterima</dt><dd>{dateTime(t.received_time)}</dd>
              </dl>
            ) : (
              <Empty>Belum ada transaksi yang dipakai untuk order ini.</Empty>
            )}
          </Card>
        </div>

        <Card title={`Transaksi kandidat (${candidates.length})`} flush>
          {candidates.length === 0 ? <Empty>Tidak ada transaksi kandidat.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Transaksi</th><th>Diterima</th><th>Pengirim</th><th>Bank</th><th className="num">Nominal</th><th>Skor</th><th>Status kandidat</th><th>Status transaksi</th></tr></thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.id}>
                      <td><Link href={`/transactions/${c.transaction_id}`} className="strong">{c.transaction_code}</Link></td>
                      <td className="nowrap num">{dateTime(c.received_time)}</td>
                      <td>{c.sender_name ?? '-'}</td>
                      <td>{c.bank_code}<div className="sub">{c.account_alias ?? ''}</div></td>
                      <td className="num">{rupiah(c.amount)}</td>
                      <td style={{ minWidth: 170 }}>
                        <ScoreBar score={c.score} breakdown={c.score_breakdown} compact />
                        {!!c.reasons?.length && <div className="sub">{c.reasons.join(' · ')}</div>}
                      </td>
                      <td><CandidateStatusBadge status={c.status} /></td>
                      <td><MatchStatusBadge status={c.match_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={`Pengiriman webhook ke POS (${webhooks.length})`} flush hint="Event payment.matched; kirim ulang tersedia di Pengaturan › Webhook">
          {webhooks.length === 0 ? <Empty>Belum ada webhook untuk order ini.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Event ID</th><th>Jenis</th><th>Status</th><th className="num">Percobaan</th><th>HTTP terakhir</th><th>Error terakhir</th><th>Terkirim</th><th>Dibuat</th></tr></thead>
                <tbody>
                  {webhooks.map((w) => (
                    <tr key={w.id}>
                      <td className="mono small">{w.event_id}</td>
                      <td>{w.event_type}</td>
                      <td><WebhookStatusBadge status={w.status} /></td>
                      <td className="num">{w.attempts}</td>
                      <td>{w.last_status_code ?? '-'}</td>
                      <td className="small text-red break">{w.last_error ?? ''}</td>
                      <td className="nowrap num">{dateTime(w.delivered_at)}</td>
                      <td className="nowrap num">{dateTime(w.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
