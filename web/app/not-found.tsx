import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="fullscreen-center">
      <div className="card" style={{ maxWidth: 420, width: '100%' }}>
        <div className="card-body stack">
          <h1>Halaman tidak ditemukan</h1>
          <p className="muted">Alamat yang Anda buka tidak tersedia.</p>
          <Link href="/" className="btn primary">Kembali ke dashboard</Link>
        </div>
      </div>
    </div>
  );
}
