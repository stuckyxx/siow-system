'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './api';

export interface PublicBranding { productName: string; tagline: string; logoUrl: string; accent: string | null; accent2: string | null; supportEmail: string | null; organizationSlug: string | null; selfSignup: boolean }
export const DEFAULT_BRANDING: PublicBranding = { productName: 'Siow System', tagline: 'Módulo Financeiro', logoUrl: '/logo.png', accent: null, accent2: null, supportEmail: null, organizationSlug: null, selfSignup: false };

function hexToRgb(hex: string): string | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}` : null;
}

/** Aplica cores/título da marca ao documento (variáveis CSS do tema "aurora"). Sem cores → tema padrão Siow. */
export function applyBranding(b: Partial<PublicBranding> | null | undefined): void {
  const root = document.documentElement.style;
  const accent = b?.accent ?? null; const accent2 = b?.accent2 ?? accent;
  if (accent) {
    const rgb = hexToRgb(accent);
    root.setProperty('--accent', accent); root.setProperty('--accent2', accent2!);
    if (rgb) { root.setProperty('--accent-soft', `rgba(${rgb}, .14)`); root.setProperty('--glow', `0 0 0 1px rgba(${rgb}, .25), 0 8px 30px rgba(${rgb}, .12)`); }
    root.setProperty('--grad', `linear-gradient(135deg, ${accent}, ${accent2})`);
  } else for (const k of ['--accent', '--accent2', '--accent-soft', '--glow', '--grad']) root.removeProperty(k);
  if (b?.productName) document.title = `${b.productName} · ${b.tagline ?? 'Financeiro'}`;
}

/** Marca pública resolvida pelo host (white-label por domínio próprio). */
export function usePublicBranding(): PublicBranding {
  const { data } = useQuery({ queryKey: ['public-branding'], queryFn: () => api<PublicBranding>('/public/branding', { query: { host: typeof window !== 'undefined' ? window.location.host : '' } }), staleTime: 300_000, retry: false });
  const b = data ?? DEFAULT_BRANDING;
  useEffect(() => { applyBranding(b); }, [b]);
  return b;
}

/** Marca da organização do usuário autenticado (prevalece sobre a do host). */
export function orgBranding(branding: Record<string, unknown> | undefined, fallback: PublicBranding = DEFAULT_BRANDING): PublicBranding {
  const s = (k: string) => (typeof branding?.[k] === 'string' && (branding[k] as string).trim() ? (branding[k] as string) : null);
  return { ...fallback, productName: s('productName') ?? fallback.productName, tagline: s('tagline') ?? fallback.tagline, logoUrl: s('logoUrl') ?? fallback.logoUrl, accent: s('accent') ?? fallback.accent, accent2: s('accent2') ?? fallback.accent2, supportEmail: s('supportEmail') ?? fallback.supportEmail };
}
