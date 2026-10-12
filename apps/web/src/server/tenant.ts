/**
 * Contexto da organização (tenant) por requisição/execução, via AsyncLocalStorage.
 * - `runWithOrg(id, fn)`: tudo dentro de fn lê/escreve só nessa organização (filtro injetado no Prisma).
 * - `runAsPlatform(fn)`: modo plataforma (login, bootstrap, cron que percorre organizações) — sem filtro.
 * - `currentOrgId()`: organização atual (lança se não houver).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantContext } from '@siow/db';

const als = new AsyncLocalStorage<TenantContext>();

export function tenantContext(): TenantContext | undefined { return als.getStore(); }
export function runWithOrg<T>(organizationId: string, fn: () => Promise<T>): Promise<T> { return als.run({ organizationId, platform: false }, fn); }
export function runAsPlatform<T>(fn: () => Promise<T>): Promise<T> { return als.run({ organizationId: null, platform: true }, fn); }
export function currentOrgId(): string {
  const id = als.getStore()?.organizationId;
  if (!id) throw new Error('Sem organização no contexto');
  return id;
}
export function currentOrgIdOrNull(): string | null { return als.getStore()?.organizationId ?? null; }
