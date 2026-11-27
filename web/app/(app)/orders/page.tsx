'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/status';
import { Badge, Card, DataState, PageHeader, Pagination, SortHeader, cx } from '@/components/ui';
import { type Query } from '@/lib/api';
import { dateTime, parseIntInput, rupiah } from '@/lib/format';
import { useApi, useInitialQuery } from '@/lib/hooks';
import { ORDER_STATUS, PAYMENT_STATUS } from '@/lib/labels';
import type { Order, Paged } from '@/lib/types';

interface Filters {
  status: string;
  payment_status: string;
  date_from: string;
  date_to: string;
  amount_min: string;
  amount_max: string;
  q: string;
}

export default function OrdersPage() {
  const router = useRouter();
  const init = useInitialQuery();
  const initial: Filters = {
    status: init.get('status') ?? '',
    payment_status: init.get('payment_status') ?? '',
    date_from: init.get('date_from') ?? '',
    date_to: init.get('date_to') ?? '',
    amount_min: '',
    amount_max: '',
    q: init.get('q') ?? '',
  };
  const [draft, setDraft] = useState<Filters>(initial);
  const [applied, setApplied] = useState<Filters>(initial);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  const query = useMemo<Query>(() => ({
    status: applied.status || undefined,
    payment_status: applied.payment_status || undefined,
    date_from: applied.date_from || undefined,
    date_to: applied.date_to || undefined,
    amount_min: parseIntInput(applied.amount_min),
    amount_max: parseIntInput(applied.amount_max),
    q: applied.q.trim() || undefined,
    page, page_size: pageSize, sort, order,
  }), [applied, page, pageSize, sort, order]);
  const state = useApi<Paged<Order>>('/orders', query);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    setApplied(draft);
    setPage(1);
  };
  const reset = () => {
    const empty = { status: '', payment_status: '', date_from: '', date_to: '', amount_min: '', amount_max: '', q: '' };
    setDraft(empty);
    setApplied(empty);
    setPage(1);
  };
  const onSort = (col: string) => {
    if (sort === col) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(col);
      setOrder(col === 'order_id' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Order POS"
        subtitle="Order yang dikirim POS melalui API dan status pembayarannya."
        updatedAt={state.updatedAt}
        onRefresh={() => void state.reload()}
      />
      <Card className="mb-3" bodyClass="flush">
        <form className="filters" onSubmit={apply}>
          <div className="field">
            <label htmlFor="o-status">Status order</label>
            <select id="o-status" className="select" value={draft.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">Semua</option>
              {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="o-pay">Status pembayaran</label>
            <select id="o-pay" className="select" value={draft.payment_status} onChange={(e) => set('payment_status', e.target.value)}>
              <option value="">Semua</option>
              {Object.entries(PAYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="o-from">Dari tanggal order</label>
            <input id="o-from" type="date" className="input" value={draft.date_from} onChange={(e) => set('date_from', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="o-to">Sampai tanggal</label>
            <input id="o-to" type="date" className="input" value={draft.date_to} onChange={(e) => set('date_to', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="o-min">Nominal min (Rp)</label>
            <input id="o-min" className="input" inputMode="numeric" value={draft.amount_min} onChange={(e) => set('amount_min', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="o-max">Nominal maks (Rp)</label>
            <input id="o-max" className="input" inputMode="numeric" value={draft.amount_max} onChange={(e) => set('amount_max', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="o-q">Cari</label>
            <input id="o-q" className="input" placeholder="Order ID / nama pelanggan" value={draft.q} onChange={(e) => set('q', e.target.value)} />
          </div>
          <div className="actions">
            <button type="submit" className="btn primary">Terapkan</button>
            <button type="button" className="btn ghost" onClick={reset}>Reset</button>
          </div>
        </form>
      </Card>

      <Card flush title={state.data ? `${state.data.pagination.total.toLocaleString('id-ID')} order` : 'Order'}>
        <DataState state={state} isEmpty={(d) => d.data.length === 0} empty="Tidak ada order untuk filter ini.">
          {(d) => (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <SortHeader label="Order ID" col="order_id" sort={sort} order={order} onSort={onSort} />
                      <th>Pelanggan</th>
                      <SortHeader label="Nominal" col="amount" sort={sort} order={order} onSort={onSort} className="num" />
                      <SortHeader label="Waktu order" col="created_at" sort={sort} order={order} onSort={onSort} />
                      <SortHeader label="Batas pembayaran" col="expires_at" sort={sort} order={order} onSort={onSort} />
                      <th>Status</th>
                      <th>Status pembayaran</th>
                      <SortHeader label="Dibayar" col="paid_at" sort={sort} order={order} onSort={onSort} />
                      <th>Transaction ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.map((o) => (
                      <tr key={o.id} className={cx('clickable', (o.candidate_count ?? 0) > 0 && o.payment_status === 'UNPAID' && 'row-warn')} onClick={() => router.push(`/orders/${o.id}`)}>
                        <td><Link href={`/orders/${o.id}`} className="mono small strong" onClick={(e) => e.stopPropagation()}>{o.order_id}</Link></td>
                        <td>{o.customer_name ?? <span className="faint">-</span>}</td>
                        <td className="num strong">{rupiah(o.amount)}</td>
                        <td className="nowrap num">{dateTime(o.order_created_at, false)}</td>
                        <td className="nowrap num">{o.expires_at ? dateTime(o.expires_at, false) : <span className="faint">-</span>}</td>
                        <td><OrderStatusBadge status={o.status} /></td>
                        <td>
                          <PaymentStatusBadge status={o.payment_status} />
                          {o.matched_by && <div className="sub">{o.matched_by === 'AUTO' ? 'otomatis' : 'manual'}</div>}
                          {(o.candidate_count ?? 0) > 0 && o.payment_status === 'UNPAID' && <div className="mt-1"><Badge tone="yellow" sm>{o.candidate_count} kandidat menunggu verifikasi</Badge></div>}
                        </td>
                        <td className="nowrap num">{o.paid_at ? dateTime(o.paid_at, false) : <span className="faint">-</span>}</td>
                        <td>
                          {o.transaction_code ? <span className="mono small">{o.transaction_code}</span> : <span className="faint">-</span>}
                          {o.paid_sender_name && <div className="sub">{o.paid_sender_name}</div>}
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
    </>
  );
}
