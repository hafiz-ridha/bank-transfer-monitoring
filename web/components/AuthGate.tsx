'use client';
import { useAuth } from '@/lib/auth';
import { Spinner } from './ui';

/** Layar sementara saat sesi dimuat / akun ditolak / backend tidak dapat dijangkau. */
export function AuthGate() {
  const { status, error, retry, logout } = useAuth();
  if (status === 'forbidden' || status === 'error') {
    return (
      <div className="auth-wrap">
        <div className="auth-card stack">
          <h1>{status === 'forbidden' ? 'Akses ditolak' : 'Tidak dapat memuat sesi'}</h1>
          <div className={`callout ${status === 'forbidden' ? 'warn' : 'danger'}`}>
            <div className="grow">
              {error}
              {status === 'forbidden' && (
                <div className="mt-1 small">Minta admin menambahkan email Anda di menu <b>Pengguna</b>, atau aktifkan kembali akun Anda.</div>
              )}
            </div>
          </div>
          <div className="row">
            {status === 'error' && <button type="button" className="btn primary" onClick={retry}>Coba lagi</button>}
            <button type="button" className="btn" onClick={() => void logout()}>Keluar / ganti akun</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="fullscreen-center">
      <div className="row muted"><Spinner /> Memeriksa sesi…</div>
    </div>
  );
}
