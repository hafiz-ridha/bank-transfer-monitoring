import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';

const appName = process.env.NEXT_PUBLIC_APP_NAME || 'Bank Transfer Monitor';

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: 'Dashboard monitoring transfer bank, perangkat Android, dan pencocokan pembayaran POS',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
