/**
 * White-label (Fase 9): marca por organização — nome do produto, logotipo, cores e domínio próprio.
 * A marca pública é resolvida pelo host (Organization.domain); sem correspondência, vale a marca Siow.
 */
import type { BrandingDto } from '@siow/shared';
import type { Prisma } from '@siow/db';
import { prismaPlatform } from '../db.js';
import { audit } from '../audit.js';
import { badRequest, type Ctx } from '../http.js';
import { blobKey, putBlob } from '../storage.js';
import { currentOrgId } from '../tenant.js';

export interface PublicBranding { productName: string; tagline: string; logoUrl: string; accent: string | null; accent2: string | null; supportEmail: string | null; organizationSlug: string | null; selfSignup: boolean }
const DEFAULT: PublicBranding = { productName: 'Siow System', tagline: 'Módulo Financeiro', logoUrl: '/logo.png', accent: null, accent2: null, supportEmail: null, organizationSlug: null, selfSignup: false };

function merge(b: Record<string, unknown> | null | undefined, slug: string | null): PublicBranding {
  const s = (k: string) => (typeof b?.[k] === 'string' && (b[k] as string).trim() ? (b[k] as string) : null);
  return { productName: s('productName') ?? DEFAULT.productName, tagline: s('tagline') ?? DEFAULT.tagline, logoUrl: s('logoUrl') ?? DEFAULT.logoUrl, accent: s('accent'), accent2: s('accent2'), supportEmail: s('supportEmail'), organizationSlug: slug, selfSignup: false };
}

const cache = new Map<string, { at: number; b: PublicBranding }>();
export async function brandingForHost(host: string): Promise<PublicBranding> {
  const h = host.toLowerCase().split(':')[0] ?? '';
  const hit = cache.get(h);
  if (hit && Date.now() - hit.at < 60_000) return hit.b;
  const org = h ? await prismaPlatform.organization.findFirst({ where: { domain: h, deletedAt: null }, select: { slug: true, branding: true } }) : null;
  const selfSignup = await prismaPlatform.setting.findFirst({ where: { key: 'platform.selfSignup', organizationId: '7a1b5c3e-5e1f-4a4e-8c0d-000000000001' } });
  const b = { ...(org ? merge(org.branding as Record<string, unknown>, org.slug) : DEFAULT), selfSignup: selfSignup?.value === true };
  cache.set(h, { at: Date.now(), b });
  return b;
}

export async function getBranding() {
  const org = await prismaPlatform.organization.findUniqueOrThrow({ where: { id: currentOrgId() }, select: { branding: true, domain: true, slug: true, name: true } });
  return { ...(org.branding as Record<string, unknown>), domain: org.domain, slug: org.slug, name: org.name };
}

export async function updateBranding(ctx: Ctx, input: BrandingDto) {
  const org = await prismaPlatform.organization.findUniqueOrThrow({ where: { id: currentOrgId() }, select: { branding: true } });
  const before = (org.branding as Record<string, unknown>) ?? {};
  const after: Record<string, unknown> = { ...before };
  for (const [k, v] of Object.entries(input)) if (v !== undefined) { if (v === null || v === '') delete after[k]; else after[k] = v; }
  await prismaPlatform.organization.update({ where: { id: currentOrgId() }, data: { branding: after as Prisma.InputJsonValue } });
  cache.clear();
  await audit(ctx, { action: 'BRANDING_UPDATED', resource: 'organization', resourceId: currentOrgId(), before, after });
  return after;
}

const LOGO_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
export async function uploadLogo(ctx: Ctx, file: File) {
  const ext = LOGO_MIME[file.type];
  if (!ext) throw badRequest('Use PNG, JPEG, SVG ou WebP');
  if (file.size > 1_000_000) throw badRequest('Logotipo até 1 MB');
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.length) throw badRequest('Arquivo vazio');
  const { url } = await putBlob(blobKey(`branding/${currentOrgId().slice(0, 8)}`, 'logo', ext), buffer, file.type);
  const branding = await updateBranding(ctx, { logoUrl: url });
  return { logoUrl: url, branding };
}
