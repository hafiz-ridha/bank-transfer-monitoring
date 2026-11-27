'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useToast } from '@/components/toast';
import {
  AdminOnlyNotice, Badge, Callout, Card, DataState, Field, Modal, PageHeader, Spinner, Switch, JsonView,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, num, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { BankNotification, BankSource, ListResponse } from '@/lib/types';

/** Package name aplikasi bank Indonesia yang umum (WAJIB dicek ulang di HP asli). */
const BANK_APP_PRESETS = [
  { label: 'BCA mobile', bank_code: 'BCA', bank_name: 'Bank Central Asia', package_name: 'com.bca', parser_key: 'bca' },
  { label: 'myBCA', bank_code: 'BCA', bank_name: 'Bank Central Asia', package_name: 'com.bca.mybca.omni.android', parser_key: 'bca' },
  { label: 'BRImo', bank_code: 'BRI', bank_name: 'Bank Rakyat Indonesia', package_name: 'id.co.bri.brimo', parser_key: 'bri' },
  { label: "Livin' by Mandiri", bank_code: 'MANDIRI', bank_name: 'Bank Mandiri', package_name: 'id.bmri.livin', parser_key: 'mandiri' },
  { label: 'BNI Mobile Banking', bank_code: 'BNI', bank_name: 'Bank Negara Indonesia', package_name: 'src.com.bni', parser_key: 'bni' },
  { label: 'wondr by BNI', bank_code: 'BNI', bank_name: 'Bank Negara Indonesia', package_name: 'id.bni.wondr', parser_key: 'bni' },
  { label: 'BSI Mobile', bank_code: 'BSI', bank_name: 'Bank Syariah Indonesia', package_name: 'com.bsm.activity2', parser_key: 'bsi' },
];

interface FormState {
  bank_code: string;
  bank_name: string;
  package_name: string;
  account_alias: string;
  account_identifier: string;
  account_holder: string;
  parser_key: string;
  is_default: boolean;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  bank_code: '', bank_name: '', package_name: '', account_alias: '', account_identifier: '', account_holder: '', parser_key: '', is_default: true, is_active: true,
};

export default function BankSourcesPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const state = useApi<ListResponse<BankSource>>('/bank-sources');
  const [editing, setEditing] = useState<BankSource | 'new' | null>(null);
  const [viewing, setViewing] = useState<BankSource | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const patch = async (b: BankSource, body: Partial<FormState>, msg: string) => {
    setBusyId(b.id);
    try {
      await api.patch(`/bank-sources/${b.id}`, body);
      toast.success(msg);
      await state.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Sumber bank"
        subtitle="Aplikasi bank yang notifikasinya dibaca HP Android. Hanya package yang aktif yang diproses."
        updatedAt={state.updatedAt}
        onRefresh={() => void state.reload()}
        actions={isAdmin && <button type="button" className="btn primary" onClick={() => setEditing('new')}>+ Tambah sumber bank</button>}
      />
      {!isAdmin && <div className="mb-3"><AdminOnlyNotice what="menambah atau mengubah sumber bank" /></div>}
      <Card flush>
        <DataState state={state} isEmpty={(d) => d.data.length === 0} empty="Belum ada sumber bank. Tambahkan aplikasi bank yang dipakai di HP monitoring.">
          {(d) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nama bank</th>
                    <th>Package name</th>
                    <th>Alias rekening</th>
                    <th>Identitas rekening</th>
                    <th>Aktif</th>
                    <th>Versi parser</th>
                    <th>Notifikasi terakhir</th>
                    <th className="num">Error parser 7 hari</th>
                    <th>Error parser terakhir</th>
                    <th className="num">Transaksi</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.data.map((b) => (
                    <tr key={b.id} className={b.is_active ? undefined : 'row-muted'}>
                      <td>
                        <div className="strong">{b.bank_name}</div>
                        <div className="row" style={{ gap: 4 }}>
                          <Badge tone="blue" sm>{b.bank_code}</Badge>
                          {b.is_default && <Badge tone="teal" sm title="Rekening default untuk package ini">Default</Badge>}
                        </div>
                      </td>
                      <td className="mono small break">{b.package_name}</td>
                      <td>{b.account_alias}</td>
                      <td>{b.account_identifier ?? <span className="faint">-</span>}{b.account_holder && <div className="sub">{b.account_holder}</div>}</td>
                      <td>
                        {isAdmin ? (
                          <Switch ariaLabel={`Aktifkan ${b.account_alias}`} checked={b.is_active} disabled={busyId === b.id} onChange={(v) => void patch(b, { is_active: v }, v ? 'Sumber bank diaktifkan' : 'Sumber bank dinonaktifkan')} />
                        ) : (
                          <Badge tone={b.is_active ? 'green' : 'gray'} sm>{b.is_active ? 'Aktif' : 'Nonaktif'}</Badge>
                        )}
                      </td>
                      <td className="small">{b.parser_key ?? '-'}<div className="sub">{b.parser_version ?? 'belum ada data'}</div></td>
                      <td className="nowrap">{b.last_notification_at ? <>{dateTime(b.last_notification_at, false)}<div className="sub">{timeAgo(b.last_notification_at)}</div></> : <span className="faint">Belum ada</span>}</td>
                      <td className={b.parse_errors_7d > 0 ? 'num strong text-red' : 'num'}>{num(b.parse_errors_7d)}</td>
                      <td className="small break" style={{ maxWidth: 260 }}>
                        {b.last_parse_error ? <><span className="text-red">{b.last_parse_error}</span><div className="sub">{dateTime(b.last_parse_error_at, false)}</div></> : <span className="faint">-</span>}
                      </td>
                      <td className="num">{num(b.transaction_count)}</td>
                      <td>
                        <div className="btn-group" style={{ flexWrap: 'nowrap' }}>
                          <button type="button" className="btn xs" onClick={() => setViewing(b)}>Notifikasi</button>
                          {isAdmin && <button type="button" className="btn xs" onClick={() => setEditing(b)}>Ubah</button>}
                          {isAdmin && !b.is_default && (
                            <button type="button" className="btn xs" disabled={busyId === b.id} onClick={() => void patch(b, { is_default: true }, `${b.account_alias} dijadikan default`)}>Jadikan default</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataState>
      </Card>
      <div className="small muted mt-2">
        <b>Default</b>: jika satu aplikasi bank (package) dipakai untuk beberapa rekening, notifikasi yang tidak menyebut rekening dimasukkan ke rekening default.
        Perubahan sumber bank dikirim ke HP saat heartbeat berikutnya (config_version berubah).
      </div>

      {editing && (
        <BankSourceModal source={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => void state.reload()} />
      )}
      {viewing && <NotificationsModal source={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function BankSourceModal({ source, onClose, onSaved }: { source: BankSource | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<FormState>(() => source ? {
    bank_code: source.bank_code,
    bank_name: source.bank_name,
    package_name: source.package_name,
    account_alias: source.account_alias,
    account_identifier: source.account_identifier ?? '',
    account_holder: source.account_holder ?? '',
    parser_key: source.parser_key ?? '',
    is_default: source.is_default,
    is_active: source.is_active,
  } : EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));

  const applyPreset = (label: string) => {
    const p = BANK_APP_PRESETS.find((x) => x.label === label);
    if (!p) return;
    setF((x) => ({
      ...x,
      bank_code: p.bank_code,
      bank_name: p.bank_name,
      package_name: p.package_name,
      parser_key: p.parser_key,
      account_alias: x.account_alias || `${p.bank_code} Utama`,
    }));
  };

  const save = async () => {
    setErr(null);
    const code = f.bank_code.trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,30}$/.test(code)) return setErr('Kode bank hanya huruf besar, angka, atau _ (2–30 karakter)');
    if (f.bank_name.trim().length < 2) return setErr('Nama bank wajib diisi');
    if (!/^[a-zA-Z0-9_.]{3,200}$/.test(f.package_name.trim())) return setErr('Package name tidak valid (contoh: com.bca)');
    if (!f.account_alias.trim()) return setErr('Alias rekening wajib diisi');
    const body = {
      bank_code: code,
      bank_name: f.bank_name.trim(),
      package_name: f.package_name.trim(),
      account_alias: f.account_alias.trim(),
      account_identifier: f.account_identifier.trim() || null,
      account_holder: f.account_holder.trim() || null,
      parser_key: f.parser_key.trim() || null,
      is_default: f.is_default,
      is_active: f.is_active,
    };
    setBusy(true);
    try {
      if (source) await api.patch(`/bank-sources/${source.id}`, body);
      else await api.post('/bank-sources', body);
      toast.success(source ? 'Sumber bank disimpan' : 'Sumber bank ditambahkan');
      onSaved();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      size="lg"
      title={source ? `Ubah sumber bank: ${source.account_alias}` : 'Tambah sumber bank'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>{busy && <Spinner sm />} Simpan</button>
        </>
      }
    >
      <div className="stack">
        <Field label="Template aplikasi bank (opsional)" htmlFor="preset" help="Mengisi kode bank, nama bank, package name, dan parser secara otomatis.">
          <select id="preset" className="select" defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
            <option value="">— Pilih aplikasi bank umum —</option>
            {BANK_APP_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label} ({p.package_name})</option>)}
          </select>
        </Field>
        <Callout kind="warn">
          Package name dapat berbeda antar versi/region aplikasi. <b>Verifikasi di HP asli</b> (Pengaturan › Aplikasi › info aplikasi,
          atau daftar notifikasi terdeteksi di aplikasi Android Monitoring) sebelum mengaktifkan.
        </Callout>
        <div className="form-grid">
          <Field label="Kode bank" htmlFor="bs-code" help="Huruf besar/angka/_ mis. BCA, BRI, MANDIRI">
            <input id="bs-code" className="input" value={f.bank_code} onChange={(e) => set('bank_code', e.target.value.toUpperCase())} maxLength={30} />
          </Field>
          <Field label="Nama bank" htmlFor="bs-name">
            <input id="bs-name" className="input" value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} maxLength={100} />
          </Field>
          <Field label="Package name aplikasi" htmlFor="bs-pkg" className="full">
            <input id="bs-pkg" className="input mono" value={f.package_name} onChange={(e) => set('package_name', e.target.value)} placeholder="com.bca" maxLength={200} />
          </Field>
          <Field label="Alias rekening" htmlFor="bs-alias" help="Nama tampilan, mis. BCA Toko">
            <input id="bs-alias" className="input" value={f.account_alias} onChange={(e) => set('account_alias', e.target.value)} maxLength={100} />
          </Field>
          <Field label="Identitas rekening (opsional)" htmlFor="bs-acc" help="Mis. 4 digit terakhir; dipakai validasi rekening penerima (+5 skor)">
            <input id="bs-acc" className="input" value={f.account_identifier} onChange={(e) => set('account_identifier', e.target.value)} maxLength={40} />
          </Field>
          <Field label="Nama pemilik rekening (opsional)" htmlFor="bs-holder">
            <input id="bs-holder" className="input" value={f.account_holder} onChange={(e) => set('account_holder', e.target.value)} maxLength={200} />
          </Field>
          <Field label="Parser key" htmlFor="bs-parser" help="Kosong = kode bank huruf kecil">
            <input id="bs-parser" className="input mono" value={f.parser_key} onChange={(e) => set('parser_key', e.target.value)} maxLength={60} />
          </Field>
          <div className="full row" style={{ gap: 24 }}>
            <Switch checked={f.is_active} onChange={(v) => set('is_active', v)} label="Aktif (notifikasi diproses)" />
            <Switch checked={f.is_default} onChange={(v) => set('is_default', v)} label="Rekening default untuk package ini" />
          </div>
        </div>
        {err && <Callout kind="danger">{err}</Callout>}
      </div>
    </Modal>
  );
}

function NotificationsModal({ source, onClose }: { source: BankSource; onClose: () => void }) {
  const state = useApi<ListResponse<BankNotification>>(`/bank-sources/${source.id}/notifications`);
  return (
    <Modal size="xl" title={`50 notifikasi terakhir — ${source.bank_code} ${source.account_alias}`} onClose={onClose}
      footer={<button type="button" className="btn" onClick={onClose}>Tutup</button>}>
      <DataState state={state} isEmpty={(d) => d.data.length === 0} empty="Belum ada notifikasi dari sumber ini.">
        {(d) => (
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Diterima</th><th>Klasifikasi</th><th>Parse</th><th>Teks</th><th>Hasil</th><th>Transaksi</th></tr></thead>
              <tbody>
                {d.data.map((n) => (
                  <tr key={n.id} className={n.parse_status === 'ERROR' ? 'row-bad' : undefined}>
                    <td className="nowrap num">{dateTime(n.server_received_at)}</td>
                    <td className="small">{n.classification}</td>
                    <td>
                      <Badge tone={n.parse_status === 'PARSED' ? 'green' : n.parse_status === 'ERROR' ? 'red' : 'gray'} sm>{n.parse_status}</Badge>
                      {n.parse_error && <div className="sub text-red">{n.parse_error}</div>}
                      {n.parser_version && <div className="sub">{n.parser_version}</div>}
                    </td>
                    <td className="small break" style={{ maxWidth: 340 }}>
                      {n.title && <div className="strong">{n.title}</div>}
                      {n.text ?? <span className="faint">(teks mentah tidak tersedia)</span>}
                    </td>
                    <td className="json-cell"><JsonView value={n.parsed} summary="parsed" /></td>
                    <td>{n.transaction_id ? <Link href={`/transactions/${n.transaction_id}`} className="btn xs">Lihat</Link> : <span className="faint">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataState>
    </Modal>
  );
}
