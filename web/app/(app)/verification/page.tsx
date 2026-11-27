'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MatchStatusBadge, ScoreBar } from '@/components/status';
import { Callout, Card, DataState, PageHeader, Pagination } from '@/components/ui';
import { dateTime, num, rupiah, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { matchReasonLabel } from '@/lib/labels';
import type { MatchRow, Paged, TransactionList } from '@/lib/types';
import { routes } from '@/lib/routes';

interface Group {
  transaction_id: string;
  first: MatchRow;
  candidates: MatchRow[];
}

export default function VerificationPage() {
  const queue = useApi<Paged<MatchRow>>('/matches', { status: 'CANDIDATE', transaction_status: 'AMBIGUOUS', page_size: 200 }, { poll: true });
  const [page, setPage] = useState(1);
  const unmatched = useApi<TransactionList>('/transactions', { status: 'UNMATCHED,REJECTED', page, page_size: 25, sort: 'received_time', order: 'desc' });

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const m of queue.data?.data ?? []) {
      const g = map.get(m.transaction_id) ?? { transaction_id: m.transaction_id, first: m, candidates: [] };
      g.candidates.push(m);
      map.set(m.transaction_id, g);
    }
    return Array.from(map.values());
  }, [queue.data]);

  return (
    <>
      <PageHeader
        title="Verifikasi manual"
        subtitle="Transaksi ambigu tidak dikirim otomatis ke POS. Periksa kandidat lalu pilih order yang benar di halaman detail."
        updatedAt={queue.updatedAt}
        onRefresh={() => { void queue.reload(); void unmatched.reload(); }}
        live
      />

      <div className="stack gap-lg">
        <Card title={`Antrean ambigu (${groups.length} transaksi)`} hint="Dikelompokkan per transaksi; skor tertinggi di atas" flush>
          <DataState state={queue} isEmpty={() => groups.length === 0} empty="🎉 Tidak ada transaksi ambigu yang menunggu verifikasi.">
            {() => (
              <div className="card-body stack">
                {(queue.data?.pagination.total ?? 0) > 200 && <Callout kind="info">Menampilkan 200 kandidat pertama. Selesaikan antrean agar sisanya tampil.</Callout>}
                {groups.map((g) => (
                  <div key={g.transaction_id} className="card" style={{ boxShadow: 'none' }}>
                    <div className="card-head">
                      <div>
                        <div className="row" style={{ gap: 8 }}>
                          <Link href={routes.transaction(g.transaction_id)} className="strong">{g.first.transaction_code}</Link>
                          <MatchStatusBadge status={g.first.match_status} />
                          <span className="strong">{rupiah(g.first.amount)}</span>
                        </div>
                        <div className="hint">
                          {g.first.sender_name ?? 'Pengirim tidak terbaca'} · {g.first.bank_code} {g.first.account_alias ?? ''} · diterima {dateTime(g.first.received_time)} ({timeAgo(g.first.received_time)})
                          {' · '}{matchReasonLabel(g.first.match_reason)}
                        </div>
                      </div>
                      <Link href={routes.transaction(g.transaction_id)} className="btn primary sm">Periksa &amp; verifikasi →</Link>
                    </div>
                    <div className="table-wrap">
                      <table className="table compact">
                        <thead>
                          <tr><th>Order kandidat</th><th>Pelanggan</th><th>Waktu order</th><th>Batas bayar</th><th>Skor</th><th>Alasan</th></tr>
                        </thead>
                        <tbody>
                          {g.candidates.map((c) => (
                            <tr key={c.id}>
                              <td><Link href={routes.order(c.order_uuid)} className="mono small">{c.order_id}</Link></td>
                              <td>{c.customer_name ?? '-'}</td>
                              <td className="nowrap num">{dateTime(c.order_created_at, false)}</td>
                              <td className="nowrap num">{c.expires_at ? dateTime(c.expires_at, false) : '-'}</td>
                              <td style={{ minWidth: 170 }}><ScoreBar score={c.score} breakdown={c.score_breakdown} compact /></td>
                              <td className="small">{(c.reasons ?? []).join(' · ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DataState>
        </Card>

        <Card
          title={`Transaksi tanpa order (${num(unmatched.data?.totals.count ?? 0)})`}
          hint="Status UNMATCHED / REJECTED — bisa ditautkan manual ke order (mis. transfer terlambat) atau diabaikan"
          flush
        >
          <DataState state={unmatched} isEmpty={(d) => d.data.length === 0} empty="Tidak ada transaksi unmatched / rejected.">
            {(d) => (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>Transaksi</th><th>Diterima</th><th>Bank / rekening</th><th>Pengirim</th><th className="num">Nominal</th><th>Status</th><th /></tr>
                    </thead>
                    <tbody>
                      {d.data.map((t) => (
                        <tr key={t.id}>
                          <td><Link href={routes.transaction(t.id)} className="strong">{t.transaction_code}</Link></td>
                          <td className="nowrap num">{dateTime(t.received_time)}<div className="sub">{timeAgo(t.received_time)}</div></td>
                          <td>{t.bank_code}<div className="sub">{t.account_alias ?? '-'}</div></td>
                          <td>{t.sender_name ?? '-'}</td>
                          <td className="num strong">{rupiah(t.amount)}</td>
                          <td><MatchStatusBadge status={t.match_status} /><div className="sub">{matchReasonLabel(t.match_reason)}</div></td>
                          <td><Link href={routes.transaction(t.id)} className="btn xs">Tindak lanjut</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination pagination={d.pagination} onPage={setPage} />
              </>
            )}
          </DataState>
        </Card>
      </div>
    </>
  );
}
