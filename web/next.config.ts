import type { NextConfig } from 'next';

// Dashboard di-build sebagai static export (folder `out/`) lalu disajikan oleh backend Fastify
// di container yang sama — satu domain untuk dashboard + API. Header keamanan diset oleh backend.
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default nextConfig;
