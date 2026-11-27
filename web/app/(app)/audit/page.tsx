'use client';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { AUDIT_ACTION } from '@/components/audit';
import { Badge, Callout, Card, DataState, JsonView, PageHeader, Pagination } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { AuditEntry, Paged } from '@/lib/types';

const ENTITY_TYPES = ['transaction', 'device', 'order', 'bank_source', 'settings', 'user', 'api_client', 'webhook_delivery'];
const ACTOR_TYPES: Record<string, string> = { user: 'Pengguna', device: 'Perangkat', pos: 'POS', system: 'Sistem' };
const ACTION_PREFIXES = ['match.', 'transaction.', 'device.', 'bank_source.', 'settings.', 'webhook.', 'user.', 'api_client.', 'pos.'];

function entityHref(type?: string | null, id?: string | null): string | null {
  if (!type || !id) return null;
  if (type === 'transaction') return `/transactions/${id}`;
  if (type === 'device') return `/devices/${id}`;
  if (type === 'order' || type === 'pos_order') return `/orders/${encodeURIComponent(id)}`;
  return null;
}

export default function AuditPage() {
  const { isAdmin } = useAuth();
  const empty = { entity_type: '', entity_id: '', action: '', actor_type: '' };
  const [draft, setDraft] = useState(empty);
  const [applied, setApplied] = useState(empty);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const query = useMemo(() => ({
    entity_type: applied.entity_type || undefined,
    entity_id: applied.entity_id.trim() || undefined,
    action: applied.action.trim() || undefined,
    actor_type: applied.actor_type || undefined,
    page, page_size: pageSize,
  }), [applied, page, pageSize]);
  const state = useApi<Paged<AuditEntry>>(isAdmin ? '/audit-logs' : null, query);

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Audit log" />
        <Callout kind="warn" title="Khusus admin">Halaman ini hanya dapat diakses oleh admin.</Callout>
      </>
    );
  }

  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    setApplied(draft);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Jejak semua tindakan pengguna, perangkat, POS, dan sistem (verifikasi manual, perubahan pengaturan, registrasi perangkat, dll)."
        updatedAt={state.updatedAt}
        onRefresh={() => void state.reload()}
      />
      <Card className="mb-3" bodyClass="flush">
        <form className="filters" onSubmit={apply}>
          <div className="field">
            <label htmlFor="a-entity">Jenis entitas</label>
            <select id="a-entity" className="select" value={draft.entity_type} onChange={(e) => setDraft({ ...draft, entity_type: e.target.value })}>
              <option value="">Semua</option>
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-id">ID entitas</label>
            <input id="a-id" className="input mono" placeholder="uuid" value={draft.entity_id} onChange={(e) => setDraft({ ...draft, entity_id: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="a-action">Aksi (awalan)</label>
            <input id="a-action" className="input mono" list="action-list" placeholder="mis. match." value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} />
            <datalist id="action-list">
              {ACTION_PREFIXES.concat(Object.keys(AUDIT_ACTION)).map((a) => <option key={a} value={a} />)}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="a-actor">Aktor</label>
            <select id="a-actor" className="select" value={draft.actor_type} onChange={(e) => setDraft({ ...draft, actor_type: e.target.value })}>
              <option value="">Semua</option>
              {Object.entries(ACTOR_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="actions">
            <button type="submit" className="btn primary">Terapkan</button>
            <button type="button" className="btn ghost" onClick={() => { setDraft(empty); setApplied(empty); setPage(1); }}>Reset</button>
          </div>
        </form>
      </Card>
      <Card flush title={state.data ? `${state.data.pagination.total.toLocaleString('id-ID')} entri` : 'Audit log'}>
        <DataState state={state} isEmpty={(d) => d.data.length === 0} empty="Tidak ada entri audit untuk filter ini.">
          {(d) => (
            <>
              <div className="table-wrap">
                <table className="table compact">
                  <thead><tr><th>Waktu</th><th>Aktor</th><th>Aksi</th><th>Entitas</th><th>Catatan</th><th>Sebelum</th><th>Sesudah</th><th>IP</th></tr></thead>
                  <tbody>
                    {d.data.map((a) => {
                      const href = entityHref(a.entity_type, a.entity_id);
                      return (
                        <tr key={String(a.id)}>
                          <td className="nowrap num">{dateTime(a.created_at)}</td>
                          <td>
                            <Badge tone={a.actor_type === 'user' ? 'blue' : a.actor_type === 'system' ? 'gray' : a.actor_type === 'device' ? 'purple' : 'teal'} sm>{ACTOR_TYPES[a.actor_type] ?? a.actor_type}</Badge>
                            <div className="sub break">{a.actor_label ?? ''}</div>
                          </td>
                          <td>
                            <div className="strong">{AUDIT_ACTION[a.action] ?? a.action}</div>
                            <div className="sub mono">{a.action}</div>
                          </td>
                          <td className="small">
                            {a.entity_type ?? '-'}
                            {a.entity_id && <div className="sub mono break">{href ? <Link href={href}>{a.entity_id}</Link> : a.entity_id}</div>}
                          </td>
                          <td className="small break" style={{ maxWidth: 240 }}>{a.note ?? ''}</td>
                          <td className="json-cell"><JsonView value={a.before} summary="sebelum" /></td>
                          <td className="json-cell"><JsonView value={a.after} summary="sesudah" /></td>
                          <td className="small mono">{a.ip ?? ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination pagination={d.pagination} onPage={setPage} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1); }} sizes={[50, 100, 200]} />
            </>
          )}
        </DataState>
      </Card>
    </>
  );
}
