'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthBrand } from '@/components/AuthBrand';
import { useToast } from '@/components/toast';
import { Callout, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { getSupabase, supabaseConfigured } from '@/lib/supabase';

/** Membuat password baru setelah membuka tautan pemulihan / undangan dari email Supabase. */
export default function ResetPasswordPage() {
  const { mode, updatePassword, retry } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [isInvite, setIsInvite] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setIsInvite(new URLSearchParams(window.location.search).get('mode') === 'invite' || /type=invite/.test(window.location.hash));
    if (mode !== 'supabase' || !supabaseConfigured()) {
      setHasSession(false);
      return;
    }
    const sb = getSupabase();
    let cancelled = false;
    const check = async () => {
      // Alur PKCE (?code=...) — alur implicit (#access_token=...) ditangani otomatis oleh supabase-js.
      const code = new URLSearchParams(window.location.search).get('code');
      if (code) await sb.auth.exchangeCodeForSession(code).catch(() => undefined);
      const { data } = await sb.auth.getSession();
      if (!cancelled) setHasSession(!!data.session);
    };
    void check();
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (!cancelled && session) setHasSession(true);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) {
      setErr('Password minimal 8 karakter');
      return;
    }
    if (password !== confirm) {
      setErr('Konfirmasi password tidak sama');
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      toast.success('Password berhasil disimpan');
      retry();
      router.replace('/');
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <AuthBrand />
        <h1>{isInvite ? 'Buat password akun' : 'Buat password baru'}</h1>
        {mode === 'dev' ? (
          <div className="mt-2"><Callout kind="info">Mode dev tidak memakai password.</Callout></div>
        ) : hasSession === null ? (
          <div className="loading"><Spinner /> Memverifikasi tautan…</div>
        ) : !hasSession ? (
          <div className="mt-2">
            <Callout kind="warn" title="Tautan tidak valid atau kedaluwarsa">
              Minta tautan baru melalui <Link href="/lupa-password">Lupa password</Link>, atau minta admin mengirim ulang undangan.
            </Callout>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="pw">Password baru</label>
              <input id="pw" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoFocus />
              <span className="help">Minimal 8 karakter.</span>
            </div>
            <div className="field">
              <label htmlFor="pw2">Ulangi password</label>
              <input id="pw2" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            {err && <Callout kind="danger">{err}</Callout>}
            <button type="submit" className="btn primary block" disabled={busy}>{busy && <Spinner sm />} Simpan password</button>
          </form>
        )}
        <div className="auth-links mt-2"><Link href="/login">← Kembali ke login</Link></div>
      </div>
    </div>
  );
}
