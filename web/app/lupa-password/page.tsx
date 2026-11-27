'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthBrand } from '@/components/AuthBrand';
import { Callout, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function ForgotPasswordPage() {
  const { mode, requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await requestPasswordReset(email);
      setSent(true);
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
        <h1>Lupa password</h1>
        {mode === 'dev' ? (
          <div className="mt-2"><Callout kind="info">Mode dev tidak memakai password. Kembali ke halaman login dan masuk dengan email saja.</Callout></div>
        ) : sent ? (
          <div className="mt-2">
            <Callout kind="success" title="Periksa email Anda">
              Jika <b>{email}</b> terdaftar, tautan untuk membuat password baru telah dikirim. Tautan hanya berlaku sementara.
            </Callout>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="muted">Masukkan email akun dashboard. Kami akan mengirim tautan untuk membuat password baru.</p>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            {err && <Callout kind="danger">{err}</Callout>}
            <button type="submit" className="btn primary block" disabled={busy || !email}>{busy && <Spinner sm />} Kirim tautan reset</button>
          </form>
        )}
        <div className="auth-links mt-2"><Link href="/login">← Kembali ke login</Link></div>
      </div>
    </div>
  );
}
