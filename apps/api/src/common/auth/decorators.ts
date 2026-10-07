import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentUser as CurrentUserType } from '@siow/shared';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';

/** Rota sem autenticação (login, health). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Exige TODAS as permissões listadas. */
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export interface RequestContext {
  user: CurrentUserType;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export type AuthenticatedRequest = Request & { user?: CurrentUserType; id?: string };

/** Injeta o usuário autenticado. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUserType => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.user) throw new Error('CurrentUser usado em rota sem autenticação');
  return req.user;
});

/** Injeta o contexto (usuário + IP + user-agent) usado pela auditoria. */
export const Ctx = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestContext => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.user) throw new Error('Ctx usado em rota sem autenticação');
  return {
    user: req.user,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
    requestId: (req.headers['x-request-id'] as string | undefined) ?? null,
  };
});
