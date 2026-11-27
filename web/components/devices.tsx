'use client';
// Komponen monitoring perangkat Android (PRD §5.2) + aksi admin (pairing, cabut token, ubah nama/nonaktifkan).
import Link from 'next/link';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { config } from '@/lib/config';
import { dateTime, num, timeAgo, timeSmart } from '@/lib/format';
import type { Device, PairingResponse } from '@/lib/types';
import { DeviceStatusBadge, IssueList, StatusSourceNote, deviceTone } from './status';
import { useToast } from './toast';
import { Badge, BoolIndicator, Callout, ConfirmModal, CopyButton, Empty, Field, Modal, Spinner, cx } from './ui';

export function TimeWithAge({ at, ageSeconds, empty = 'Belum ada' }: { at: string | null | undefined; ageSeconds?: number | null; empty?: string }) {
  if (!at) return <span className="faint">{empty}</span>;
  return (
    <div className="nowrap" title={dateTime(at)}>
      <div className="num">{timeSmart(at)}</div>
      <div className="sub">{timeAgo(at, ageSeconds)}</div>
    </div>
  );
}

export function DeviceIdentity({ d }: { d: Device }) {
  return (
    <div style={{ minWidth: 150 }}>
      <Link href={`/devices/${d.id}`} className="strong">{d.device_name}</Link>
      <div className="row" style={{ gap: 4, marginTop: 3 }}>
        {!d.is_active && <Badge tone="gray" sm>Nonaktif</Badge>}
        {!d.registered && d.pairing_pending && <Badge tone="blue" sm>Menunggu pairing</Badge>}
        {!d.registered && !d.pairing_pending && d.token_revoked_at && <Badge tone="red" sm>Token dicabut</Badge>}
        {!d.registered && !d.pairing_pending && !d.token_revoked_at && <Badge tone="gray" sm>Belum terdaftar</Badge>}
      </div>
    </div>
  );
}

export function QueueCell({ pending, failed }: { pending: number | null | undefined; failed?: number | null }) {
  const p = pending ?? null;
  return (
    <div className="nowrap">
      <span className={cx('num strong', p && p > 0 ? 'text-yellow' : undefined)}>{p === null ? '-' : num(p)}</span>
      {!!failed && <div className="sub text-red">gagal: {num(failed)}</div>}
    </div>
  );
}

/** Tabel perangkat dengan kolom sesuai PRD §5.2. */
export function DeviceTable({ devices, isAdmin, onChanged }: { devices: Device[]; isAdmin: boolean; onChanged: () => void }) {
  const [manage, setManage] = useState<Device | null>(null);
  if (!devices.length) return <Empty>Belum ada perangkat. {isAdmin ? 'Klik “Tambah perangkat” untuk membuat kode pairing.' : ''}</Empty>;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Nama perangkat</th>
              <th>Model</th>
              <th>Status aplikasi</th>
              <th>Listener</th>
              <th>Notification Access</th>
              <th>Internet</th>
              <th>Battery optimization</th>
              <th>Last heartbeat</th>
              <th>Last notification</th>
              <th>Last successful sync</th>
              <th className="num">Pending queue</th>
              <th>Versi app</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className={cx('device-row', `tone-${deviceTone(d.status)}`, !d.is_active && 'row-muted')}>
                <td><DeviceIdentity d={d} /></td>
                <td>
                  <div className="nowrap">{[d.manufacturer, d.device_model].filter(Boolean).join(' ') || <span className="faint">-</span>}</div>
                  {d.android_version && <div className="sub">Android {d.android_version}</div>}
                </td>
                <td style={{ minWidth: 210 }}>
                  <DeviceStatusBadge status={d.status} />
                  <StatusSourceNote source={d.status_source} reason={d.status_reason} />
                  <IssueList issues={d.issues} max={4} />
                </td>
                <td><BoolIndicator value={d.listener_connected} yes="Terhubung" no="Terputus" /></td>
                <td><BoolIndicator value={d.notification_access} yes="Aktif" no="Nonaktif" /></td>
                <td>
                  <BoolIndicator value={d.network_connected} yes="Terhubung" no="Terputus" />
                  {d.connection_state === 'disconnected_suspected' && <div className="sub text-orange">dugaan terputus</div>}
                </td>
                <td><BoolIndicator value={d.battery_optimization_exempt} yes="Dikecualikan" no="Dioptimalkan" warnOnly /></td>
                <td><TimeWithAge at={d.last_heartbeat_at} ageSeconds={d.heartbeat_age_seconds} /></td>
                <td><TimeWithAge at={d.last_notification_at} /></td>
                <td><TimeWithAge at={d.last_successful_sync_at} /></td>
                <td className="num"><QueueCell pending={d.pending_queue} failed={d.failed_queue} /></td>
                <td className="nowrap">{d.app_version ?? <span className="faint">-</span>}</td>
                <td className="nowrap">
                  <div className="btn-group" style={{ flexWrap: 'nowrap' }}>
                    <Link href={`/devices/${d.id}`} className="btn xs">Detail</Link>
                    {isAdmin && <button type="button" className="btn xs" onClick={() => setManage(d)}>Kelola</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {manage && <DeviceManageModal device={manage} onClose={() => setManage(null)} onChanged={onChanged} />}
    </>
  );
}

/** Kartu ringkas perangkat untuk dashboard utama. */
export function DeviceCard({ d }: { d: Device }) {
  const tone = deviceTone(d.status);
  return (
    <section className={cx('card device-card', `accent-${tone}`)}>
      <div className="card-head">
        <div>
          <Link href={`/devices/${d.id}`}><h2>{d.device_name}</h2></Link>
          <div className="hint">{[d.manufacturer, d.device_model].filter(Boolean).join(' ') || 'Model belum dilaporkan'}{d.app_version ? ` · v${d.app_version}` : ''}</div>
        </div>
        <DeviceStatusBadge status={d.status} />
      </div>
      <div className="card-body">
        <StatusSourceNote source={d.status_source} reason={d.status_reason} />
        <div className="checks">
          <div><div className="check-label">Listener</div><BoolIndicator value={d.listener_connected} yes="Terhubung" no="Terputus" /></div>
          <div><div className="check-label">Notification Access</div><BoolIndicator value={d.notification_access} yes="Aktif" no="Nonaktif" /></div>
          <div><div className="check-label">Internet</div><BoolIndicator value={d.network_connected} yes="Terhubung" no="Terputus" /></div>
          <div><div className="check-label">Battery optimization</div><BoolIndicator value={d.battery_optimization_exempt} yes="Dikecualikan" no="Dioptimalkan" warnOnly /></div>
          <div><div className="check-label">Heartbeat terakhir</div><TimeWithAge at={d.last_heartbeat_at} ageSeconds={d.heartbeat_age_seconds} /></div>
          <div><div className="check-label">Notifikasi terakhir</div><TimeWithAge at={d.last_notification_at} /></div>
          <div><div className="check-label">Sinkron terakhir</div><TimeWithAge at={d.last_successful_sync_at} /></div>
          <div><div className="check-label">Antrean belum terkirim</div><QueueCell pending={d.pending_queue} failed={d.failed_queue} /></div>
        </div>
        <IssueList issues={d.issues} />
        {d.last_error && <div className="small text-red">Error terakhir: {d.last_error}</div>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ pairing & aksi admin

export function PairingCodeModal({ result, title, onClose }: { result: PairingResponse; title: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>Selesai</button>}>
      <div className="stack">
        <div>Perangkat: <b>{result.device.device_name}</b></div>
        <div className="pairing-code" aria-label="Kode pairing">{result.pairing_code}</div>
        <div className="row-between">
          <span className="muted small">Berlaku sampai <b>{dateTime(result.device.pairing_expires_at)}</b> (24 jam, sekali pakai)</span>
          <CopyButton text={result.pairing_code} label="Salin kode" />
        </div>
        <Callout kind="info" title="Cara mendaftarkan HP Android">
          <ol className="steps">
            <li>Buka aplikasi <b>Android Monitoring</b> di HP yang menerima notifikasi bank.</li>
            <li>Pastikan alamat server di aplikasi: <code>{config.apiUrl}</code></li>
            <li>Pilih <b>Daftarkan perangkat</b>, lalu ketik kode pairing di atas (8 karakter, huruf besar).</li>
            <li>Berikan izin <b>Notification Access</b> dan kecualikan aplikasi dari <b>optimasi baterai</b>.</li>
            <li>Status perangkat di halaman ini akan berubah setelah heartbeat pertama diterima.</li>
          </ol>
        </Callout>
        <Callout kind="warn">Kode ini hanya ditampilkan sekali. Jika hilang atau kedaluwarsa, buat kode pairing baru.</Callout>
      </div>
    </Modal>
  );
}

export function AddDeviceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<PairingResponse | null>(null);

  if (result) return <PairingCodeModal result={result} title="Kode pairing perangkat baru" onClose={onClose} />;

  const submit = async () => {
    if (name.trim().length < 2) {
      setErr('Nama perangkat minimal 2 karakter');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<PairingResponse>('/devices', { device_name: name.trim() });
      setResult(r);
      toast.success('Perangkat dibuat. Masukkan kode pairing di aplikasi Android.');
      onCreated();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Tambah perangkat"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Batal</button>
          <button type="button" className="btn primary" onClick={submit} disabled={busy}>{busy && <Spinner sm />} Buat kode pairing</button>
        </>
      }
    >
      <div className="stack">
        <Field label="Nama perangkat" htmlFor="dev-name" help="Contoh: Android Monitoring 01 (kasir depan)">
          <input id="dev-name" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
        </Field>
        {err && <Callout kind="danger">{err}</Callout>}
      </div>
    </Modal>
  );
}

type ManageAction = 'pairing' | 'revoke' | 'toggle' | null;

export function DeviceManageModal({ device, onClose, onChanged }: { device: Device; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(device.device_name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ManageAction>(null);
  const [pairing, setPairing] = useState<PairingResponse | null>(null);

  if (pairing) return <PairingCodeModal result={pairing} title="Kode pairing baru" onClose={onClose} />;

  const rename = async () => {
    if (name.trim().length < 2) {
      setErr('Nama perangkat minimal 2 karakter');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.patch(`/devices/${device.id}`, { device_name: name.trim() });
      toast.success('Nama perangkat disimpan');
      onChanged();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (confirm === 'pairing') {
    return (
      <ConfirmModal
        title="Buat kode pairing baru?"
        withNote={false}
        warning={device.registered ? 'Token perangkat yang sedang terdaftar akan DICABUT. HP harus didaftarkan ulang dengan kode baru.' : undefined}
        description={<>Kode pairing lama untuk <b>{device.device_name}</b> tidak berlaku lagi.</>}
        confirmLabel="Buat kode baru"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const r = await api.post<PairingResponse>(`/devices/${device.id}/pairing-code`);
          setPairing(r);
          onChanged();
        }}
      />
    );
  }
  if (confirm === 'revoke') {
    return (
      <ConfirmModal
        title="Cabut token perangkat?"
        tone="danger"
        withNote={false}
        description={<>Perangkat <b>{device.device_name}</b> tidak dapat lagi mengirim data sampai didaftarkan ulang dengan kode pairing baru. Antrean lokal di HP tidak dihapus.</>}
        confirmLabel="Cabut token"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await api.post(`/devices/${device.id}/revoke-token`);
          toast.success('Token perangkat dicabut');
          onChanged();
          onClose();
        }}
      />
    );
  }
  if (confirm === 'toggle') {
    return (
      <ConfirmModal
        title={device.is_active ? 'Nonaktifkan perangkat?' : 'Aktifkan perangkat?'}
        tone={device.is_active ? 'danger' : 'primary'}
        withNote={false}
        description={device.is_active
          ? 'Perangkat nonaktif tidak dievaluasi untuk alert dan tidak tampil di dashboard utama.'
          : 'Perangkat akan kembali dipantau dan dievaluasi untuk alert.'}
        confirmLabel={device.is_active ? 'Nonaktifkan' : 'Aktifkan'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await api.patch(`/devices/${device.id}`, { is_active: !device.is_active });
          toast.success(device.is_active ? 'Perangkat dinonaktifkan' : 'Perangkat diaktifkan');
          onChanged();
          onClose();
        }}
      />
    );
  }

  return (
    <Modal title={`Kelola: ${device.device_name}`} onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Tutup</button>}>
      <div className="stack">
        <Field label="Nama perangkat" htmlFor="rename">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input id="rename" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="btn primary" onClick={rename} disabled={busy || name.trim() === device.device_name}>{busy && <Spinner sm />} Simpan</button>
          </div>
        </Field>
        {err && <Callout kind="danger">{err}</Callout>}
        <dl className="kv compact">
          <dt>Terdaftar</dt><dd>{device.registered ? `Ya, sejak ${dateTime(device.registered_at)}` : 'Belum'}</dd>
          <dt>Token diterbitkan</dt><dd>{dateTime(device.token_issued_at)}</dd>
          <dt>Token dicabut</dt><dd>{device.token_revoked_at ? dateTime(device.token_revoked_at) : '-'}</dd>
          <dt>Kode pairing</dt><dd>{device.pairing_pending ? `Aktif sampai ${dateTime(device.pairing_expires_at)}` : 'Tidak ada'}</dd>
        </dl>
        <hr style={{ margin: '4px 0' }} />
        <div className="stack" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={() => setConfirm('pairing')}>🔑 Buat ulang kode pairing</button>
          <button type="button" className="btn danger-outline" onClick={() => setConfirm('revoke')} disabled={!device.registered}>⛔ Cabut token perangkat</button>
          <button type="button" className={cx('btn', device.is_active ? 'danger-outline' : 'success')} onClick={() => setConfirm('toggle')}>
            {device.is_active ? 'Nonaktifkan perangkat' : 'Aktifkan perangkat'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
