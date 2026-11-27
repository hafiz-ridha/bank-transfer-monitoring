'use client';
import Link from 'next/link';
import { AlertList } from '@/components/alerts';
import { DeviceCard } from '@/components/devices';
import { Callout, Card, DataState, Empty, PageHeader, Stat } from '@/components/ui';
import { dateOnly, dateTime, num, rupiah, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { DashboardSummary } from '@/lib/types';

export default function DashboardPage() {
  const state = useApi<DashboardSummary>('/dashboard/summary', undefined, { poll: true });
  const s = state.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={s ? `Ringkasan hari ini, ${dateOnly(new Date())} (${s.timezone})` : 'Ringkasan hari ini'}
        updatedAt={state.updatedAt}
        onRefresh={() => void state.reload()}
        live
      />
      <DataState state={state}>
        {(d) => (
          <div className="stack gap-lg">
            {d.ambiguous_open > 0 && (
              <Callout
                kind="warn"
                title={`${num(d.ambiguous_open)} transaksi ambigu menunggu verifikasi manual`}
                action={<Link href="/verification" className="btn sm primary">Buka antrean verifikasi</Link>}
              >
                Transaksi ambigu tidak dikirim ke POS sebagai pembayaran berhasil sampai dipilih order yang benar.
              </Callout>
            )}

            <div className="grid grid-auto">
              <Stat label="Total transfer hari ini" value={num(d.today.total_count)} sub={`${num(d.today.ignored_count)} diabaikan`} href="/transactions" />
              <Stat label="Total nominal masuk" value={rupiah(d.today.total_amount)} small sub={`Matched: ${rupiah(d.today.matched_amount)}`} />
              <Stat label="Matched" tone="green" value={num(d.today.matched_count)}
                sub={`Otomatis ${num(d.today.auto_matched_count)} · Manual ${num(d.today.manual_verified_count)}`}
                href="/transactions?status=MATCHED,MANUAL_VERIFIED" />
              <Stat label="Unmatched" tone="orange" value={num(d.today.unmatched_count)} sub="Tanpa order cocok" href="/transactions?status=UNMATCHED,REJECTED,PENDING" />
              <Stat label="Ambiguous" tone="yellow" value={num(d.today.ambiguous_count)} sub={`${num(d.ambiguous_open)} menunggu verifikasi (semua hari)`} href="/verification" />
              <Stat label="Parsing error" tone={d.today.parse_error_count > 0 ? 'red' : undefined} value={num(d.today.parse_error_count)} sub="Notifikasi tidak dikenali" href="/bank-sources" />
            </div>

            <div className="grid grid-auto">
              <Stat label="Transaksi terakhir terdeteksi" small value={d.last_transaction_at ? dateTime(d.last_transaction_at) : 'Belum ada'}
                sub={d.last_transaction_at ? timeAgo(d.last_transaction_at) : undefined} />
              <Stat label="Antrean belum terkirim" tone={d.pending_queue_total > 0 ? 'yellow' : 'green'} value={num(d.pending_queue_total)} sub="Total pending queue di semua HP" href="/devices" />
              <Stat label="Order POS menunggu" value={num(d.pending_orders.n)} sub={rupiah(d.pending_orders.amount)} href="/orders?status=PENDING" />
              <Stat label="Webhook POS" tone={d.webhooks.failed > 0 ? 'red' : undefined} value={`${num(d.webhooks.failed)} gagal`} sub={`${num(d.webhooks.pending)} menunggu kirim`} href="/settings#webhook" />
            </div>

            <div>
              <div className="row-between mb-2">
                <h2>Status perangkat Android</h2>
                <Link href="/devices" className="btn sm">Monitoring perangkat →</Link>
              </div>
              {d.devices.length ? (
                <div className="grid grid-cards">
                  {d.devices.map((dev) => <DeviceCard key={dev.id} d={dev} />)}
                </div>
              ) : (
                <div className="card"><Empty>Belum ada perangkat aktif. <Link href="/devices">Tambah perangkat</Link></Empty></div>
              )}
            </div>

            <Card title="Alert aktif" hint="Perangkat tidak aktif, izin dicabut, listener terputus, antrean menumpuk, dll." flush
              actions={<Link href="/alerts" className="btn sm">Semua alert</Link>}>
              <AlertList alerts={d.alerts} onChanged={() => void state.reload()} />
            </Card>
          </div>
        )}
      </DataState>
    </>
  );
}
