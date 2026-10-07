import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { CurrentUser } from '@siow/shared';
import { env } from '../../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, type AuthenticatedRequest } from './decorators.js';

export const ACCESS_COOKIE = 'siow_access';
export const REFRESH_COOKIE = 'siow_refresh';

interface AccessPayload {
  sub: string;
  sid: string; // session id
  type: 'access';
}

/**
 * Guard global: autentica pelo cookie HttpOnly de acesso (JWT curto) e
 * carrega papéis/permissões do usuário. Também aplica a checagem de
 * permissões declaradas com @RequirePermissions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (req.cookies as Record<string, string | undefined>)?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('Não autenticado');

    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token, { secret: env().JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Sessão expirada');
    }
    if (payload.type !== 'access') throw new UnauthorizedException('Token inválido');

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true, deletedAt: null },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    if (!user) throw new UnauthorizedException('Usuário inativo');

    const permissions = new Set<string>();
    const roles: string[] = [];
    for (const ur of user.roles) {
      roles.push(ur.role.name);
      for (const rp of ur.role.permissions) permissions.add(rp.permission.code);
    }
    const current: CurrentUser = { id: user.id, name: user.name, email: user.email, roles, permissions: [...permissions] };
    req.user = current;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (required && required.length > 0) {
      const missing = required.filter((p) => !permissions.has(p));
      if (missing.length > 0) throw new ForbiddenException(`Permissão necessária: ${missing.join(', ')}`);
    }
    return true;
  }
}
