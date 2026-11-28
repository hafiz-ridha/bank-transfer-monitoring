'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuditTimeline } from '@/components/audit';
import { PosVisibilityBadge, PosVisibilityModal, posVisibilityMessage } from '@/components/pos-visibility';
import { CandidateStatusBadge, MatchStatusBadge, OrderStatusBadge, PaymentStatusBadge, ScoreBar } from '@/components/status';
import { useToast } from '@/components/toast';
import {
  Badge, Callout, Card, ConfirmModal, DataState, Empty, ErrorBox, JsonView, Loading, PageHeader, cx,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, rupiah, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { matchReasonLabel } from '@/lib/labels';
import type { Candidate, ListResponse, MatchStatus, OrderOption, TransactionDetail } from '@/lib/types';
import { routes } from '@/lib/routes';

const WEBHOOK_WARNING = (
  <>
    <b>Perhatian:</b> order akan ditandai <b>LUNAS</b> dan webhook <code>payment.matched</code> dikirim ke POS (bila webhook diaktifkan di Pengaturan).
    Transaksi yang sudah diverifikasi tidak dapat diabaikan atau dibuka kembali dari dashboard.
  </>
);

type Action =
  | { kind: 'verify'; c: Candidate }
  | { kind: 'reject'; c: Candidate }
  | { kind: 'assign' }
  | { kind: 'ignore' }
  | { kind: 'reopen' }
  | { kind: 'rematch' }
  | { kind: 'note' }
  | { kind: 'pos-visibility' };

const FINAL: MatchStatus[] = ['MATCHED', 'MANUAL_VERIFIED'];
const REMATCHABLE: MatchStatus[] = ['PENDING', 'UNMATCHED', 'REJECTED'];


export default function TransactionDetailPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TransactionDetailView />
    </Suspense>
  );
}

function TransactionDetailView() {
  const id = useSearchParams().get('id') ?? '';
  const toast = useToast();
  const { isAdmin } = useAuth();
  const state = useApi<TransactionDetail>(`/transactions/${id}`);
  const [action, setAction] = useState<Action | null>(null);

  if (state.error && !state.data) {
    return (
      <>
        <PageHeader title="Detail transaksi" breadcrumb={[{ href: '/transactions', label: 'Transaksi' }]} />
        <ErrorBox error={state.error} onRetry={() => void state.reload()} />
      </>
    );
  }
  if (!state.data) return <Loading />;

  const { transaction: t, candidates, notification: n, audit } = state.data;
  const isFinal = FINAL.includes(t.match_status);
  const canDecide = !isFinal && t.match_status !== 'IGNORED';
  const openCandidates = candidates.filter((c) => c.status === 'CANDIDATE');
  const done = async (msg: string) => {
    toast.success(msg);
    await state.reload();
  };

  return (
    <>
      <PageHeader
        breadcrumb={[{ href: '/transactions', label: 'Transaksi' }, ...(t.match_status === 'AMBIGUOUS' ? [{ href: '/verification', label: 'Verifikasi' }] : [])]}
        title={<span className="row" style={{ gap: 10 }}>{t.transaction_code} <MatchStatusBadge status={t.match_status} /></span>}
        subtitle={<>{matchReasonLabel(t.match_reason)}{t.match_score != null && <> · skor tertinggi {t.match_score}</>}</>}
        updatedAt={state.updatedAt}
        onRefresh={() => void state.reload()}
      />

      <div className="stack gap-lg">
        {t.match_status === 'AMBIGUOUS' && (
          <Callout kind="warn" title="Transaksi ambigu — perlu verifikasi manual">
            Terdapat {openCandidates.length} order kandidat atau informasi belum cukup. Pilih order yang benar, tolak kandidat yang salah,
            tautkan ke order lain, atau abaikan transaksi. Webhook pembayaran <b>belum</b> dikirim ke POS.
          </Callout>
        )}
        {isFinal && (
          <Callout kind="success" title={t.match_status === 'MATCHED' ? 'Dicocokkan otomatis' : 'Diverifikasi manual'}>
            Dibayarkan ke order <b>{t.pos_order_id}</b>{t.pos_customer_name && <> ({t.pos_customer_name})</>} pada {dateTime(t.matched_at)}.
          </Callout>
        )}
        {t.match_status === 'IGNORED' && <Callout kind="info" title="Transaksi diabaikan">Transaksi ini tidak dipakai untuk pencocokan. Gunakan “Buka kembali” bila perlu dicocokkan lagi.</Callout>}
        {!t.pos_visible && (
          <Callout kind="info" title="Disembunyikan dari API POS">
            Transaksi ini tidak muncul di daftar transaksi API POS dan tidak bisa ditautkan dari POS
            {t.pos_hidden && t.pos_hidden_at && <> · disembunyikan manual pada {dateTime(t.pos_hidden_at)}</>}
            {t.pos_hidden_rules.length > 0 && <> · cocok dengan aturan nama pengirim {t.pos_hidden_rules.map((r) => `“${r}”`).join(', ')} (Pengaturan → API POS)</>}.
          </Callout>
        )}

        <div className="grid grid-3">
          <Card title="Detail transfer" className="span-2">
            <dl className="kv">
              <dt>Nominal</dt><dd className="strong" style={{ fontSize: 18 }}>{rupiah(t.amount)}</dd>
              <dt>Nama pengirim</dt><dd>{t.sender_name ?? '-'}</dd>
              <dt>Bank / rekening</dt><dd>{t.bank_code} · {t.account_alias ?? '-'}</dd>
              <dt>Rekening penerima</dt><dd>{t.recipient_account ?? '-'}</dd>
              <dt>No. referensi</dt><dd className="mono">{t.reference_number ?? '-'}</dd>
              <dt>Waktu transaksi</dt><dd>{t.transaction_time ? dateTime(t.transaction_time) : 'Tidak terbaca dari notifikasi'}</dd>
              <dt>Waktu diterima</dt><dd>{dateTime(t.received_time)} <span className="muted">({timeAgo(t.received_time)})</span></dd>
              <dt>Jenis notifikasi</dt><dd>{t.notification_type ?? '-'}</dd>
              <dt>Versi parser</dt><dd>{t.parser_version ?? '-'}</dd>
              <dt>POS Order ID</dt><dd>{t.pos_order_id ? <span className="mono">{t.pos_order_id}</span> : '-'}</dd>
              <dt>Dicocokkan pada</dt><dd>{dateTime(t.matched_at)}</dd>
              <dt>API POS</dt><dd><PosVisibilityBadge t={t} /></dd>
              <dt>Catatan</dt><dd>{t.note ? <span style={{ whiteSpace: 'pre-wrap' }}>{t.note}</span> : <span className="faint">Belum ada catatan</span>}</dd>
            </dl>
          </Card>

          <Card title="Tindakan" hint="Semua tindakan tercatat di audit log">
            <div className="stack" style={{ gap: 8 }}>
              <button type="button" className="btn primary" disabled={!canDecide} onClick={() => setAction({ kind: 'assign' })}>🔗 Tautkan ke order lain</button>
              <button type="button" className="btn" disabled={!REMATCHABLE.includes(t.match_status)} onClick={() => setAction({ kind: 'rematch' })}>↻ Cocokkan ulang</button>
              <button type="button" className="btn danger-outline" disabled={!canDecide} onClick={() => setAction({ kind: 'ignore' })}>🚫 Abaikan transaksi</button>
              <button type="button" className="btn" disabled={!['IGNORED', 'REJECTED'].includes(t.match_status)} onClick={() => setAction({ kind: 'reopen' })}>↩ Buka kembali</button>
              <button type="button" className="btn" onClick={() => setAction({ kind: 'note' })}>📝 {t.note ? 'Ubah catatan' : 'Tambah catatan'}</button>
              <button type="button" className="btn" onClick={() => setAction({ kind: 'pos-visibility' })}>
                {t.pos_visible ? '🙈 Sembunyikan dari API POS' : '👁 Tampilkan di API POS'}
              </button>
              {isFinal && <div className="small muted">Transaksi sudah dipakai untuk pembayaran order sehingga tidak dapat diubah.</div>}
            </div>
          </Card>
        </div>

        <Card
          title={`Order kandidat (${candidates.length})`}
          hint="Skor heuristik: nominal 60 · waktu 20 · nama pengirim 15 · rekening penerima 5 (bukan probabilitas)"
        >
          {candidates.length === 0 ? (
            <Empty>Tidak ada order kandidat. {canDecide && 'Gunakan “Tautkan ke order lain” bila transfer ini milik order tertentu.'}</Empty>
          ) : (
            <>
              {canDecide && openCandidates.length > 0 && <div className="mb-2"><Callout kind="warn">{WEBHOOK_WARNING}</Callout></div>}
              {candidates.map((c) => (
                <div key={c.id} className={cx('candidate', `state-${c.status}`)}>
                  <div>
                    <div className="row" style={{ gap: 8 }}>
                      <Link href={routes.order(c.order_uuid)} className="strong mono">{c.order_id}</Link>
                      <CandidateStatusBadge status={c.status} />
                    </div>
                    <dl className="kv compact mt-1">
                      <dt>Pelanggan</dt><dd>{c.customer_name ?? '-'}</dd>
                      <dt>Nominal</dt><dd className="strong">{rupiah(c.amount)}</dd>
                      <dt>Waktu order</dt><dd>{dateTime(c.order_created_at)}</dd>
                      <dt>Batas bayar</dt><dd>{c.expires_at ? dateTime(c.expires_at) : '-'}</dd>
                      <dt>Status order</dt><dd className="row" style={{ gap: 4 }}><OrderStatusBadge status={c.order_status} /> <PaymentStatusBadge status={c.payment_status} /></dd>
                      {c.decided_at && <><dt>Diputuskan</dt><dd>{dateTime(c.decided_at)}{c.decided_by_email && <> oleh {c.decided_by_email}</>}</dd></>}
                      {c.note && <><dt>Catatan</dt><dd>{c.note}</dd></>}
                    </dl>
                  </div>
                  <div>
                    <ScoreBar score={c.score} breakdown={c.score_breakdown} />
                    {!!c.reasons?.length && (
                      <ul className="reasons">
                        {c.reasons.map((r) => <li key={r}>{r}</li>)}
                      </ul>
                    )}
                  </div>
                  <div className="acts">
                    {c.status === 'CANDIDATE' && canDecide && (
                      <>
                        <button type="button" className="btn success sm" disabled={c.payment_status === 'PAID' || c.order_status === 'CANCELLED'} onClick={() => setAction({ kind: 'verify', c })}>
                          ✓ Pilih order ini
                        </button>
                        <button type="button" className="btn danger-outline sm" onClick={() => setAction({ kind: 'reject', c })}>✕ Tolak kandidat</button>
                      </>
                    )}
                    {c.status === 'CANDIDATE' && c.payment_status === 'PAID' && <span className="small muted">Order sudah dibayar transaksi lain</span>}
                  </div>
                </div>
              ))}
            </>
          )}
        </Card>

        <Card title="Notifikasi asli" hint={n ? `Dari ${n.device_name ?? 'perangkat'} · ${n.package_name}` : undefined}>
          {!n ? (
            <Empty>Data notifikasi tidak tersedia.</Empty>
          ) : (
            <div className="stack">
              {n.raw_purged_at ? (
                <Callout kind="info">Teks notifikasi mentah sudah dihapus sesuai kebijakan retensi pada {dateTime(n.raw_purged_at)}.</Callout>
              ) : n.title || n.text || n.big_text ? (
                <div className="raw-text">
                  {n.title && <div className="strong">{n.title}</div>}
                  {n.text && <div>{n.text}</div>}
                  {n.big_text && n.big_text !== n.text && <div className="mt-1">{n.big_text}</div>}
                </div>
              ) : (
                <Callout kind="info">Perangkat tidak mengirim teks mentah (pengaturan “kirim teks notifikasi mentah” nonaktif).</Callout>
              )}
              <dl className="kv compact">
                <dt>Diposting di HP</dt><dd>{dateTime(n.posted_at)}</dd>
                <dt>Diterima HP</dt><dd>{dateTime(n.device_received_at)}</dd>
                <dt>Diterima server</dt><dd>{dateTime(n.server_received_at)}</dd>
                <dt>Parser</dt><dd>{n.parser_key ?? '-'} {n.parser_version && <span className="muted">({n.parser_version})</span>}</dd>
                <dt>Event ID</dt><dd className="mono small break">{n.event_id}</dd>
              </dl>
              <JsonView value={n.parsed} summary="Hasil parsing (JSON)" />
            </div>
          )}
        </Card>

        <Card title="Riwayat audit" flush>
          <AuditTimeline entries={audit} />
        </Card>
      </div>

      {action?.kind === 'verify' && (
        <ConfirmModal
          title="Verifikasi pembayaran"
          tone="success"
          confirmLabel="Ya, pilih order ini"
          description={<>Tandai <b>{t.transaction_code}</b> ({rupiah(t.amount)}, {t.sender_name ?? 'tanpa nama'}) sebagai pembayaran order <b>{action.c.order_id}</b> ({action.c.customer_name ?? '-'})?</>}
          warning={WEBHOOK_WARNING}
          onClose={() => setAction(null)}
          onConfirm={async (note) => {
            await api.post(`/matches/${action.c.id}/verify`, { note });
            await done(`Order ${action.c.order_id} ditandai lunas (manual verified).`);
          }}
        />
      )}
      {action?.kind === 'reject' && (
        <ConfirmModal
          title="Tolak kandidat"
          tone="danger"
          confirmLabel="Tolak kandidat"
          description={<>Order <b>{action.c.order_id}</b> ({action.c.customer_name ?? '-'}) bukan pembayaran untuk transfer ini? Kandidat tidak akan diusulkan lagi untuk transaksi ini.</>}
          notePlaceholder="Mis. nama pengirim berbeda dengan pelanggan"
          onClose={() => setAction(null)}
          onConfirm={async (note) => {
            const r = await api.post<{ transaction_status: MatchStatus }>(`/matches/${action.c.id}/reject`, { note });
            await done(`Kandidat ${action.c.order_id} ditolak${r?.transaction_status ? ` · status transaksi: ${r.transaction_status}` : ''}`);
          }}
        />
      )}
      {action?.kind === 'assign' && <AssignModal txId={t.id} amount={t.amount} onClose={() => setAction(null)} onDone={done} />}
      {action?.kind === 'ignore' && (
        <ConfirmModal
          title="Abaikan transaksi"
          tone="danger"
          confirmLabel="Abaikan"
          description={<>Transaksi <b>{t.transaction_code}</b> tidak akan dicocokkan ke order mana pun (mis. transfer pribadi / bukan penjualan). Kandidat yang ada dinyatakan tidak berlaku.</>}
          notePlaceholder="Alasan diabaikan"
          onClose={() => setAction(null)}
          onConfirm={async (note) => {
            await api.post(`/transactions/${t.id}/ignore`, { note });
            await done('Transaksi diabaikan');
          }}
        />
      )}
      {action?.kind === 'reopen' && (
        <ConfirmModal
          title="Buka kembali transaksi"
          confirmLabel="Buka kembali"
          description="Transaksi dikembalikan ke antrean dan pencocokan otomatis dijalankan ulang."
          onClose={() => setAction(null)}
          onConfirm={async (note) => {
            const r = await api.post<{ status?: string }>(`/transactions/${t.id}/reopen`, { note });
            await done(`Transaksi dibuka kembali${r?.status ? ` · hasil: ${r.status}` : ''}`);
          }}
        />
      )}
      {action?.kind === 'rematch' && (
        <ConfirmModal
          title="Cocokkan ulang"
          confirmLabel="Jalankan matching"
          withNote={false}
          description="Jalankan mesin pencocokan lagi untuk transaksi ini (mis. setelah order POS baru masuk). Jika tepat satu kandidat memenuhi semua aturan, order otomatis ditandai lunas dan webhook dikirim."
          onClose={() => setAction(null)}
          onConfirm={async () => {
            const r = await api.post<{ status?: string; reason?: string; skipped?: boolean }>(`/transactions/${t.id}/rematch`);
            await done(r?.skipped ? `Tidak diproses (status ${r.status})` : `Hasil matching: ${r?.status ?? '-'}${r?.reason ? ` (${matchReasonLabel(r.reason)})` : ''}`);
          }}
        />
      )}
      {action?.kind === 'note' && (
        <ConfirmModal
          title={t.note ? 'Ubah catatan transaksi' : 'Tambah catatan transaksi'}
          confirmLabel="Simpan catatan"
          noteRequired
          noteLabel="Catatan"
          initialNote={t.note ?? ''}
          notePlaceholder="Mis. pelanggan konfirmasi via WhatsApp"
          onClose={() => setAction(null)}
          onConfirm={async (note) => {
            await api.post(`/transactions/${t.id}/notes`, { note });
            await done('Catatan disimpan');
          }}
        />
      )}
      {action?.kind === 'pos-visibility' && (
        <PosVisibilityModal
          t={t}
          isAdmin={isAdmin}
          onClose={() => setAction(null)}
          onDone={async (r) => {
            const m = posVisibilityMessage(r);
            if (m.ok) toast.success(m.msg);
            else toast.info(m.msg);
            await state.reload();
          }}
        />
      )}
    </>
  );
}

function AssignModal({ txId, amount, onClose, onDone }: { txId: string; amount: number; onClose: () => void; onDone: (msg: string) => Promise<void> }) {
  const options = useApi<ListResponse<OrderOption>>(`/transactions/${txId}/order-options`);
  const [selected, setSelected] = useState('');
  const [manual, setManual] = useState('');
  const orderRef = manual.trim() || selected;

  return (
    <ConfirmModal
      size="lg"
      title="Tautkan ke order lain"
      tone="success"
      confirmLabel="Tautkan & tandai lunas"
      confirmDisabled={!orderRef}
      warning={WEBHOOK_WARNING}
      onClose={onClose}
      onConfirm={async (note) => {
        if (!orderRef) throw new Error('Pilih order terlebih dahulu');
        const r = await api.post<{ order_id: string }>(`/transactions/${txId}/assign`, { order_id: orderRef, note });
        await onDone(`Transaksi ditautkan ke order ${r?.order_id ?? orderRef} (manual verified).`);
      }}
    >
      <div className="small muted">Order belum dibayar dengan nominal sama ({rupiah(amount)}), termasuk yang sudah kedaluwarsa (transfer terlambat).</div>
      <DataState state={options} isEmpty={(d) => d.data.length === 0} empty="Tidak ada order belum dibayar dengan nominal yang sama.">
        {(d) => (
          <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table className="table compact">
              <thead><tr><th /><th>Order ID</th><th>Pelanggan</th><th>Waktu order</th><th>Batas bayar</th><th>Status</th></tr></thead>
              <tbody>
                {d.data.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => { setSelected(o.order_id); setManual(''); }}>
                    <td><input type="radio" name="order-opt" checked={selected === o.order_id && !manual} onChange={() => { setSelected(o.order_id); setManual(''); }} aria-label={o.order_id} /></td>
                    <td className="mono small">{o.order_id}</td>
                    <td>{o.customer_name ?? '-'}</td>
                    <td className="nowrap num">{dateTime(o.order_created_at, false)}</td>
                    <td className="nowrap num">{o.expires_at ? dateTime(o.expires_at, false) : '-'}</td>
                    <td><OrderStatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataState>
      <div className="field">
        <label htmlFor="manual-order">Atau ketik Order ID POS</label>
        <input id="manual-order" className="input mono" placeholder="POS-20261127-001" value={manual} onChange={(e) => setManual(e.target.value)} />
      </div>
      {orderRef && <div className="small">Order dipilih: <Badge tone="blue">{orderRef}</Badge></div>}
    </ConfirmModal>
  );
}
