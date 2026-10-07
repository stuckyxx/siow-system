/**
 * Usuários, papéis e permissões (catálogo + ajustes individuais via UserPermission).
 */
import { randomBytes, randomInt } from 'node:crypto';
import type { Prisma } from '@siow/db';
import { prisma } from '../db.js';
import { audit } from '../audit.js';
import { hashPassword, isStrongPassword } from '../password.js';
import { badRequest, forbidden, notFound, type Ctx } from '../http.js';

export const USERS_MANAGE = 'users.manage';
const ADMIN_ROLE = 'ADMINISTRADOR';

export interface UserView {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  roles: Array<{ id: string; name: string }>;
  /** Permissões resultantes: papéis + concedidas − revogadas. */
  effectivePermissions: string[];
  /** Concedidas individualmente (UserPermission.granted = true). */
  extraPermissions: string[];
  /** Revogadas individualmente (UserPermission.granted = false). */
  revokedPermissions: string[];
}

const userInclude = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  userPermissions: { include: { permission: true } },
} satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function view(u: UserRow): UserView {
  const effective = new Set<string>();
  for (const ur of u.roles) for (const rp of ur.role.permissions) effective.add(rp.permission.code);
  const extra: string[] = [];
  const revoked: string[] = [];
  for (const up of u.userPermissions) {
    if (up.granted) { effective.add(up.permission.code); extra.push(up.permission.code); }
    else { effective.delete(up.permission.code); revoked.push(up.permission.code); }
  }
  return {
    id: u.id, name: u.name, email: u.email, isActive: u.isActive, mustChangePassword: u.mustChangePassword,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil : null, lastLoginAt: u.lastLoginAt,
    roles: u.roles.map((r) => ({ id: r.role.id, name: r.role.name })),
    effectivePermissions: [...effective].sort(), extraPermissions: extra.sort(), revokedPermissions: revoked.sort(),
  };
}

type Db = Prisma.TransactionClient | typeof prisma;
async function load(db: Db, id: string): Promise<UserRow> {
  const u = await db.user.findFirst({ where: { id, deletedAt: null }, include: userInclude });
  if (!u) throw notFound('Usuário não encontrado');
  return u;
}

export async function list(): Promise<UserView[]> {
  const users = await prisma.user.findMany({ where: { deletedAt: null }, include: userInclude, orderBy: { name: 'asc' } });
  return users.map(view);
}

export async function get(id: string): Promise<UserView> {
  return view(await load(prisma, id));
}

/** Lista enxuta para seletores de "responsável" (sem e-mail). */
export async function assignees(): Promise<Array<{ id: string; name: string }>> {
  return prisma.user.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

export async function roles() {
  return prisma.role.findMany({ include: { permissions: { include: { permission: true } } }, orderBy: { name: 'asc' } });
}

export async function permissions() {
  return prisma.permission.findMany({ orderBy: { code: 'asc' } });
}

export async function create(ctx: Ctx, input: { name: string; email: string; password: string; roleIds: string[] }): Promise<UserView> {
  if (!isStrongPassword(input.password)) throw badRequest('Senha fraca: mínimo 10 caracteres com letras, números e símbolo');
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email.toLowerCase(), passwordHash, mustChangePassword: true, roles: { create: input.roleIds.map((roleId) => ({ roleId })) } },
    include: userInclude,
  });
  const v = view(user);
  await audit(ctx, { action: 'CREATE', resource: 'user', resourceId: user.id, after: v });
  return v;
}

export async function update(ctx: Ctx, id: string, input: { name?: string; email?: string; password?: string; roleIds?: string[]; isActive?: boolean }): Promise<UserView> {
  const self = id === ctx.user.id;
  if (self && input.isActive === false) throw forbidden('Você não pode desativar a si mesmo');
  if (input.password && !isStrongPassword(input.password)) throw badRequest('Senha fraca: mínimo 10 caracteres com letras, números e símbolo');
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;

  const { before, after } = await prisma.$transaction(async (tx) => {
    const before = view(await load(tx, id));
    const user = await tx.user.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email?.toLowerCase(),
        isActive: input.isActive,
        passwordHash,
        ...(passwordHash ? { mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } : {}),
        ...(input.isActive === true ? { failedLoginCount: 0, lockedUntil: null } : {}),
        ...(input.roleIds ? { roles: { deleteMany: {}, create: input.roleIds.map((roleId) => ({ roleId })) } } : {}),
      },
      include: userInclude,
    });
    const after = view(user);
    if (self && !after.effectivePermissions.includes(USERS_MANAGE)) throw forbidden('Você não pode remover sua própria permissão users.manage');
    if (input.isActive === false || passwordHash) {
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return { before, after };
  });
  await audit(ctx, { action: input.isActive === undefined ? 'UPDATE' : input.isActive ? 'ACTIVATE' : 'DEACTIVATE', resource: 'user', resourceId: id, before, after });
  return after;
}

export async function setActive(ctx: Ctx, id: string, isActive: boolean): Promise<UserView> {
  return update(ctx, id, { isActive });
}

/** Ajustes individuais: `grant` concede além dos papéis, `revoke` remove mesmo que o papel conceda. */
export async function setUserPermissions(ctx: Ctx, id: string, input: { grant: string[]; revoke: string[] }): Promise<UserView> {
  const grant = new Set(input.grant);
  const revoke = new Set(input.revoke);
  const both = [...grant].filter((c) => revoke.has(c));
  if (both.length) throw badRequest('Permissão não pode ser concedida e revogada ao mesmo tempo: ' + both.join(', '));
  if (id === ctx.user.id && revoke.has(USERS_MANAGE)) throw forbidden('Você não pode revogar sua própria permissão users.manage');

  const codes = [...grant, ...revoke];
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
  const known = new Set(perms.map((p) => p.code));
  const unknown = codes.filter((c) => !known.has(c));
  if (unknown.length) throw badRequest('Permissão desconhecida: ' + unknown.join(', '));

  const { before, after } = await prisma.$transaction(async (tx) => {
    const before = view(await load(tx, id));
    await tx.userPermission.deleteMany({ where: { userId: id } });
    if (perms.length) await tx.userPermission.createMany({ data: perms.map((p) => ({ userId: id, permissionId: p.id, granted: grant.has(p.code) })) });
    const after = view(await load(tx, id));
    if (id === ctx.user.id && !after.effectivePermissions.includes(USERS_MANAGE)) throw forbidden('Você não pode remover sua própria permissão users.manage');
    return { before, after };
  });
  await audit(ctx, {
    action: 'USER_PERMISSIONS_CHANGED', resource: 'user', resourceId: id,
    before: { extra: before.extraPermissions, revoked: before.revokedPermissions, effective: before.effectivePermissions },
    after: { extra: after.extraPermissions, revoked: after.revokedPermissions, effective: after.effectivePermissions },
  });
  return after;
}

function temporaryPassword(): string {
  const digits = '0123456789';
  const symbols = '!@#$%&*?';
  for (;;) {
    const p = randomBytes(9).toString('base64url').replace(/[-_]/g, 'x') + digits.charAt(randomInt(digits.length)) + symbols.charAt(randomInt(symbols.length));
    if (isStrongPassword(p)) return p;
  }
}

/** Gera senha temporária forte, obriga troca no próximo login e zera o bloqueio. Revoga sessões ativas. */
export async function resetPassword(ctx: Ctx, id: string): Promise<{ temporaryPassword: string }> {
  await load(prisma, id);
  const temp = temporaryPassword();
  const passwordHash = await hashPassword(temp);
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } }),
    prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(ctx, { action: 'PASSWORD_RESET', resource: 'user', resourceId: id });
  return { temporaryPassword: temp };
}

/** Aceita id (uuid) ou nome do papel. ADMINISTRADOR nunca perde users.manage. */
export async function updateRolePermissions(ctx: Ctx, roleIdOrName: string, permissionCodes: string[]): Promise<void> {
  const role = await prisma.role.findFirst({ where: { OR: [{ id: roleIdOrName }, { name: roleIdOrName }] }, include: { permissions: { include: { permission: true } } } });
  if (!role) throw notFound('Papel não encontrado');
  const codes = new Set(permissionCodes);
  if (role.name === ADMIN_ROLE && !codes.has(USERS_MANAGE)) throw forbidden(`O papel ${ADMIN_ROLE} deve manter a permissão ${USERS_MANAGE}`);
  const perms = await prisma.permission.findMany({ where: { code: { in: [...codes] } } });
  const known = new Set(perms.map((p) => p.code));
  const unknown = [...codes].filter((c) => !known.has(c));
  if (unknown.length) throw badRequest('Permissão desconhecida: ' + unknown.join(', '));
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
    prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) }),
  ]);
  await audit(ctx, {
    action: 'PERMISSIONS_CHANGED', resource: 'role', resourceId: role.id,
    before: role.permissions.map((p) => p.permission.code).sort(),
    after: perms.map((p) => p.code).sort(),
  });
}
