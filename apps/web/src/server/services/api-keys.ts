/**
 * Chaves de API por organização (Fase 9): `Authorization: Bearer sk_<prefixo>_<segredo>`.
 * Só o hash SHA-256 é guardado; a chave completa aparece uma única vez na criação. Permissões = subconjunto
 * das permissões de quem criou (nunca escala privilégio). Em runtime vira um usuário sintético no `route()`.
 */
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import type { apiKeyCreateSchema, CurrentUser } from '@siow/shared';
import { prisma, prismaPlatform } from '../db.js';
import { audit } from '../audit.js';
import { sha256 } from '../auth.js';
import { badRequest, notFound, type Ctx } from '../http.js';
import { currentOrgId } from '../tenant.js';

export async function list() {
  return prisma.apiKey.findMany({ where: { revokedAt: null }, select: { id: true, name: true, prefix: true, permissions: true, isActive: true, lastUsedAt: true, expiresAt: true, createdAt: true, createdByUserId: true }, orderBy: { createdAt: 'desc' } });
}

export async function create(ctx: Ctx, input: z.infer<typeof apiKeyCreateSchema>) {
  const denied = input.permissions.filter((p) => !ctx.user.permissions.includes(p));
  if (denied.length) throw badRequest('A chave não pode ter permissões que você não possui: ' + denied.join(', '));
  const active = await prisma.apiKey.count({ where: { revokedAt: null, isActive: true } });
  if (active >= 20) throw badRequest('Limite de 20 chaves ativas por organização');
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  const key = `sk_${prefix}_${secret}`;
  const row = await prisma.apiKey.create({ data: { organizationId: currentOrgId(), name: input.name, prefix, keyHash: sha256(key), permissions: input.permissions, expiresAt: input.expiresAt ? new Date(`${input.expiresAt}T23:59:59.000Z`) : null, createdByUserId: ctx.user.id } });
  await audit(ctx, { action: 'API_KEY_CREATED', resource: 'api_key', resourceId: row.id, after: { name: row.name, prefix, permissions: input.permissions, expiresAt: row.expiresAt } });
  return { id: row.id, name: row.name, prefix, key, permissions: row.permissions, expiresAt: row.expiresAt };
}

export async function revoke(ctx: Ctx, id: string) {
  const row = await prisma.apiKey.findFirst({ where: { id, revokedAt: null } });
  if (!row) throw notFound('Chave não encontrada');
  await prisma.apiKey.update({ where: { id }, data: { isActive: false, revokedAt: new Date() } });
  await audit(ctx, { action: 'API_KEY_REVOKED', resource: 'api_key', resourceId: id, before: { name: row.name, prefix: row.prefix } });
}

/** Resolve um bearer `sk_…` para um usuário sintético (ou null). Modo plataforma: a organização ainda não é conhecida. */
export async function resolveApiKey(bearer: string): Promise<CurrentUser | null> {
  if (!bearer.startsWith('sk_')) return null;
  const row = await prismaPlatform.apiKey.findUnique({ where: { keyHash: sha256(bearer) }, include: { organization: true } }).catch(() => null);
  if (!row || !row.isActive || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) return null;
  if (row.organization.deletedAt || row.organization.status === 'SUSPENDED') return null;
  // Permissões efetivas = permissões da chave ∩ permissões atuais do criador (revogar do usuário revoga da chave).
  let permissions = Array.isArray(row.permissions) ? (row.permissions as string[]) : [];
  if (row.createdByUserId) {
    const creator = await prismaPlatform.user.findFirst({ where: { id: row.createdByUserId, isActive: true, deletedAt: null }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
    if (!creator) return null;
    const creatorPerms = new Set(creator.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code)));
    permissions = permissions.filter((p) => creatorPerms.has(p));
  }
  void prismaPlatform.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return {
    id: row.createdByUserId ?? `apikey:${row.id}`, name: `Chave de API · ${row.name}`, email: `apikey-${row.prefix}@${row.organization.slug}`, roles: ['API'], permissions,
    organizationId: row.organizationId, organization: { id: row.organization.id, name: row.organization.name, slug: row.organization.slug, branding: (row.organization.branding as Record<string, unknown>) ?? {} },
  };
}
