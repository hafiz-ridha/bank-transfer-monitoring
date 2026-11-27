'use client';
// Komponen UI dasar: kartu, badge, modal, tabel, pagination, tab, dsb.
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/api';
import { config } from '@/lib/config';
import { timeSmart } from '@/lib/format';
import type { Tone } from '@/lib/labels';
import type { Pagination as PaginationT } from '@/lib/types';

export function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ halaman
export function PageHeader({
  title, subtitle, actions, breadcrumb, updatedAt, onRefresh, live,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: { href: string; label: string }[];
  updatedAt?: Date | null;
  onRefresh?: () => void;
  live?: boolean;
}) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {breadcrumb && (
          <div className="breadcrumb">
            {breadcrumb.map((b, i) => (
              <span key={b.href}>
                {i > 0 && ' / '}
                <Link href={b.href}>{b.label}</Link>
              </span>
            ))}
          </div>
        )}
        <h1>{title}</h1>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      <div className="actions">
        {(updatedAt || onRefresh) && (
          <span className="refresh-info">
            {live && <span className="live-dot" title="Auto refresh aktif" />}
            {updatedAt ? `Diperbarui ${timeSmart(updatedAt)}` : 'Memuat…'}
            {live && ` · auto ${Math.round(config.refreshMs / 1000)} dtk`}
          </span>
        )}
        {onRefresh && (
          <button type="button" className="btn sm" onClick={onRefresh} title="Muat ulang">↻ Muat ulang</button>
        )}
        {actions}
      </div>
    </div>
  );
}

export function Card({
  title, hint, actions, children, className, bodyClass, footer, flush,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClass?: string;
  footer?: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {hint && <div className="hint">{hint}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={cx('card-body', flush && 'flush', bodyClass)}>{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

export function Stat({
  label, value, sub, tone, href, small,
}: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; href?: string; small?: boolean }) {
  const inner = (
    <>
      <div className="label">{label}</div>
      <div className={cx('value', small && 'sm')}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className={cx('card stat', tone && `tone-${tone}`)}>{inner}</Link>
  ) : (
    <div className={cx('card stat', tone && `tone-${tone}`)}>{inner}</div>
  );
}

// ------------------------------------------------------------------ badge
export function Badge({ tone = 'gray', children, title, dot, sm, className }: {
  tone?: Tone; children: ReactNode; title?: string; dot?: boolean; sm?: boolean; className?: string;
}) {
  return (
    <span className={cx('badge', tone, sm && 'sm', className)} title={title}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

/** Indikator boolean kondisi perangkat. `null` = "Belum dilaporkan". */
export function BoolIndicator({
  value, yes, no, goodWhen = true, warnOnly,
}: { value: boolean | null | undefined; yes: string; no: string; goodWhen?: boolean; warnOnly?: boolean }) {
  if (value === null || value === undefined) {
    return <span className="pill-check muted"><span className="ind gray" />Belum dilaporkan</span>;
  }
  const good = value === goodWhen;
  const tone = good ? 'green' : warnOnly ? 'yellow' : 'red';
  return <span className="pill-check"><span className={`ind ${tone}`} />{value ? yes : no}</span>;
}

// ------------------------------------------------------------------ status umum
export function Loading({ label = 'Memuat data…' }: { label?: string }) {
  return <div className="loading"><span className="spinner" />{label}</div>;
}

export function Spinner({ sm }: { sm?: boolean }) {
  return <span className={cx('spinner', sm && 'sm')} aria-label="memuat" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error | string | null | undefined; onRetry?: () => void }) {
  if (!error) return null;
  const msg = typeof error === 'string' ? error : errorMessage(error);
  const status = typeof error === 'object' && 'status' in error ? (error as ApiError).status : undefined;
  return (
    <div className={cx('callout', status === 403 ? 'warn' : 'danger', 'error-box')} role="alert">
      <div className="grow">
        <div className="ttl">{status === 403 ? 'Akses ditolak' : 'Terjadi kesalahan'}</div>
        <div>{msg}</div>
      </div>
      {onRetry && <button type="button" className="btn sm" onClick={onRetry}>Coba lagi</button>}
    </div>
  );
}

export function Callout({ kind = 'info', title, children, action }: {
  kind?: 'info' | 'warn' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className={cx('callout', kind)}>
      <div className="grow">
        {title && <div className="ttl">{title}</div>}
        {children}
      </div>
      {action}
    </div>
  );
}

/** Blok data: loading pertama / error / konten. */
export function DataState<T>({
  state, children, empty, isEmpty,
}: {
  state: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void };
  children: (data: T) => ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
}) {
  if (state.error && !state.data) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading />;
  return (
    <>
      {state.error && <ErrorBox error={state.error} onRetry={state.reload} />}
      {isEmpty && isEmpty(state.data) ? <Empty>{empty ?? 'Tidak ada data.'}</Empty> : children(state.data)}
    </>
  );
}

// ------------------------------------------------------------------ modal
export function Modal({
  title, onClose, children, footer, size, closeOnBackdrop = true,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'lg' | 'xl';
  closeOnBackdrop?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}>
      <div className={cx('modal', size)} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="close-x" onClick={onClose} aria-label="Tutup">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Modal konfirmasi aksi dengan catatan opsional (semua tindakan verifikasi tercatat di audit log).
 */
export function ConfirmModal({
  title, description, warning, confirmLabel = 'Lanjutkan', tone = 'primary', withNote = true, noteRequired = false,
  noteLabel = 'Catatan (opsional)', notePlaceholder, initialNote = '', confirmDisabled, size, onConfirm, onClose, children,
}: {
  title: ReactNode;
  description?: ReactNode;
  warning?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger' | 'success';
  withNote?: boolean;
  noteRequired?: boolean;
  noteLabel?: string;
  notePlaceholder?: string;
  initialNote?: string;
  confirmDisabled?: boolean;
  size?: 'lg' | 'xl';
  onConfirm: (note: string | null) => Promise<void>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (noteRequired && !note.trim()) {
      setErr('Catatan wajib diisi');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(note.trim() ? note.trim() : null);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      size={size}
      onClose={() => { if (!busy) onClose(); }}
      closeOnBackdrop={!busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button>
          <button type="button" className={cx('btn', tone)} onClick={submit} disabled={busy || confirmDisabled}>
            {busy && <Spinner sm />} {confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack">
        {description && <div>{description}</div>}
        {warning && <Callout kind="warn">{warning}</Callout>}
        {children}
        {withNote && (
          <div className="field">
            <label htmlFor="confirm-note">{noteLabel}</label>
            <textarea
              id="confirm-note"
              className="textarea"
              value={note}
              maxLength={1000}
              placeholder={notePlaceholder ?? 'Alasan / keterangan untuk audit log'}
              onChange={(e) => setNote(e.target.value)}
              autoFocus
            />
            <span className="help">Tindakan ini dicatat di audit log beserta catatan Anda.</span>
          </div>
        )}
        {err && <Callout kind="danger">{err}</Callout>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ tabel
export function SortHeader({
  label, col, sort, order, onSort, className,
}: {
  label: string; col: string; sort: string; order: 'asc' | 'desc'; onSort: (col: string) => void; className?: string;
}) {
  const active = sort === col;
  return (
    <th className={cx('sortable', className)} onClick={() => onSort(col)} aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {label}
      <span className="arrow">{active ? (order === 'asc' ? '▲' : '▼') : '↕'}</span>
    </th>
  );
}

export function Pagination({
  pagination, onPage, pageSize, onPageSize, sizes = [25, 50, 100, 200],
}: {
  pagination: PaginationT | undefined | null;
  onPage: (p: number) => void;
  pageSize?: number;
  onPageSize?: (n: number) => void;
  sizes?: number[];
}) {
  if (!pagination) return null;
  const { page, total_pages, total, page_size } = pagination;
  const from = total === 0 ? 0 : (page - 1) * page_size + 1;
  const to = Math.min(total, page * page_size);
  return (
    <div className="pagination">
      <span className="muted">{total === 0 ? 'Tidak ada data' : `${from}–${to} dari ${total.toLocaleString('id-ID')}`}</span>
      <div className="pages">
        {onPageSize && (
          <select className="select sm" style={{ width: 'auto' }} value={pageSize ?? page_size} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Baris per halaman">
            {sizes.map((s) => <option key={s} value={s}>{s} / halaman</option>)}
          </select>
        )}
        <button type="button" className="btn sm" disabled={page <= 1} onClick={() => onPage(1)} aria-label="Halaman pertama">«</button>
        <button type="button" className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Sebelumnya</button>
        <span className="muted" style={{ padding: '0 6px' }}>Hal. {page} / {total_pages}</span>
        <button type="button" className="btn sm" disabled={page >= total_pages} onClick={() => onPage(page + 1)}>Berikutnya ›</button>
        <button type="button" className="btn sm" disabled={page >= total_pages} onClick={() => onPage(total_pages)} aria-label="Halaman terakhir">»</button>
      </div>
    </div>
  );
}

export function Tabs<K extends string>({
  tabs, active, onChange,
}: { tabs: { key: K; label: string; count?: number | null }[]; active: K; onChange: (k: K) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key} className={cx('tab', active === t.key && 'active')} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count !== undefined && t.count !== null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ lain-lain
export function CopyButton({ text, label = 'Salin' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  };
  return <button type="button" className="btn sm" onClick={copy}>{done ? '✓ Tersalin' : label}</button>;
}

export function JsonView({ value, summary = 'Lihat JSON' }: { value: unknown; summary?: string }) {
  if (value === null || value === undefined) return <span className="faint">-</span>;
  return (
    <details>
      <summary>{summary}</summary>
      <pre className="mt-1">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function Field({ label, children, help, error, className, htmlFor }: {
  label: ReactNode; children: ReactNode; help?: ReactNode; error?: string | null; className?: string; htmlFor?: string;
}) {
  return (
    <div className={cx('field', className)}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {help && <span className="help">{help}</span>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label, ariaLabel, id }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: ReactNode; ariaLabel?: string; id?: string;
}) {
  return (
    <label className="switch">
      <input id={id} type="checkbox" role="switch" aria-label={ariaLabel} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function AdminOnlyNotice({ what = 'tindakan ini' }: { what?: string }) {
  return <Callout kind="info">Anda masuk sebagai <b>operator</b>: {what} hanya dapat dilakukan oleh admin (mode baca saja).</Callout>;
}
