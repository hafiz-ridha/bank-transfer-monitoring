'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { config } from '@/lib/config';
import { useApi, useOnDataChanged } from '@/lib/hooks';
import { ROLE_LABEL } from '@/lib/labels';
import type { Alert, ListResponse, TransactionList } from '@/lib/types';
import { cx } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  count?: number | null;
  countWarn?: boolean;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, isAdmin, logout, mode, businessName } = useAuth();
  const [open, setOpen] = useState(false);

  // Hitungan kecil di sidebar (auto refresh): alert aktif & transaksi ambigu yang menunggu verifikasi.
  const alerts = useApi<ListResponse<Alert>>('/alerts', { status: 'active' }, { poll: true });
  const ambiguous = useApi<TransactionList>('/transactions', { status: 'AMBIGUOUS', page_size: 1 }, { poll: true });
  const alertCount = alerts.data?.data.filter((a) => a.status === 'OPEN').length ?? null;
  const ambCount = ambiguous.data?.totals.count ?? null;
  useOnDataChanged(() => {
    void alerts.reload();
    void ambiguous.reload();
  });

  useEffect(() => setOpen(false), [pathname]);

  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: 'Monitoring',
      items: [
        { href: '/', label: 'Dashboard', icon: '🏠' },
        { href: '/devices', label: 'Perangkat', icon: '📱' },
        { href: '/alerts', label: 'Alert', icon: '🔔', count: alertCount },
      ],
    },
    {
      title: 'Transaksi',
      items: [
        { href: '/transactions', label: 'Transaksi masuk', icon: '💸' },
        { href: '/verification', label: 'Verifikasi manual', icon: '✅', count: ambCount, countWarn: true },
        { href: '/orders', label: 'Order POS', icon: '🧾' },
        { href: '/reports', label: 'Laporan', icon: '📊' },
      ],
    },
    {
      title: 'Konfigurasi',
      items: [
        { href: '/bank-sources', label: 'Sumber bank', icon: '🏦' },
        { href: '/settings', label: 'Pengaturan', icon: '⚙️' },
        { href: '/users', label: 'Pengguna', icon: '👥', adminOnly: true },
        { href: '/audit', label: 'Audit log', icon: '📜', adminOnly: true },
      ],
    },
  ];

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <div className={cx('app', open && 'nav-open')}>
      <aside className="sidebar" aria-label="Navigasi utama">
        <div className="sidebar-brand">
          <div className="title"><span className="brand-logo">BT</span>{config.appName}</div>
          <div className="sub">{businessName ?? 'Monitoring transfer & perangkat'}</div>
          {mode === 'dev' && <div style={{ marginTop: 8 }}><span className="dev-badge" title="Login tanpa password, hanya untuk pengembangan lokal">MODE DEV</span></div>}
        </div>
        <nav className="nav">
          {sections.map((s) => (
            <div key={s.title}>
              <div className="nav-section">{s.title}</div>
              {s.items.filter((i) => !i.adminOnly || isAdmin).map((i) => (
                <Link key={i.href} href={i.href} className={cx(isActive(i.href) && 'active')}>
                  <span className="ico" aria-hidden>{i.icon}</span>
                  {i.label}
                  {!!i.count && <span className={cx('count', i.countWarn && 'warn')}>{i.count}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="email">{user?.full_name ? <><b>{user.full_name}</b><br /></> : null}{user?.email}</div>
          <div className="row">
            <span className="badge sm blue">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</span>
            <button type="button" className="btn sm" onClick={() => void logout()}>Keluar</button>
          </div>
        </div>
      </aside>
      <div className="backdrop" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button type="button" className="hamburger" onClick={() => setOpen((v) => !v)} aria-label="Buka menu">☰</button>
          <span className="title">{config.appName}</span>
          {mode === 'dev' && <span className="dev-badge">MODE DEV</span>}
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
