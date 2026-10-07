import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { env } from '../../config/env.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Defesa em profundidade contra CSRF (além de SameSite=Strict nos cookies):
 * requisições mutantes precisam do header X-Requested-With e de um Origin
 * permitido. Formulários HTML de terceiros não conseguem enviar nenhum dos dois.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(req.method)) return true;
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      throw new ForbiddenException('Header X-Requested-With ausente');
    }
    const origin = req.headers.origin;
    if (origin) {
      const allowed = env().CORS_ORIGINS.split(',').map((s) => s.trim());
      if (!allowed.includes(origin)) throw new ForbiddenException('Origem não permitida');
    }
    return true;
  }
}
