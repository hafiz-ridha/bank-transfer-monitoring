'use client';
import { useState } from 'react';
import { useToast } from '@/components/toast';
import { Badge, Callout, Card, ConfirmModal, DataState, Field, Modal, PageHeader, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { ROLE_LABEL } from '@/lib/labels';
import type { ListResponse, Role, UserRow } from '@/lib/types';

export default function UsersPage() {
  const { isAdmin, user: me, mode } = useAuth();
  const toast = useToast();
  const state = useApi<ListResponse<UserRow>>(isAdmin ? '/users' : null);
  const [adding, setAdding] = useState(false);
  const [toggle, setToggle] = useState<UserRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Pengguna" />
        <Callout kind="warn" title="Khusus admin">Halaman ini hanya dapat diakses oleh admin.</Callout>
      </>
    );
  }

  const changeRole = async (u: UserRow, role: Role) => {
    setBusyId(u.id);
    try {
      await api.patch(`/users/${u.id}`, { role });
      toast.success(`Role ${u.email} diubah menjadi ${ROLE_LABEL[role]}`);
      await state.reload();
    } catch (e) {
      toast.error(errorMessage(e));
      await state.reload();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Pengguna dashboard"
        subtitle="Admin: akses penuh. Operator: melihat semua data & verifikasi manual, tanpa mengubah pengaturan, perangkat, sumber bank, pengguna, atau API key."
        updatedAt={state.updatedAt}
        onRefresh={() => void state.reload()}
        actions={<button type="button" className="btn primary" onClick={() => setAdding(true)}>+ Tambah pengguna</button>}
      />
      <Card flush>
        <DataState state={state} isEmpty={(d) => d.data.length === 0} empty="Belum ada pengguna.">
          {(d) => (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Email</th><th>Nama</th><th>Role</th><th>Status</th><th>Login terakhir</th><th>Dibuat</th><th /></tr></thead>
                <tbody>
                  {d.data.map((u) => {
                    const self = u.id === me?.id;
                    return (
                      <tr key={u.id} className={u.is_active ? undefined : 'row-muted'}>
                        <td className="strong">{u.email} {self && <Badge tone="blue" sm>Anda</Badge>}</td>
                        <td>{u.full_name ?? <span className="faint">-</span>}</td>
                        <td>
                          <select className="select sm" style={{ width: 'auto' }} value={u.role} disabled={self || busyId === u.id}
                            onChange={(e) => void changeRole(u, e.target.value as Role)} aria-label={`Role ${u.email}`}>
                            <option value="admin">Admin</option>
                            <option value="operator">Operator</option>
                          </select>
                        </td>
                        <td>{u.is_active ? <Badge tone="green" sm>Aktif</Badge> : <Badge tone="gray" sm>Nonaktif</Badge>}</td>
                        <td className="nowrap">{u.last_login_at ? <>{dateTime(u.last_login_at, false)}<div className="sub">{timeAgo(u.last_login_at)}</div></> : <span className="faint">Belum pernah</span>}</td>
                        <td className="nowrap num">{dateTime(u.created_at, false)}</td>
                        <td>
                          {!self && (
                            <button type="button" className={`btn xs ${u.is_active ? 'danger-outline' : ''}`} onClick={() => setToggle(u)}>
                              {u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataState>
      </Card>
      <div className="small muted mt-2">
        Anda tidak dapat menurunkan role atau menonaktifkan akun sendiri. Minimal harus ada satu admin aktif.
        {mode === 'supabase' && ' Pengguna tanpa password awal menerima email undangan dari Supabase untuk membuat password.'}
      </div>

      {adding && <AddUserModal supabase={mode === 'supabase'} onClose={() => setAdding(false)} onCreated={() => void state.reload()} />}
      {toggle && (
        <ConfirmModal
          title={toggle.is_active ? 'Nonaktifkan pengguna?' : 'Aktifkan pengguna?'}
          tone={toggle.is_active ? 'danger' : 'primary'}
          withNote={false}
          confirmLabel={toggle.is_active ? 'Nonaktifkan' : 'Aktifkan'}
          description={toggle.is_active
            ? <><b>{toggle.email}</b> tidak dapat lagi mengakses dashboard (sesi aktif ditolak pada request berikutnya).</>
            : <><b>{toggle.email}</b> dapat kembali login ke dashboard.</>}
          onClose={() => setToggle(null)}
          onConfirm={async () => {
            await api.patch(`/users/${toggle.id}`, { is_active: !toggle.is_active });
            toast.success(toggle.is_active ? 'Pengguna dinonaktifkan' : 'Pengguna diaktifkan');
            await state.reload();
          }}
        />
      )}
    </>
  );
}

function AddUserModal({ supabase, onClose, onCreated }: { supabase: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErr('Email tidak valid');
    if (password && password.length < 8) return setErr('Password awal minimal 8 karakter');
    setBusy(true);
    try {
      const r = await api.post<UserRow>('/users', {
        email: email.trim().toLowerCase(),
        role,
        full_name: fullName.trim() || null,
        ...(supabase && password ? { password } : {}),
      });
      toast.success(r.invited ? `Undangan dikirim ke ${r.email}` : `Pengguna ${r.email} ditambahkan`);
      onCreated();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Tambah pengguna" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button><button type="button" className="btn primary" onClick={() => void submit()} disabled={busy}>{busy && <Spinner sm />} Tambah</button></>}>
      <div className="stack">
        <Field label="Email" htmlFor="u-email">
          <input id="u-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Nama lengkap (opsional)" htmlFor="u-name">
          <input id="u-name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Role" htmlFor="u-role" help={role === 'admin' ? 'Akses penuh termasuk pengaturan, perangkat, pengguna, API key.' : 'Melihat semua data & verifikasi manual.'}>
          <select id="u-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        {supabase ? (
          <Field label="Password awal (opsional)" htmlFor="u-pw" help="Kosongkan untuk mengirim email undangan; pengguna membuat password sendiri lewat tautan.">
            <input id="u-pw" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        ) : (
          <Callout kind="info">Mode dev: pengguna cukup login dengan email ini (tanpa password).</Callout>
        )}
        {err && <Callout kind="danger">{err}</Callout>}
      </div>
    </Modal>
  );
}
