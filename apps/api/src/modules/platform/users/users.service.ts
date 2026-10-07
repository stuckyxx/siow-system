import { Injectable, NotFoundException } from '@nestjs/common';
import { hashPassword } from '@siow/db';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { RequestContext } from '../../../common/auth/decorators.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';

export interface UserView {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  roles: Array<{ id: string; name: string }>;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(u: { id: string; name: string; email: string; isActive: boolean; lastLoginAt: Date | null; roles: Array<{ role: { id: string; name: string } }> }): UserView {
    return { id: u.id, name: u.name, email: u.email, isActive: u.isActive, lastLoginAt: u.lastLoginAt, roles: u.roles.map((r) => ({ id: r.role.id, name: r.role.name })) };
  }

  async list(): Promise<UserView[]> {
    const users = await this.prisma.user.findMany({ where: { deletedAt: null }, include: { roles: { include: { role: true } } }, orderBy: { name: 'asc' } });
    return users.map((u) => this.view(u));
  }

  /** Lista enxuta para seletores de "responsável" (sem e-mail). */
  async assignees(): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.user.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  async roles() {
    return this.prisma.role.findMany({ include: { permissions: { include: { permission: true } } }, orderBy: { name: 'asc' } });
  }

  async permissions() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
  }

  async create(ctx: RequestContext, input: { name: string; email: string; password: string; roleIds: string[] }): Promise<UserView> {
    const passwordHash = await hashPassword(input.password);
    const user = await this.prisma.user.create({
      data: { name: input.name, email: input.email.toLowerCase(), passwordHash, roles: { create: input.roleIds.map((roleId) => ({ roleId })) } },
      include: { roles: { include: { role: true } } },
    });
    await this.audit.log(ctx, { action: 'CREATE', resource: 'user', resourceId: user.id, after: this.view(user) });
    return this.view(user);
  }

  async update(ctx: RequestContext, id: string, input: { name?: string; email?: string; password?: string; roleIds?: string[]; isActive?: boolean }): Promise<UserView> {
    const before = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, include: { roles: { include: { role: true } } } });
    if (!before) throw new NotFoundException('Usuário não encontrado');
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email?.toLowerCase(),
        isActive: input.isActive,
        passwordHash,
        ...(input.roleIds ? { roles: { deleteMany: {}, create: input.roleIds.map((roleId) => ({ roleId })) } } : {}),
      },
      include: { roles: { include: { role: true } } },
    });
    if (input.isActive === false || passwordHash) {
      await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.log(ctx, { action: 'UPDATE', resource: 'user', resourceId: id, before: this.view(before), after: this.view(user) });
    return this.view(user);
  }

  async updateRolePermissions(ctx: RequestContext, roleId: string, permissionCodes: string[]): Promise<void> {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
    const perms = await this.prisma.permission.findMany({ where: { code: { in: permissionCodes } } });
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) }),
    ]);
    await this.audit.log(ctx, {
      action: 'PERMISSIONS_CHANGED',
      resource: 'role',
      resourceId: roleId,
      before: role.permissions.map((p) => p.permission.code),
      after: perms.map((p) => p.code),
    });
  }
}
