'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthBrand } from '@/components/AuthBrand';
import { Callout, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';

function safeNext(): string {
  if (typeof window === 'undefined') return '/';
  const n = new URLSearchParams(window.location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/';
}

export default function LoginPage() {
  const { status, mode, error, loginDev, loginPassword, takeFlash, logout, retry } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState(mode === 'dev' ? 'admin@local.test' : '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    setFlash(takeFlash());
  }, [takeFlash]);

  useEffect(() => {
    if (status === 'authenticated') router.replace(safeNext());
  }, [status, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      if (mode === 'dev') await loginDev(email);
      else await loginPassword(email, password);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <AuthBrand />
        <h1>Masuk ke dashboard</h1>
        {mode === 'dev' && (
          <div className="mt-2">
            <Callout kind="warn" title={<><span className="dev-badge">MODE DEV</span> Login tanpa password</>}>
              Hanya untuk pengembangan lokal. Token dikirim sebagai <code>dev:&lt;email&gt;</code>; backend harus berjalan dengan <code>AUTH_MODE=dev</code>.
            </Callout>
          </div>
        )}
        {flash && <div className="mt-2"><Callout kind="info">{flash}</Callout></div>}
        {status === 'forbidden' && (
          <div className="mt-2">
            <Callout kind="warn" title="Akses ditolak" action={<button type="button" className="btn sm" onClick={() => void logout()}>Ganti akun</button>}>
              {error}
            </Callout>
          </div>
        )}
        {status === 'error' && (
          <div className="mt-2">
            <Callout kind="danger" title="Tidak dapat terhubung" action={<button type="button" className="btn sm" onClick={retry}>Coba lagi</button>}>
              {error}
            </Callout>
          </div>
        )}
        {status === 'loading' ? (
          <div className="loading"><Spinner /> Memeriksa sesi…</div>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            {mode === 'supabase' && (
              <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
            )}
            {formError && <Callout kind="danger">{formError}</Callout>}
            <button type="submit" className="btn primary block" disabled={busy || !email || (mode === 'supabase' && !password)}>
              {busy && <Spinner sm />} Masuk
            </button>
            {mode === 'supabase' && (
              <div className="auth-links">
                <Link href="/lupa-password">Lupa password?</Link>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
