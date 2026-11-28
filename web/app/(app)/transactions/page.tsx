'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { PosVisibilityBadge, PosVisibilityModal, posVisibilityMessage } from '@/components/pos-visibility';
import { MatchStatusBadge } from '@/components/status';
import { useToast } from '@/components/toast';
import { Card, DataState, PageHeader, Pagination, SortHeader, Spinner, cx } from '@/components/ui';
import { api, errorMessage, qs, type Query } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { firstOfMonthYmd, num, parseIntInput, rupiah, timeSmart, dateTime, todayYmd } from '@/lib/format';
import { useApi, useInitialQuery } from '@/lib/hooks';
import { MATCH_STATUS, MATCH_STATUS_ORDER, matchReasonLabel } from '@/lib/labels';
import type { BankSource, ListResponse, MatchStatus, Transaction, TransactionList } from '@/lib/types';
import { routes } from '@/lib/routes';

type PosVisibilityFilter = '' | 'visible' | 'hidden';
const POS_VISIBILITY: { value: PosVisibilityFilter; label: string }[] = [
  { value: '', label: 'Semua' },
  { value: 'visible', label: 'Tampil' },
  { value: 'hidden', label: 'Disembunyikan' },
];

interface Filters {
  date_from: string;
  date_to: string;
  bank_code: string;
  bank_source_id: string;
  amount_min: string;
  amount_max: string;
  status: MatchStatus[];
  q: string;
  pos_visibility: PosVisibilityFilter;
}

const EMPTY: Filters = { date_from: '', date_to: '', bank_code: '', bank_source_id: '', amount_min: '', amount_max: '', status: [], q: '', pos_visibility: '' };

function fromUrl(p: URLSearchParams): Filters {
  return {
    date_from: p.get('date_from') ?? '',
    date_to: p.get('date_to') ?? '',
    bank_code: p.get('bank_code') ?? '',
    bank_source_id: p.get('bank_source_id') ?? '',
    amount_min: p.get('amount_min') ?? '',
    amount_max: p.get('amount_max') ?? '',
    status: (p.get('status') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((s): s is MatchStatus => s in MATCH_STATUS),
    q: p.get('q') ?? '',
    pos_visibility: (['visible', 'hidden'] as const).find((v) => v === p.get('pos_visibility')) ?? '',
  };
}

function toQuery(f: Filters): Query {
  return {
    date_from: f.date_from || undefined,
    date_to: f.date_to || undefined,
    bank_code: f.bank_code || undefined,
    bank_source_id: f.bank_source_id || undefined,
    amount_min: parseIntInput(f.amount_min),
    amount_max: parseIntInput(f.amount_max),
    status: f.status.length ? f.status : undefined,
    q: f.q.trim() || undefined,
    pos_visibility: f.pos_visibility || undefined,
  };
}

export default function TransactionsPage() {
  const router = useRouter();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const initial = useInitialQuery();
  const [visTarget, setVisTarget] = useState<Transaction | null>(null);
  const [draft, setDraft] = useState<Filters>(() => fromUrl(initial));
  const [applied, setApplied] = useState<Filters>(() => fromUrl(initial));
  const [page, setPage] = useState(() => Number(initial.get('page') ?? 1) || 1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState(initial.get('sort') ?? 'received_time');
  const [order, setOrder] = useState<'asc' | 'desc'>(initial.get('order') === 'asc' ? 'asc' : 'desc');
  const [exporting, setExporting] = useState(false);

  const banks = useApi<ListResponse<BankSource>>('/bank-sources');
  const bankCodes = useMemo(() => Array.from(new Set((banks.data?.data ?? []).map((b) => b.bank_code))).sort(), [banks.data]);
  const accounts = (banks.data?.data ?? []).filter((b) => !draft.bank_code || b.bank_code === draft.bank_code);

  const filterQuery = useMemo(() => toQuery(applied), [applied]);
  const listQuery = useMemo<Query>(() => ({ ...filterQuery, page, page_size: pageSize, sort, order }), [filterQuery, page, pageSize, sort, order]);
  const state = useApi<TransactionList>('/transactions', listQuery);

  // Simpan filter di URL agar bisa dibagikan / tidak hilang saat refresh.
  useEffect(() => {
    const q = qs({ ...filterQuery, page: page > 1 ? page : undefined, sort: sort !== 'received_time' ? sort : undefined, order: order !== 'desc' ? order : undefined });
    window.history.replaceState(window.history.state, '', `/transactions${q}`);
  }, [filterQuery, page, sort, order]);

  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    setApplied(draft);
    setPage(1);
  };
  const reset = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    setPage(1);
  };
  const preset = (from: string, to: string) => {
    const next = { ...draft, date_from: from, date_to: to };
    setDraft(next);
    setApplied(next);
    setPage(1);
  };
  const setPosVisibility = (v: PosVisibilityFilter) => {
    const next = { ...draft, pos_visibility: v };
    setDraft(next);
    setApplied(next);
    setPage(1);
  };
  const toggleStatus = (s: MatchStatus) => {
    const next = { ...draft, status: draft.status.includes(s) ? draft.status.filter((x) => x !== s) : [...draft.status, s] };
    setDraft(next);
    setApplied(next);
    setPage(1);
  };
  const onSort = (col: string) => {
    if (sort === col) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(col);
      setOrder(col === 'sender_name' || col === 'bank_code' || col === 'match_status' ? 'asc' : 'desc');
    }
    setPage(1);
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      const name = await api.download('/transactions/export.csv', { ...filterQuery, sort, order }, 'transaksi.csv');
      toast.success(`File ${name} diunduh`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <>
      <PageHeader
        title="Transaksi masuk"
        subtitle="Transfer masuk yang terbaca dari notifikasi bank di HP Android. Tanggal mengikuti zona waktu operasional."
        updatedAt={state.updatedAt}
        onRefresh={() => void state.reload()}
        actions={
          <button type="button" className="btn" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? <Spinner sm /> : '⬇'} Export CSV
          </button>
        }
      />

      <Card className="mb-3" bodyClass="flush">
        <form className="filters" onSubmit={apply}>
          <div className="field">
            <label htmlFor="f-from">Dari tanggal</label>
            <input id="f-from" type="date" className="input" value={draft.date_from} onChange={(e) => set('date_from', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-to">Sampai tanggal</label>
            <input id="f-to" type="date" className="input" value={draft.date_to} onChange={(e) => set('date_to', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-bank">Bank</label>
            <select id="f-bank" className="select" value={draft.bank_code} onChange={(e) => setDraft((d) => ({ ...d, bank_code: e.target.value, bank_source_id: '' }))}>
              <option value="">Semua bank</option>
              {bankCodes.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-acc">Rekening</label>
            <select id="f-acc" className="select" value={draft.bank_source_id} onChange={(e) => set('bank_source_id', e.target.value)}>
              <option value="">Semua rekening</option>
              {accounts.map((b) => <option key={b.id} value={b.id}>{b.bank_code} · {b.account_alias}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-min">Nominal min (Rp)</label>
            <input id="f-min" className="input" inputMode="numeric" placeholder="0" value={draft.amount_min} onChange={(e) => set('amount_min', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-max">Nominal maks (Rp)</label>
            <input id="f-max" className="input" inputMode="numeric" placeholder="tanpa batas" value={draft.amount_max} onChange={(e) => set('amount_max', e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="f-q">Cari</label>
            <input id="f-q" className="input" placeholder="Nama pengirim, no. referensi, TRX-…, order POS, alias rekening" value={draft.q} onChange={(e) => set('q', e.target.value)} />
          </div>
          <div className="actions">
            <button type="submit" className="btn primary">Terapkan</button>
            <button type="button" className="btn ghost" onClick={reset}>Reset</button>
          </div>
        </form>
        <div style={{ padding: '0 16px 14px' }} className="stack">
          <div className="row" style={{ gap: 6 }}>
            <span className="label" style={{ marginRight: 4 }}>Status:</span>
            <div className="chips">
              {MATCH_STATUS_ORDER.map((s) => (
                <button key={s} type="button" className={cx('chip', draft.status.includes(s) && 'on')} onClick={() => toggleStatus(s)}>
                  {MATCH_STATUS[s].label}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <span className="label" style={{ marginRight: 4 }}>API POS:</span>
            <div className="chips">
              {POS_VISIBILITY.map((o) => (
                <button key={o.value || 'all'} type="button" className={cx('chip', draft.pos_visibility === o.value && 'on')} onClick={() => setPosVisibility(o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <span className="label" style={{ marginRight: 4 }}>Periode cepat:</span>
            <button type="button" className="chip" onClick={() => preset(todayYmd(), todayYmd())}>Hari ini</button>
            <button type="button" className="chip" onClick={() => preset(todayYmd(-1), todayYmd(-1))}>Kemarin</button>
            <button type="button" className="chip" onClick={() => preset(todayYmd(-6), todayYmd())}>7 hari</button>
            <button type="button" className="chip" onClick={() => preset(firstOfMonthYmd(), todayYmd())}>Bulan ini</button>
            <button type="button" className="chip" onClick={() => preset('', '')}>Semua</button>
          </div>
        </div>
      </Card>

      <Card flush
        title={state.data ? `${num(state.data.totals.count)} transaksi · ${rupiah(state.data.totals.amount)}` : 'Transaksi'}
        hint="Klik baris untuk melihat detail & verifikasi manual"
        actions={state.loading && state.data ? <Spinner sm /> : undefined}
      >
        <DataState state={state} isEmpty={(d) => d.data.length === 0} empty="Tidak ada transaksi untuk filter ini.">
          {(d) => (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <SortHeader label="Waktu transaksi" col="transaction_time" sort={sort} order={order} onSort={onSort} />
                      <SortHeader label="Diterima" col="received_time" sort={sort} order={order} onSort={onSort} />
                      <SortHeader label="Bank / rekening" col="bank_code" sort={sort} order={order} onSort={onSort} />
                      <SortHeader label="Pengirim" col="sender_name" sort={sort} order={order} onSort={onSort} />
                      <SortHeader label="Nominal" col="amount" sort={sort} order={order} onSort={onSort} className="num" />
                      <th>Referensi</th>
                      <SortHeader label="Status matching" col="match_status" sort={sort} order={order} onSort={onSort} />
                      <th>POS Order ID</th>
                      <th>API POS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.map((t) => (
                      <tr key={t.id} className={cx('clickable', t.match_status === 'AMBIGUOUS' && 'row-warn')} onClick={() => router.push(routes.transaction(t.id))}>
                        <td className="nowrap">
                          <Link href={routes.transaction(t.id)} className="strong" onClick={(e) => e.stopPropagation()}>{t.transaction_code}</Link>
                          <div className="sub num" title={dateTime(t.transaction_time)}>{t.transaction_time ? timeSmart(t.transaction_time) : 'waktu tidak terbaca'}</div>
                        </td>
                        <td className="nowrap num" title={dateTime(t.received_time)}>{timeSmart(t.received_time)}</td>
                        <td>
                          <span className="strong">{t.bank_code}</span>
                          <div className="sub">{t.account_alias ?? '-'}</div>
                        </td>
                        <td className="break">{t.sender_name ?? <span className="faint">-</span>}</td>
                        <td className="num strong">{rupiah(t.amount)}</td>
                        <td className="small mono break">{t.reference_number ?? <span className="faint">-</span>}</td>
                        <td>
                          <MatchStatusBadge status={t.match_status} />
                          {t.match_status === 'AMBIGUOUS' && <div className="sub">{t.candidate_count} kandidat</div>}
                          {['UNMATCHED', 'REJECTED'].includes(t.match_status) && <div className="sub">{matchReasonLabel(t.match_reason)}</div>}
                        </td>
                        <td>
                          {t.pos_order_id ? <span className="mono small">{t.pos_order_id}</span> : <span className="faint">-</span>}
                          {t.pos_customer_name && <div className="sub">{t.pos_customer_name}</div>}
                        </td>
                        <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                          <PosVisibilityBadge t={t} sm />
                          <div className="mt-1">
                            <button type="button" className="btn xs" onClick={() => setVisTarget(t)}>
                              {t.pos_visible ? '🙈 Sembunyikan' : '👁 Tampilkan'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination pagination={d.pagination} onPage={setPage} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
            </>
          )}
        </DataState>
      </Card>

      {visTarget && (
        <PosVisibilityModal
          t={visTarget}
          isAdmin={isAdmin}
          onClose={() => setVisTarget(null)}
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
