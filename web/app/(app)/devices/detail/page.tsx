'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AlertList } from '@/components/alerts';
import { DeviceManageModal, QueueCell, TimeWithAge } from '@/components/devices';
import { ConnectionBadge, DeviceStatusBadge, IssueList, SeverityBadge, StatusSourceNote } from '@/components/status';
import {
  Badge, BoolIndicator, Callout, Card, DataState, Empty, ErrorBox, JsonView, Loading, PageHeader, Pagination, Tabs, cx,
} from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { dateTime, duration, num, timeAgo } from '@/lib/format';
import { useApi, type ApiState } from '@/lib/hooks';
import { TRIGGER_LABEL, eventTypeLabel } from '@/lib/labels';
import type {
  Alert, AppVersionRow, Device, DeviceEvent, DeviceHealth, Heartbeat, ListResponse, Paged, ParseErrorRow,
} from '@/lib/types';

type TabKey = 'heartbeat' | 'service' | 'permission' | 'sync' | 'parser' | 'versions' | 'events' | 'alerts';

const SERVICE_TYPES = ['LISTENER_DISCONNECTED', 'LISTENER_LOST', 'LISTENER_CONNECTED', 'LISTENER_RESTORED', 'LISTENER_REBIND_REQUESTED'];
const PERMISSION_TYPES = ['PERMISSION_LOST', 'PERMISSION_RESTORED', 'PERMISSION_REVOKED', 'PERMISSION_GRANTED'];
const SYNC_TYPES = ['SYNC_FAILED', 'SYNC_RECOVERED', 'NETWORK_LOST', 'NETWORK_RESTORED'];
const GAP_WARN_SECONDS = 300;

export default function DeviceDetailPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DeviceDetail />
    </Suspense>
  );
}

function DeviceDetail() {
  const id = useSearchParams().get('id') ?? '';
  const { isAdmin } = useAuth();
  const device = useApi<Device>(`/devices/${id}`, undefined, { poll: true });
  const health = useApi<DeviceHealth>(`/devices/${id}/health`, undefined, { poll: true });
  const [tab, setTab] = useState<TabKey>('heartbeat');
  const [manage, setManage] = useState(false);
  const d = device.data;

  const reloadAll = () => {
    void device.reload();
    void health.reload();
  };

  if (device.error && !d) {
    return (
      <>
        <PageHeader title="Detail perangkat" breadcrumb={[{ href: '/devices', label: 'Perangkat' }]} />
        <ErrorBox error={device.error} onRetry={() => void device.reload()} />
      </>
    );
  }
  if (!d) return <Loading />;

  return (
    <>
      <PageHeader
        breadcrumb={[{ href: '/devices', label: 'Perangkat' }]}
        title={<span className="row" style={{ gap: 10 }}>{d.device_name} <DeviceStatusBadge status={d.status} />{!d.is_active && <Badge tone="gray">Nonaktif</Badge>}</span>}
        subtitle={[d.manufacturer, d.device_model, d.android_version && `Android ${d.android_version}`, d.app_version && `app v${d.app_version}`].filter(Boolean).join(' · ') || 'Perangkat belum mengirim informasi model'}
        updatedAt={device.updatedAt}
        onRefresh={reloadAll}
        live
        actions={isAdmin && <button type="button" className="btn" onClick={() => setManage(true)}>Kelola perangkat</button>}
      />

      {!d.registered && (
        <div className="mb-3">
          <Callout kind="info" title={d.pairing_pending ? 'Menunggu HP didaftarkan' : 'Perangkat belum terdaftar'}>
            {d.pairing_pending
              ? <>Kode pairing aktif sampai {dateTime(d.pairing_expires_at)}. Ketik kode di aplikasi Android untuk mendaftar.</>
              : <>Token tidak aktif{d.token_revoked_at ? ` (dicabut ${dateTime(d.token_revoked_at)})` : ''}. {isAdmin ? 'Buat kode pairing baru melalui “Kelola perangkat”.' : 'Minta admin membuat kode pairing baru.'}</>}
          </Callout>
        </div>
      )}

      <div className="grid grid-3 mb-3">
        <div className="span-2">
          <HealthPanel state={health} />
        </div>
        <Card title="Info perangkat">
          <dl className="kv compact">
            <dt>Device UUID</dt><dd className="mono small break">{d.device_uuid ?? '-'}</dd>
            <dt>Model</dt><dd>{[d.manufacturer, d.device_model].filter(Boolean).join(' ') || '-'}</dd>
            <dt>Android</dt><dd>{d.android_version ?? '-'}</dd>
            <dt>Versi aplikasi</dt><dd>{d.app_version ?? '-'}</dd>
            <dt>Status berubah</dt><dd>{dateTime(d.status_changed_at)}</dd>
            <dt>Terakhir terlihat</dt><dd>{d.last_seen_at ? `${dateTime(d.last_seen_at)} (${timeAgo(d.last_seen_at)})` : '-'}</dd>
            <dt>Dilaporkan HP</dt><dd>{dateTime(d.last_reported_at)}</dd>
            <dt>Terdaftar</dt><dd>{d.registered ? dateTime(d.registered_at) : 'Belum'}</dd>
            <dt>Token diterbitkan</dt><dd>{dateTime(d.token_issued_at)}</dd>
            <dt>Dibuat</dt><dd>{dateTime(d.created_at)}</dd>
          </dl>
        </Card>
      </div>

      <div className="card">
        <Tabs<TabKey>
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'heartbeat', label: 'Riwayat heartbeat' },
            { key: 'service', label: 'Service terputus' },
            { key: 'permission', label: 'Kehilangan izin' },
            { key: 'sync', label: 'Sinkronisasi gagal' },
            { key: 'parser', label: 'Error parser', count: health.data?.last_24h.parse_errors || null },
            { key: 'versions', label: 'Versi aplikasi' },
            { key: 'events', label: 'Semua event' },
            { key: 'alerts', label: 'Alert' },
          ]}
        />
        {tab === 'heartbeat' && <HeartbeatTab id={id} />}
        {tab === 'service' && <EventsTab id={id} types={SERVICE_TYPES} empty="Tidak ada riwayat listener terputus/tersambung." />}
        {tab === 'permission' && <EventsTab id={id} types={PERMISSION_TYPES} empty="Tidak ada riwayat perubahan Notification Access." />}
        {tab === 'sync' && <EventsTab id={id} types={SYNC_TYPES} empty="Tidak ada riwayat sinkronisasi gagal / internet terputus." />}
        {tab === 'parser' && <ParseErrorsTab id={id} />}
        {tab === 'versions' && <AppVersionsTab id={id} />}
        {tab === 'events' && <EventsTab id={id} empty="Belum ada event." />}
        {tab === 'alerts' && <DeviceAlertsTab id={id} />}
      </div>

      {manage && <DeviceManageModal device={d} onClose={() => setManage(false)} onChanged={reloadAll} />}
    </>
  );
}

function HealthPanel({ state }: { state: ApiState<DeviceHealth> }) {
  return (
    <Card title="Kesehatan perangkat" hint="Dihitung server dari heartbeat terakhir & laporan perangkat">
      <DataState state={state}>
        {(h) => (
          <div className="stack">
            <div className="row" style={{ gap: 12 }}>
              <DeviceStatusBadge status={h.status} />
              <ConnectionBadge state={h.connection_state} />
              <span className="muted small">Heartbeat terakhir: <b>{h.heartbeat_age_seconds == null ? 'belum pernah' : `${duration(h.heartbeat_age_seconds)} lalu`}</b></span>
            </div>
            <StatusSourceNote source={h.status_source} reason={h.status_reason} />
            <IssueList issues={h.issues} />
            <div className="grid grid-4">
              <Check label="Listener"><BoolIndicator value={h.checks.listener_connected} yes="Terhubung" no="Terputus" /></Check>
              <Check label="Notification Access"><BoolIndicator value={h.checks.notification_access} yes="Aktif" no="Nonaktif" /></Check>
              <Check label="Internet"><BoolIndicator value={h.checks.network_connected} yes="Terhubung" no="Terputus" /></Check>
              <Check label="Battery optimization"><BoolIndicator value={h.checks.battery_optimization_exempt} yes="Dikecualikan" no="Dioptimalkan" warnOnly /></Check>
              <Check label="Background dibatasi"><BoolIndicator value={h.checks.background_restricted} yes="Dibatasi" no="Tidak" goodWhen={false} warnOnly /></Check>
              <Check label="Antrean belum terkirim"><QueueCell pending={h.checks.pending_queue} /></Check>
              <Check label="Antrean gagal"><span className={cx('num strong', (h.checks.failed_queue ?? 0) > 0 && 'text-red')}>{h.checks.failed_queue ?? '-'}</span></Check>
              <Check label="Error parser 24 jam"><span className={cx('num strong', h.last_24h.parse_errors > 0 && 'text-red')}>{num(h.last_24h.parse_errors)}</span></Check>
            </div>
            <div className="grid grid-4">
              <Check label="Last heartbeat"><TimeWithAge at={h.timestamps.last_heartbeat_at} ageSeconds={h.heartbeat_age_seconds} /></Check>
              <Check label="Last notification"><TimeWithAge at={h.timestamps.last_notification_at} /></Check>
              <Check label="Last successful sync"><TimeWithAge at={h.timestamps.last_successful_sync_at} /></Check>
              <Check label="Listener terakhir terhubung"><TimeWithAge at={h.timestamps.last_listener_connected_at} /></Check>
            </div>
            <div className="small muted">
              24 jam terakhir: <b>{num(h.last_24h.heartbeats)}</b> heartbeat · listener terputus di <b>{num(h.last_24h.listener_down)}</b> heartbeat ·
              izin nonaktif di <b>{num(h.last_24h.permission_down)}</b> heartbeat · antrean maks <b>{h.last_24h.max_pending_queue ?? 0}</b>
            </div>
            {h.last_error && <Callout kind="danger" title="Error terakhir dari perangkat">{h.last_error}</Callout>}
          </div>
        )}
      </DataState>
    </Card>
  );
}

function Check({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="check-label">{label}</div>
      {children}
    </div>
  );
}

function usePaged<T>(path: string, query: Record<string, string | number | undefined>, poll = false) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const state = useApi<Paged<T>>(path, { ...query, page, page_size: pageSize }, { poll });
  return { state, page, setPage, pageSize, setPageSize: (n: number) => { setPageSize(n); setPage(1); } };
}

function HeartbeatTab({ id }: { id: string }) {
  const { state, setPage, pageSize, setPageSize } = usePaged<Heartbeat>(`/devices/${id}/heartbeats`, {}, true);
  return (
    <DataState state={state} isEmpty={(d) => d.data.length === 0} empty="Belum ada heartbeat yang diterima.">
      {(d) => (
        <>
          <div className="card-body small muted" style={{ paddingBottom: 0 }}>
            Baris merah = jeda dari heartbeat sebelumnya lebih dari {GAP_WARN_SECONDS / 60} menit (kemungkinan HP mati, tanpa internet, atau aplikasi dihentikan sistem).
          </div>
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Diterima server</th>
                  <th>Dilaporkan HP</th>
                  <th>Jeda</th>
                  <th>Trigger</th>
                  <th>Listener</th>
                  <th>Notif. Access</th>
                  <th>Internet</th>
                  <th>Battery</th>
                  <th className="num">Pending</th>
                  <th className="num">Gagal</th>
                  <th>Versi</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {d.data.map((h) => {
                  const gapBad = (h.gap_seconds ?? 0) > GAP_WARN_SECONDS;
                  return (
                    <tr key={h.id} className={cx(gapBad && 'row-bad')}>
                      <td className="nowrap num">{dateTime(h.received_at)}</td>
                      <td className="nowrap num muted">{dateTime(h.reported_at)}</td>
                      <td className={cx('nowrap', gapBad && 'text-red strong')}>{h.gap_seconds == null ? '-' : `${gapBad ? '⚠ ' : ''}${duration(h.gap_seconds)}`}</td>
                      <td>{TRIGGER_LABEL[h.trigger ?? ''] ?? h.trigger ?? '-'}</td>
                      <td><BoolIndicator value={h.listener_connected} yes="Ya" no="Terputus" /></td>
                      <td><BoolIndicator value={h.notification_access} yes="Aktif" no="Nonaktif" /></td>
                      <td><BoolIndicator value={h.network_connected} yes="Ya" no="Terputus" /></td>
                      <td><BoolIndicator value={h.battery_optimization_exempt} yes="Exempt" no="Optimized" warnOnly /></td>
                      <td className="num">{h.pending_queue ?? '-'}</td>
                      <td className={cx('num', (h.failed_queue ?? 0) > 0 && 'text-red')}>{h.failed_queue ?? '-'}</td>
                      <td>{h.app_version ?? '-'}</td>
                      <td className="small text-red break">{h.last_error ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination pagination={d.pagination} onPage={setPage} pageSize={pageSize} onPageSize={setPageSize} sizes={[50, 100, 200, 500]} />
        </>
      )}
    </DataState>
  );
}

function EventsTab({ id, types, empty }: { id: string; types?: string[]; empty: string }) {
  const { state, setPage, pageSize, setPageSize } = usePaged<DeviceEvent>(`/devices/${id}/events`, { type: types?.join(',') }, true);
  return (
    <DataState state={state} isEmpty={(d) => d.data.length === 0} empty={empty}>
      {(d) => (
        <>
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Waktu kejadian</th>
                  <th>Event</th>
                  <th>Sumber</th>
                  <th>Severity</th>
                  <th>Pesan</th>
                  <th>Data</th>
                  <th>Diterima</th>
                </tr>
              </thead>
              <tbody>
                {d.data.map((e) => (
                  <tr key={e.id} className={cx(['error', 'critical'].includes(e.severity) && 'row-bad', e.severity === 'warning' && 'row-warn')}>
                    <td className="nowrap num">{dateTime(e.occurred_at)}</td>
                    <td>
                      <div className="strong">{eventTypeLabel(e.event_type)}</div>
                      <div className="sub mono">{e.event_type}</div>
                    </td>
                    <td>{e.source === 'server' ? <Badge tone="purple" sm>Server</Badge> : <Badge tone="blue" sm>Perangkat</Badge>}</td>
                    <td><SeverityBadge severity={e.severity} /></td>
                    <td className="break">{e.message ?? <span className="faint">-</span>}</td>
                    <td className="json-cell"><JsonView value={e.data} summary="data" /></td>
                    <td className="nowrap num muted">{dateTime(e.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination pagination={d.pagination} onPage={setPage} pageSize={pageSize} onPageSize={setPageSize} sizes={[50, 100, 200]} />
        </>
      )}
    </DataState>
  );
}

function ParseErrorsTab({ id }: { id: string }) {
  const { state, setPage, pageSize, setPageSize } = usePaged<ParseErrorRow>(`/devices/${id}/parse-errors`, {});
  return (
    <DataState state={state} isEmpty={(d) => d.data.length === 0} empty="Tidak ada error parser dari perangkat ini.">
      {(d) => (
        <>
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Diterima server</th>
                  <th>Bank / rekening</th>
                  <th>Package</th>
                  <th>Parser</th>
                  <th>Error</th>
                  <th>Teks notifikasi</th>
                </tr>
              </thead>
              <tbody>
                {d.data.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap num">{dateTime(p.server_received_at)}</td>
                    <td>{p.bank_code ?? '-'}<div className="sub">{p.account_alias ?? ''}</div></td>
                    <td className="mono small">{p.package_name}</td>
                    <td className="small">{p.parser_key ?? '-'}<div className="sub">{p.parser_version ?? ''}</div></td>
                    <td className="text-red small break">{p.parse_error ?? '-'}</td>
                    <td className="small break" style={{ maxWidth: 380 }}>
                      {p.title && <div className="strong">{p.title}</div>}
                      {p.text ?? <span className="faint">(teks mentah tidak tersedia)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination pagination={d.pagination} onPage={setPage} pageSize={pageSize} onPageSize={setPageSize} sizes={[50, 100, 200]} />
        </>
      )}
    </DataState>
  );
}

function AppVersionsTab({ id }: { id: string }) {
  const state = useApi<ListResponse<AppVersionRow>>(`/devices/${id}/app-versions`);
  return (
    <DataState state={state} isEmpty={(d) => d.data.length === 0} empty="Belum ada data versi aplikasi.">
      {(d) => (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Versi aplikasi</th><th>Pertama terlihat</th><th>Terakhir terlihat</th><th className="num">Jumlah heartbeat</th></tr>
            </thead>
            <tbody>
              {d.data.map((v, i) => (
                <tr key={v.app_version}>
                  <td className="strong">{v.app_version} {i === 0 && <Badge tone="blue" sm>terbaru</Badge>}</td>
                  <td className="num">{dateTime(v.first_seen_at)}</td>
                  <td className="num">{dateTime(v.last_seen_at)}</td>
                  <td className="num">{num(v.heartbeats)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DataState>
  );
}

function DeviceAlertsTab({ id }: { id: string }) {
  const active = useApi<ListResponse<Alert>>('/alerts', { status: 'active', device_id: id }, { poll: true });
  const resolved = useApi<ListResponse<Alert>>('/alerts', { status: 'RESOLVED', device_id: id, limit: 50 });
  return (
    <div>
      <div className="card-body" style={{ paddingBottom: 0 }}><h3>Aktif</h3></div>
      <DataState state={active}>
        {(d) => <AlertList alerts={d.data} onChanged={() => void active.reload()} emptyText="Tidak ada alert aktif untuk perangkat ini." />}
      </DataState>
      <div className="card-body" style={{ paddingBottom: 0, borderTop: '1px solid var(--border)' }}><h3>Sudah selesai (50 terakhir)</h3></div>
      <DataState state={resolved}>
        {(d) => d.data.length ? <AlertList alerts={d.data} onChanged={() => void resolved.reload()} /> : <Empty>Belum ada alert yang selesai.</Empty>}
      </DataState>
    </div>
  );
}
