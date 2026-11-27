import { config } from '@/lib/config';

export function AuthBrand() {
  return (
    <div className="brand">
      <span className="brand-logo">BT</span>
      <div>
        <div className="strong">{config.appName}</div>
        <div className="muted small">Monitoring transfer bank &amp; pembayaran POS</div>
      </div>
    </div>
  );
}
