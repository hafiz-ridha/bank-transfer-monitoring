'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { consumeExplicitLogout, useAuth } from '@/lib/auth';

/** Semua halaman dashboard wajib login; operator/admin ditentukan dari GET /me. */
export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') {
      if (consumeExplicitLogout()) return; // logout() sudah mengarahkan ke /login
      const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname + window.location.search)}` : '';
      router.replace(`/login${next}`);
    }
  }, [status, pathname, router]);

  if (status !== 'authenticated') return <AuthGate />;
  return <AppShell>{children}</AppShell>;
}
