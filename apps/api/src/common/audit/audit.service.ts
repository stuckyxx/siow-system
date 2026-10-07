import { Injectable } from '@nestjs/common';
import type { Prisma } from '@siow/db';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestContext } from '../auth/decorators.js';

export interface AuditEntry {
  action: string;
  resource: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  justification?: string | null;
}

const SENSITIVE_KEYS = new Set(['passwordHash', 'password', 'twoFactorSecret', 'refreshTokenHash']);

function scrub(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const json = JSON.parse(
    JSON.stringify(value, (key, v: unknown) => {
      if (SENSITIVE_KEYS.has(key)) return '[redacted]';
      if (typeof v === 'bigint') return v.toString();
      return v;
    }),
  ) as Prisma.InputJsonValue;
  return json;
}

/**
 * Trilha de auditoria append-only (spec §25). Toda operação crítica chama
 * `log`. A tabela tem triggers que impedem UPDATE/DELETE (ver seed).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(ctx: RequestContext | null, entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        userId: ctx?.user.id ?? null,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        before: scrub(entry.before),
        after: scrub(entry.after),
        justification: entry.justification ?? null,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });
  }
}
