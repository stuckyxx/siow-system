/**
 * Licenciamento por organização (Fase 9): módulos habilitados, limites e bloqueio suave (somente leitura).
 * Resolvido em modo plataforma a partir de Organization + Subscription + Plan, com cache curto por organização.
 */
import { CORE_MODULES, type OrgAccess } from '@siow/shared';
import { prismaPlatform } from './db.js';

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; access: OrgAccess }>();

/** Prefixos de rota por módulo. Rotas fora da lista pertencem ao núcleo (sempre liberadas). */
const MODULE_ROUTES: Array<{ module: string; test: (p: string) => boolean }> = [
  { module: 'COMERCIAL', test: (p) => p.startsWith('/api/comercial') },
  { module: 'LICITACOES', test: (p) => p.startsWith('/api/licitacoes') },
  { module: 'ATENDIMENTO', test: (p) => p.startsWith('/api/atendimento') },
  { module: 'PARCEIROS', test: (p) => p.startsWith('/api/parceiros') },
  { module: 'RELATORIOS', test: (p) => p.startsWith('/api/financeiro/reports') || p.startsWith('/api/bi') },
  { module: 'INTEGRACOES', test: (p) => p.startsWith('/api/integracoes') },
];

export function moduleForPath(pathname: string): string | null {
  return MODULE_ROUTES.find((m) => m.test(pathname))?.module ?? null;
}

export function invalidateAccess(organizationId?: string): void {
  if (organizationId) cache.delete(organizationId); else cache.clear();
}

export async function resolveAccess(organizationId: string): Promise<OrgAccess> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.access;
  const org = await prismaPlatform.organization.findUnique({ where: { id: organizationId }, include: { subscription: true } });
  if (!org) throw new Error('Organização não encontrada');
  const planKey = org.subscription?.planKey ?? org.plan;
  const plan = await prismaPlatform.plan.findUnique({ where: { key: planKey } });
  const planModules = Array.isArray(plan?.modules) ? (plan!.modules as string[]) : [];
  const orgModules = Array.isArray(org.modules) ? (org.modules as string[]) : [];
  // Vazio = todos. Se a organização restringe, prevalece a interseção com o plano.
  let modules: string[] = planModules.length ? planModules : [];
  if (orgModules.length) modules = modules.length ? orgModules.filter((m) => modules.includes(m)) : orgModules;
  if (modules.length) modules = Array.from(new Set([...CORE_MODULES, ...modules]));
  const limits = (org.limits as { maxUsers?: number | null; maxEntities?: number | null } | null) ?? {};
  const status = org.subscription?.status ?? null;
  const readOnly = org.status === 'READONLY' || status === 'BLOCKED';
  const access: OrgAccess = {
    planKey, planName: plan?.name ?? planKey, modules, readOnly,
    blockReason: readOnly ? (org.blockReason ?? (status === 'BLOCKED' ? 'Assinatura bloqueada por inadimplência' : 'Organização em modo somente leitura')) : null,
    subscriptionStatus: status, trialEndsAt: org.subscription?.trialEndsAt?.toISOString() ?? org.trialEndsAt?.toISOString() ?? null,
    limits: { maxUsers: limits.maxUsers ?? plan?.maxUsers ?? null, maxEntities: limits.maxEntities ?? plan?.maxEntities ?? null },
  };
  cache.set(organizationId, { at: Date.now(), access });
  return access;
}

export function moduleAllowed(access: OrgAccess, module: string | null): boolean {
  if (!module || access.modules.length === 0) return true;
  return access.modules.includes(module);
}
