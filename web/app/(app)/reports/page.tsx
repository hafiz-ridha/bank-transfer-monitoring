'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { useToast } from '@/components/toast';
import { Card, DataState, PageHeader, Spinner, Stat } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { firstOfMonthYmd, num, rupiah, todayYmd } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Report, ReportRow } from '@/lib/types';

type Gran = 'day' | 'month';

export default function ReportsPage() {
  const toast = useToast();
  const [draft, setDraft] = useState<{ granularity: Gran; from: string; to: string }>(() => ({ granularity: 'day', from: firstOfMonthYmd(), to: todayYmd() }));
  const [applied, setApplied] = useState(draft);
  const [exporting, setExporting] = useState(false);
  const query = useMemo(() => ({ ...applied }), [applied]);
  const state = useApi<Report>('/reports', query);

  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    setApplied(draft);
  };
  const preset = (granularity: Gran, from: string, to: string) => {
    const next = { granularity, from, to };
    setDraft(next);
    setApplied(next);
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      const name = await api.download('/reports/export.csv', applied, `laporan_${applied.from}_${applied.to}.csv`);
      toast.success(`File ${name} diunduh`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };
  const year = todayYmd().slice(0, 4);

  return (
    <>
      <PageHeader
        title="Laporan"
        subtitle="Rekap transfer masuk harian/bulanan, per bank, status pencocokan, dan rekonsiliasi POS."
        updatedAt={state.updatedAt}
        onRefresh={() => void state.reload()}
        actions={<button type="button" className="btn" onClick={() => void exportCsv()} disabled={exporting}>{exporting ? <Spinner sm /> : '⬇'} Export CSV</button>}
      />
      <Card className="mb-3" bodyClass="flush">
        <form className="filters" onSubmit={apply}>
          <div className="field">
            <label htmlFor="r-gran">Rekap per</label>
            <select id="r-gran" className="select" value={draft.granularity} onChange={(e) => setDraft({ ...draft, granularity: e.target.value as Gran })}>
              <option value="day">Hari</option>
              <option value="month">Bulan</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="r-from">Dari tanggal</label>
            <input id="r-from" type="date" className="input" value={draft.from} max={draft.to} onChange={(e) => setDraft({ ...draft, from: e.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="r-to">Sampai tanggal</label>
            <input id="r-to" type="date" className="input" value={draft.to} min={draft.from} onChange={(e) => setDraft({ ...draft, to: e.target.value })} required />
          </div>
          <div className="actions">
            <button type="submit" className="btn primary">Tampilkan</button>
          </div>
        </form>
        <div className="row" style={{ padding: '0 16px 14px', gap: 6 }}>
          <span className="label" style={{ marginRight: 4 }}>Cepat:</span>
          <button type="button" className="chip" onClick={() => preset('day', todayYmd(-6), todayYmd())}>7 hari</button>
          <button type="button" className="chip" onClick={() => preset('day', firstOfMonthYmd(), todayYmd())}>Bulan ini</button>
          <button type="button" className="chip" onClick={() => preset('day', todayYmd(-29), todayYmd())}>30 hari</button>
          <button type="button" className="chip" onClick={() => preset('month', `${year}-01-01`, todayYmd())}>Tahun ini (per bulan)</button>
        </div>
      </Card>

      <DataState state={state}>
        {(r) => <ReportView r={r} />}
      </DataState>
    </>
  );
}

function ReportView({ r }: { r: Report }) {
  const t = r.totals;
  const maxAmount = Math.max(1, ...r.rows.map((x) => x.amount));
  const maxBank = Math.max(1, ...r.by_bank.map((x) => x.amount));
  const pos = r.pos_reconciliation;
  return (
    <div className="stack gap-lg">
      <div className="grid grid-auto">
        <Stat label="Jumlah transfer" value={num(t.count ?? 0)} sub={`${r.from} s/d ${r.to}`} />
        <Stat label="Total nominal" value={rupiah(t.amount ?? 0)} small />
        <Stat label="Matched otomatis" tone="green" value={num(t.matched_count ?? 0)} sub={rupiah(t.matched_amount ?? 0)} />
        <Stat label="Manual verified" tone="teal" value={num(t.manual_verified_count ?? 0)} sub={rupiah(t.manual_verified_amount ?? 0)} />
        <Stat label="Unmatched" tone="orange" value={num(t.unmatched_count ?? 0)} sub={rupiah(t.unmatched_amount ?? 0)} />
        <Stat label="Ambiguous / diabaikan" tone="yellow" value={`${num(t.ambiguous_count ?? 0)} / ${num(t.ignored_count ?? 0)}`} />
      </div>

      <Card title={`Rekap per ${r.granularity === 'month' ? 'bulan' : 'hari'}`} hint={`Zona waktu ${r.timezone}`} flush>
        {r.rows.length === 0 ? <div className="empty">Tidak ada transaksi pada periode ini.</div> : (
          <>
            <div className="card-body">
              <div className="legend mb-2">
                <span><span className="sw bar-fill matched" />Matched</span>
                <span><span className="sw bar-fill manual" />Manual verified</span>
                <span><span className="sw bar-fill unmatched" />Unmatched</span>
                <span><span className="sw bar-fill other" />Ambiguous / diabaikan</span>
              </div>
              <div className="bar-chart">
                {r.rows.map((row) => <PeriodBar key={row.period} row={row} max={maxAmount} />)}
              </div>
            </div>
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Periode</th><th className="num">Transfer</th><th className="num">Total nominal</th>
                    <th className="num">Matched</th><th className="num">Nominal matched</th>
                    <th className="num">Manual</th><th className="num">Nominal manual</th>
                    <th className="num">Unmatched</th><th className="num">Nominal unmatched</th>
                    <th className="num">Ambiguous</th><th className="num">Diabaikan</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row) => (
                    <tr key={row.period}>
                      <td className="strong nowrap">{row.period}</td>
                      <td className="num">{num(row.count)}</td>
                      <td className="num strong">{rupiah(row.amount)}</td>
                      <td className="num">{num(row.matched_count)}</td>
                      <td className="num">{rupiah(row.matched_amount)}</td>
                      <td className="num">{num(row.manual_verified_count)}</td>
                      <td className="num">{rupiah(row.manual_verified_amount)}</td>
                      <td className="num">{num(row.unmatched_count)}</td>
                      <td className="num">{rupiah(row.unmatched_amount)}</td>
                      <td className="num">{num(row.ambiguous_count)}</td>
                      <td className="num">{num(row.ignored_count)}</td>
                    </tr>
                  ))}
                  <tr className="strong">
                    <td>Total</td>
                    <td className="num">{num(t.count ?? 0)}</td>
                    <td className="num">{rupiah(t.amount ?? 0)}</td>
                    <td className="num">{num(t.matched_count ?? 0)}</td>
                    <td className="num">{rupiah(t.matched_amount ?? 0)}</td>
                    <td className="num">{num(t.manual_verified_count ?? 0)}</td>
                    <td className="num">{rupiah(t.manual_verified_amount ?? 0)}</td>
                    <td className="num">{num(t.unmatched_count ?? 0)}</td>
                    <td className="num">{rupiah(t.unmatched_amount ?? 0)}</td>
                    <td className="num">{num(t.ambiguous_count ?? 0)}</td>
                    <td className="num">{num(t.ignored_count ?? 0)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <div className="grid grid-2">
        <Card title="Per bank / rekening" flush>
          {r.by_bank.length === 0 ? <div className="empty">Tidak ada data.</div> : (
            <>
              <div className="card-body">
                <div className="bar-chart">
                  {r.by_bank.map((b) => (
                    <div key={`${b.bank_code}-${b.account_alias}`} className="bar-row">
                      <span className="strong" title={b.account_alias ?? ''}>{b.bank_code}<div className="sub">{b.account_alias ?? '-'}</div></span>
                      <span className="bar-track"><span className="bar-fill blue" style={{ width: `${(b.amount / maxBank) * 100}%` }} /></span>
                      <span className="num right">{rupiah(b.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="table-wrap">
                <table className="table compact">
                  <thead><tr><th>Bank</th><th>Rekening</th><th className="num">Transfer</th><th className="num">Nominal</th><th className="num">Matched + manual</th></tr></thead>
                  <tbody>
                    {r.by_bank.map((b) => (
                      <tr key={`${b.bank_code}-${b.account_alias}`}>
                        <td className="strong">{b.bank_code}</td>
                        <td>{b.account_alias ?? '-'}</td>
                        <td className="num">{num(b.count)}</td>
                        <td className="num">{rupiah(b.amount)}</td>
                        <td className="num">{num(b.matched_count)} <span className="muted small">({b.count ? Math.round((b.matched_count / b.count) * 100) : 0}%)</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        <Card title="Rekonsiliasi POS" hint="Order berdasarkan tanggal order dibuat; transaksi berdasarkan waktu diterima">
          <dl className="kv">
            <dt>Total order</dt><dd><b>{num(pos.orders_total)}</b> · {rupiah(pos.orders_amount)}</dd>
            <dt>Order lunas</dt><dd><b className="text-green">{num(pos.orders_paid)}</b> · {rupiah(pos.orders_paid_amount)}</dd>
            <dt>Lunas otomatis</dt><dd>{num(pos.paid_auto)}</dd>
            <dt>Lunas verifikasi manual</dt><dd>{num(pos.paid_manual)}</dd>
            <dt>Masih menunggu</dt><dd className={pos.orders_pending ? 'text-yellow strong' : undefined}>{num(pos.orders_pending)}</dd>
            <dt>Kedaluwarsa</dt><dd>{num(pos.orders_expired)}</dd>
            <dt>Dibatalkan</dt><dd>{num(pos.orders_cancelled)}</dd>
            <dt>Transfer tanpa order</dt><dd className={pos.transactions_without_order ? 'text-orange strong' : undefined}>{num(pos.transactions_without_order)} · {rupiah(pos.transactions_without_order_amount)}</dd>
          </dl>
          {pos.orders_total > 0 && (
            <div className="mt-2">
              <div className="small muted mb-1">Tingkat pelunasan order: {Math.round((pos.orders_paid / pos.orders_total) * 100)}%</div>
              <div className="bar-track">
                <span className="bar-fill matched" style={{ width: `${(pos.paid_auto / pos.orders_total) * 100}%` }} title="Otomatis" />
                <span className="bar-fill manual" style={{ width: `${(pos.paid_manual / pos.orders_total) * 100}%` }} title="Manual" />
                <span className="bar-fill ambiguous" style={{ width: `${(pos.orders_pending / pos.orders_total) * 100}%` }} title="Menunggu" />
                <span className="bar-fill other" style={{ width: `${((pos.orders_expired + pos.orders_cancelled) / pos.orders_total) * 100}%` }} title="Kedaluwarsa / dibatalkan" />
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function PeriodBar({ row, max }: { row: ReportRow; max: number }) {
  const pct = (v: number) => `${(v / max) * 100}%`;
  const other = Math.max(0, row.amount - row.matched_amount - row.manual_verified_amount - row.unmatched_amount);
  return (
    <div className="bar-row">
      <span className="num">{row.period}</span>
      <span className="bar-track" title={`${num(row.count)} transfer`}>
        <span className="bar-fill matched" style={{ width: pct(row.matched_amount) }} />
        <span className="bar-fill manual" style={{ width: pct(row.manual_verified_amount) }} />
        <span className="bar-fill unmatched" style={{ width: pct(row.unmatched_amount) }} />
        <span className="bar-fill other" style={{ width: pct(other) }} />
      </span>
      <span className="num right">{rupiah(row.amount)} <span className="muted small">({num(row.count)})</span></span>
    </div>
  );
}
