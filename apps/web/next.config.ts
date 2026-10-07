import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Origem de uma API externa (opcional). Vazio = Route Handlers em /api no
 * próprio deploy (Vercel), então a CSP só precisa de 'self'.
 */
const apiOrigin = (() => {
  const url = process.env['NEXT_PUBLIC_API_URL'];
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
})();

const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  // 'unsafe-eval' apenas em desenvolvimento (HMR/React Refresh)
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  // 'self' cobre os Route Handlers (/api/*) do mesmo deploy; apiOrigin só se houver API externa.
  `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 'standalone' só é usado pela imagem Docker (apps/web/Dockerfile). Na Vercel não é necessário.
  ...(process.env.VERCEL || process.env.NETLIFY ? {} : { output: 'standalone' as const }),
  // Pacotes do monorepo publicados como fonte TypeScript (main: ./src/index.ts):
  // o Next precisa transpilá-los. @siow/integrations e @siow/sync-core são usados pelos services.
  transpilePackages: ['@siow/shared', '@siow/db', '@siow/integrations', '@siow/sync-core'],
  // Dependências Node puras (engines nativas, fs, streams) ficam fora do bundle e são
  // carregadas do node_modules em runtime (serverless function da Vercel).
  serverExternalPackages: ['@prisma/client', 'pdfkit', 'exceljs', 'nodemailer', 'cheerio'],
  // Tracing do servidor a partir da raiz do monorepo (Root Directory = apps/web na Vercel).
  outputFileTracingRoot: path.join(__dirname, '../../'),
  webpack: (config) => {
    // Permite que imports "./x.js" dos pacotes do monorepo (NodeNext) resolvam para .ts/.tsx.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
