import type { Metadata } from 'next';
import { JetBrains_Mono, Manrope, Sora } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

// Fontes do protótipo aprovado, servidas pelo próprio site (next/font) — compatível com a CSP font-src 'self'.
const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-manrope', display: 'swap' });
const sora = Sora({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-sora', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: 'Siow System · Financeiro',
  description: 'Plataforma Siow System — módulo Financeiro',
  icons: { icon: '/logo.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${manrope.variable} ${sora.variable} ${jetbrains.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
