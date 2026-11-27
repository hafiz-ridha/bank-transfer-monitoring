'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WebhookStatusBadge } from '@/components/status';
import { useToast } from '@/components/toast';
import {
  AdminOnlyNotice, Badge, Callout, Card, ConfirmModal, CopyButton, DataState, Empty, Field, JsonView, Modal, PageHeader,
  Pagination, Spinner, Switch,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { config } from '@/lib/config';
import { dateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { WEBHOOK_STATUS } from '@/lib/labels';
import type { ApiClient, ListResponse, Paged, SettingDef, SettingValue, WebhookDelivery, WebhookTestResult } from '@/lib/types';

const GROUPS: { key: string; title: string; hint: string }[] = [
  { key: 'general', title: 'Umum', hint: 'Zona waktu operasional dipakai untuk filter tanggal, laporan, dan tampilan jam.' },
  { key: 'device', title: 'Perangkat', hint: 'Ambang status ACTIVE / WARNING / INACTIVE, antrean, dan versi aplikasi minimum (PRD §4.3).' },
  { key: 'matching', title: 'Matching', hint: 'Aturan pencocokan transfer ↔ order POS (PRD §6).' },
  { key: 'retention', title: 'Retensi', hint: 'Lama penyimpanan data sebelum dihapus otomatis (PRD §11).' },
  { key: 'webhook', title: 'Webhook POS', hint: 'Notifikasi payment.matched ke sistem POS (PRD §7.3).' },
  { key: 'alerts', title: 'Alert', hint: 'Kanal notifikasi alert perangkat. Token bot Telegram diatur di server (env backend).' },
  { key: 'security', title: 'Keamanan', hint: 'Proteksi replay request dari perangkat Android.' },
];

const TZ_COMMON = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'];

type Draft = Record<string, string | boolean>;

function toDraft(defs: SettingDef[]): Draft {
  const d: Draft = {};
  for (const s of defs) d[s.key] = s.type === 'bool' ? Boolean(s.value) : s.value === null || s.value === undefined ? '' : String(s.value);
  return d;
}

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const state = useApi<ListResponse<SettingDef>>('/settings');
  const [draft, setDraft] = useState<Draft>({});
  const baseRef = useRef<Draft>({});

  useEffect(() => {
    if (!state.data) return;
    // Nilai baru dari server; perubahan yang belum disimpan di grup lain tetap dipertahankan.
    const fresh = toDraft(state.data.data);
    const oldBase = baseRef.current;
    baseRef.current = fresh;
    setDraft((prev) => {
      const next: Draft = { ...fresh };
      for (const k of Object.keys(prev)) if (k in oldBase && prev[k] !== oldBase[k]) next[k] = prev[k];
      return next;
    });
  }, [state.data]);

  useEffect(() => {
    // Lompat ke anchor (#webhook / #api) setelah data tampil
    if (state.data && window.location.hash) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [state.data]);

  return (
    <>
      <PageHeader
        title="Pengaturan"
        subtitle="Konfigurasi sistem. Perubahan berlaku segera dan tercatat di audit log."
        updatedAt={state.updatedAt}
        onRefresh={() => void state.reload()}
      />
      {!isAdmin && <div className="mb-3"><AdminOnlyNotice what="mengubah pengaturan, webhook, dan API key" /></div>}
      <DataState state={state}>
        {(d) => (
          <div className="stack gap-lg">
            {GROUPS.map((g) => {
              const defs = d.data.filter((s) => s.group === g.key);
              if (!defs.length) return null;
              return (
                <div key={g.key} id={g.key === 'webhook' ? 'webhook' : `grp-${g.key}`}>
                  <SettingsGroup
                    title={g.title}
                    hint={g.hint}
                    defs={defs}
                    draft={draft}
                    setDraft={setDraft}
                    readOnly={!isAdmin}
                    onSaved={(fresh) => state.setData(fresh)}
                  />
                  {g.key === 'webhook' && <WebhookTools isAdmin={isAdmin} onChanged={() => void state.reload()} secretSet={!!defs.find((s) => s.key === 'webhook.secret')?.is_set} />}
                </div>
              );
            })}
            {/* Grup yang tidak dikenal (bila backend menambah grup baru) */}
            {(() => {
              const known = new Set(GROUPS.map((g) => g.key));
              const extra = d.data.filter((s) => !known.has(s.group));
              return extra.length ? (
                <SettingsGroup title="Lainnya" hint="" defs={extra} draft={draft} setDraft={setDraft} readOnly={!isAdmin} onSaved={(fresh) => state.setData(fresh)} />
              ) : null;
            })()}
            <div id="api"><ApiClientsSection isAdmin={isAdmin} /></div>
          </div>
        )}
      </DataState>
    </>
  );
}

function SettingsGroup({
  title, hint, defs, draft, setDraft, readOnly, onSaved,
}: {
  title: string;
  hint: string;
  defs: SettingDef[];
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  readOnly: boolean;
  onSaved: (fresh: ListResponse<SettingDef>) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const original = useMemo(() => toDraft(defs), [defs]);
  const changedKeys = defs.filter((s) => !s.secret && draft[s.key] !== undefined && draft[s.key] !== original[s.key]).map((s) => s.key);

  const save = async () => {
    const values: Record<string, SettingValue> = {};
    const errs: Record<string, string> = {};
    for (const key of changedKeys) {
      const def = defs.find((s) => s.key === key)!;
      const raw = draft[key];
      if (def.type === 'bool') values[key] = Boolean(raw);
      else if (def.type === 'int' || def.type === 'number') {
        const n = def.type === 'int' ? Number.parseInt(String(raw), 10) : Number.parseFloat(String(raw).replace(',', '.'));
        if (!Number.isFinite(n) || (def.type === 'int' && !/^-?\d+$/.test(String(raw).trim()))) errs[key] = def.type === 'int' ? 'Harus bilangan bulat' : 'Harus angka';
        else if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) errs[key] = `Harus di antara ${def.min} dan ${def.max}`;
        else values[key] = n;
      } else if (def.type === 'url') {
        const v = String(raw).trim();
        if (v && !/^https?:\/\/\S+$/i.test(v)) errs[key] = 'URL harus diawali http:// atau https://';
        else values[key] = v;
      } else values[key] = String(raw).trim();
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setErr(null);
    try {
      const fresh = await api.put<ListResponse<SettingDef>>('/settings', { values });
      const saved = toDraft(fresh.data);
      setDraft((d) => ({ ...d, ...Object.fromEntries(Object.keys(values).map((k) => [k, saved[k]])) }));
      toast.success(`Pengaturan ${title} disimpan`);
      onSaved(fresh);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setDraft((d) => ({ ...d, ...Object.fromEntries(changedKeys.map((k) => [k, original[k]])) }));
    setErrors({});
    setErr(null);
  };

  return (
    <Card
      title={title}
      hint={hint}
      footer={!readOnly && (
        <div className="row-between">
          <span className="small muted">{changedKeys.length ? `${changedKeys.length} perubahan belum disimpan` : 'Tidak ada perubahan'}</span>
          <div className="btn-group">
            <button type="button" className="btn sm ghost" onClick={reset} disabled={!changedKeys.length || busy}>Batalkan</button>
            <button type="button" className="btn sm primary" onClick={() => void save()} disabled={!changedKeys.length || busy}>{busy && <Spinner sm />} Simpan {title}</button>
          </div>
        </div>
      )}
    >
      <div className="form-grid">
        {defs.map((s) => (
          <SettingField key={s.key} def={s} value={draft[s.key]} readOnly={readOnly} error={errors[s.key]}
            onChange={(v) => setDraft((d) => ({ ...d, [s.key]: v }))} />
        ))}
      </div>
      {err && <div className="mt-2"><Callout kind="danger">{err}</Callout></div>}
    </Card>
  );
}

let tzList: string[] | null = null;
function timezones(): string[] {
  if (tzList) return tzList;
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    tzList = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : TZ_COMMON;
  } catch {
    tzList = TZ_COMMON;
  }
  return tzList;
}

function SettingField({ def, value, onChange, readOnly, error }: {
  def: SettingDef; value: string | boolean | undefined; onChange: (v: string | boolean) => void; readOnly: boolean; error?: string;
}) {
  const id = `set-${def.key}`;
  const range = def.min !== undefined || def.max !== undefined ? `Rentang ${def.min ?? '-'} – ${def.max ?? '-'}` : undefined;
  const help = <><code className="faint">{def.key}</code>{range && <> · {range}</>}</>;

  if (def.secret) {
    return (
      <Field label={def.label} htmlFor={id} help={<>{help} · ganti melalui tombol “Rotate secret” di bawah</>}>
        <input id={id} className="input mono" value={def.is_set ? String(def.value) : 'Belum diatur'} disabled />
      </Field>
    );
  }
  if (def.type === 'bool') {
    return (
      <Field label={def.label} help={help} htmlFor={id}>
        <Switch id={id} ariaLabel={def.label} checked={Boolean(value)} onChange={onChange} disabled={readOnly} label={value ? 'Aktif' : 'Nonaktif'} />
      </Field>
    );
  }
  if (def.type === 'timezone') {
    return (
      <Field label={def.label} htmlFor={id} help={<>{help} · WIB = Asia/Jakarta, WITA = Asia/Makassar, WIT = Asia/Jayapura</>} error={error}>
        <input id={id} className="input" list="tz-list" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} disabled={readOnly} />
        <datalist id="tz-list">
          {TZ_COMMON.concat(timezones().filter((t) => !TZ_COMMON.includes(t))).map((t) => <option key={t} value={t} />)}
        </datalist>
      </Field>
    );
  }
  const isNum = def.type === 'int' || def.type === 'number';
  return (
    <Field label={def.label} htmlFor={id} help={help} error={error}>
      <input
        id={id}
        className="input"
        type={isNum ? 'number' : def.type === 'url' ? 'url' : 'text'}
        inputMode={def.type === 'int' ? 'numeric' : def.type === 'number' ? 'decimal' : undefined}
        step={def.type === 'number' ? 'any' : def.type === 'int' ? 1 : undefined}
        min={def.min}
        max={def.max}
        placeholder={def.type === 'url' ? 'https://pos.contoh.co.id/webhooks/btm' : undefined}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly}
      />
    </Field>
  );
}

// ------------------------------------------------------------------ webhook

const SIGNATURE_DOC = `POST <URL webhook POS>
Content-Type: application/json
X-BTM-Event: payment.matched
X-BTM-Event-Id: evt-xxxx          (sama dengan header Idempotency-Key)
X-BTM-Timestamp: 1764212700       (epoch detik)
X-BTM-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>

{ "event": "payment.matched", "event_id": "evt-123456", "order_id": "POS-20261127-001",
  "transaction_id": "TRX-000001", "amount": 150000, "paid_at": "2026-11-27T03:05:00.000Z",
  "status": "paid", "match_type": "auto|manual", "bank_code": "BCA", "account_alias": "BCA Utama",
  "sender_name": "BUDI SANTOSO", "reference_number": null }`;

const VERIFY_SNIPPET = `import crypto from 'node:crypto';
function verify(req, rawBody, secret) {
  const ts = req.headers['x-btm-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(\`\${ts}.\${rawBody}\`).digest('hex');
  const got = req.headers['x-btm-signature'] ?? '';
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}`;

function WebhookTools({ isAdmin, onChanged, secretSet }: { isAdmin: boolean; onChanged: () => void; secretSet: boolean }) {
  const toast = useToast();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<WebhookTestResult | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const deliveries = useApi<Paged<WebhookDelivery>>('/webhook-deliveries', { status: statusFilter || undefined, page, page_size: 25 });
  const [retrying, setRetrying] = useState<string | null>(null);

  const sendTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const r = await api.post<WebhookTestResult>('/settings/webhook/test');
      setTest(r);
      if (r.ok) toast.success(`Webhook uji terkirim (HTTP ${r.status_code})`);
      else toast.error(`Webhook uji gagal: ${r.error ?? `HTTP ${r.status_code}`}`);
      void deliveries.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  const retry = async (w: WebhookDelivery) => {
    setRetrying(w.id);
    try {
      await api.post(`/webhook-deliveries/${w.id}/retry`);
      toast.success(`Pengiriman ulang ${w.event_id} dijadwalkan`);
      setTimeout(() => void deliveries.reload(), 1500);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div className="stack mt-2">
      <Card title="Secret & uji webhook" hint="Secret dipakai POS untuk memverifikasi signature setiap webhook">
        <div className="stack">
          <div className="row">
            <span>Status secret: {secretSet ? <Badge tone="green">Sudah diatur</Badge> : <Badge tone="red">Belum diatur</Badge>}</span>
            {isAdmin && (
              <>
                <button type="button" className="btn sm" onClick={() => setConfirmRotate(true)}>🔄 Rotate secret</button>
                <button type="button" className="btn sm" onClick={() => void sendTest()} disabled={testing}>{testing ? <Spinner sm /> : '📨'} Kirim webhook uji</button>
              </>
            )}
          </div>
          {test && (
            <Callout kind={test.ok ? 'success' : 'danger'} title={test.ok ? 'Webhook uji berhasil' : 'Webhook uji gagal'}>
              <div className="small">
                HTTP {test.status_code ?? '-'} · {test.duration_ms ?? '-'} ms · event <code>{test.event_id ?? '-'}</code>
                {test.error && <> · {test.error}</>}
              </div>
              {test.response != null && <JsonView value={test.response} summary="Respons POS" />}
            </Callout>
          )}
          <details>
            <summary>Format webhook & signature untuk developer POS</summary>
            <div className="stack mt-1">
              <pre>{SIGNATURE_DOC}</pre>
              <div className="small">
                POS wajib: (1) verifikasi signature dengan perbandingan waktu-konstan, (2) tolak timestamp &gt; 5 menit, (3) proses idempoten
                berdasarkan <code>event_id</code>/<code>order_id</code>, (4) membalas 2xx dalam 10 detik. Non-2xx/timeout di-retry dengan backoff
                (30 dtk → 4 jam) sampai batas percobaan, lalu <b>DEAD</b> (bisa dikirim ulang manual). Webhook tidak pernah dikirim untuk transaksi ambigu.
              </div>
              <div className="row-between"><span className="label">Contoh verifikasi (Node.js)</span><CopyButton text={VERIFY_SNIPPET} /></div>
              <pre>{VERIFY_SNIPPET}</pre>
            </div>
          </details>
        </div>
      </Card>

      <Card
        title="Riwayat pengiriman webhook"
        flush
        actions={
          <>
            <select className="select sm" style={{ width: 'auto' }} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} aria-label="Filter status">
              <option value="">Semua status</option>
              {Object.entries(WEBHOOK_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button type="button" className="btn sm" onClick={() => void deliveries.reload()}>↻</button>
          </>
        }
      >
        <DataState state={deliveries} isEmpty={(d) => d.data.length === 0} empty="Belum ada pengiriman webhook.">
          {(d) => (
            <>
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr><th>Dibuat</th><th>Event</th><th>Order / Transaksi</th><th>Status</th><th className="num">Percobaan</th><th>HTTP</th><th>Error terakhir</th><th>Berikutnya / terkirim</th><th>Detail</th><th /></tr>
                  </thead>
                  <tbody>
                    {d.data.map((w) => (
                      <tr key={w.id} className={w.status === 'DEAD' ? 'row-bad' : w.status === 'FAILED' ? 'row-warn' : undefined}>
                        <td className="nowrap num">{dateTime(w.created_at)}</td>
                        <td><div className="small">{w.event_type}</div><div className="sub mono">{w.event_id}</div></td>
                        <td className="small">{w.pos_order_id ?? '-'}<div className="sub">{w.transaction_code ?? ''}</div></td>
                        <td><WebhookStatusBadge status={w.status} /></td>
                        <td className="num">{w.attempts}/{w.max_attempts}</td>
                        <td>{w.last_status_code ?? '-'}</td>
                        <td className="small text-red break" style={{ maxWidth: 240 }}>{w.last_error ?? ''}</td>
                        <td className="nowrap small">{w.delivered_at ? <>✓ {dateTime(w.delivered_at)}</> : w.status === 'DEAD' ? '-' : dateTime(w.next_attempt_at)}</td>
                        <td className="json-cell">
                          <JsonView value={w.payload} summary="payload" />
                          <JsonView value={w.attempt_log} summary="log percobaan" />
                        </td>
                        <td>
                          {isAdmin && ['FAILED', 'DEAD', 'PENDING'].includes(w.status) && (
                            <button type="button" className="btn xs" disabled={retrying === w.id} onClick={() => void retry(w)}>{retrying === w.id ? <Spinner sm /> : 'Kirim ulang'}</button>
                          )}
                        </td>
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

      {confirmRotate && (
        <ConfirmModal
          title="Rotate webhook secret?"
          tone="danger"
          withNote={false}
          confirmLabel="Buat secret baru"
          description="Secret lama langsung tidak berlaku. Webhook berikutnya ditandatangani dengan secret baru, jadi segera perbarui konfigurasi di POS."
          onClose={() => setConfirmRotate(false)}
          onConfirm={async () => {
            const r = await api.post<{ secret: string }>('/settings/webhook/rotate-secret');
            setSecret(r.secret);
            onChanged();
          }}
        />
      )}
      {secret && (
        <Modal title="Webhook secret baru" onClose={() => setSecret(null)} closeOnBackdrop={false}
          footer={<button type="button" className="btn primary" onClick={() => setSecret(null)}>Saya sudah menyimpannya</button>}>
          <div className="stack">
            <Callout kind="warn">Secret ini <b>hanya ditampilkan sekali</b>. Salin dan simpan di konfigurasi POS sekarang.</Callout>
            <div className="secret-box">{secret}</div>
            <div><CopyButton text={secret} label="Salin secret" /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ API POS

function ApiClientsSection({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const state = useApi<ListResponse<ApiClient>>(isAdmin ? '/api-clients' : null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<ApiClient | null>(null);
  const [revoke, setRevoke] = useState<ApiClient | null>(null);

  const create = async () => {
    if (name.trim().length < 2) {
      setErr('Nama minimal 2 karakter');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<ApiClient>('/api-clients', { name: name.trim() });
      setNewKey(r);
      setCreating(false);
      setName('');
      void state.reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="API POS"
      hint={<>API key untuk sistem POS (header <code>X-API-Key</code>) ke <code>{config.publicApiUrl}/api/v1/pos/*</code></>}
      flush
      actions={isAdmin && <button type="button" className="btn sm primary" onClick={() => setCreating(true)}>+ Buat API key</button>}
    >
      {!isAdmin ? (
        <Empty>Daftar API key hanya dapat dilihat admin.</Empty>
      ) : (
        <DataState state={state} isEmpty={(d) => d.data.length === 0} empty="Belum ada API key. Buat satu untuk sistem POS.">
          {(d) => (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Nama</th><th>Prefix key</th><th>Scope</th><th>Status</th><th>Terakhir dipakai</th><th>Dibuat</th><th /></tr></thead>
                <tbody>
                  {d.data.map((c) => (
                    <tr key={c.id} className={c.is_active ? undefined : 'row-muted'}>
                      <td className="strong">{c.name}</td>
                      <td className="mono small">{c.key_prefix}…</td>
                      <td className="small">{(c.scopes ?? []).join(', ')}</td>
                      <td>{c.is_active ? <Badge tone="green" sm>Aktif</Badge> : <Badge tone="gray" sm>Dicabut {dateTime(c.revoked_at, false)}</Badge>}</td>
                      <td className="nowrap num">{dateTime(c.last_used_at)}</td>
                      <td className="nowrap num">{dateTime(c.created_at, false)}</td>
                      <td>{c.is_active && <button type="button" className="btn xs danger-outline" onClick={() => setRevoke(c)}>Cabut</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataState>
      )}

      {creating && (
        <Modal title="Buat API key POS" onClose={() => setCreating(false)}
          footer={<><button type="button" className="btn" onClick={() => setCreating(false)}>Batal</button><button type="button" className="btn primary" onClick={() => void create()} disabled={busy}>{busy && <Spinner sm />} Buat</button></>}>
          <div className="stack">
            <Field label="Nama klien" htmlFor="api-name" help="Mis. POS Kasir Toko Pusat">
              <input id="api-name" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} />
            </Field>
            {err && <Callout kind="danger">{err}</Callout>}
          </div>
        </Modal>
      )}
      {newKey?.api_key && (
        <Modal title="API key baru" onClose={() => setNewKey(null)} closeOnBackdrop={false}
          footer={<button type="button" className="btn primary" onClick={() => { setNewKey(null); toast.success('API key dibuat'); }}>Saya sudah menyimpannya</button>}>
          <div className="stack">
            <Callout kind="warn">API key untuk <b>{newKey.name}</b> <b>hanya ditampilkan sekali</b>. Simpan di konfigurasi POS (header <code>X-API-Key</code>).</Callout>
            <div className="secret-box">{newKey.api_key}</div>
            <div><CopyButton text={newKey.api_key} label="Salin API key" /></div>
          </div>
        </Modal>
      )}
      {revoke && (
        <ConfirmModal
          title="Cabut API key?"
          tone="danger"
          withNote={false}
          confirmLabel="Cabut"
          description={<>POS yang memakai key <b>{revoke.name}</b> ({revoke.key_prefix}…) tidak dapat lagi mengirim order atau mengecek pembayaran.</>}
          onClose={() => setRevoke(null)}
          onConfirm={async () => {
            await api.post(`/api-clients/${revoke.id}/revoke`);
            toast.success('API key dicabut');
            void state.reload();
          }}
        />
      )}
    </Card>
  );
}
