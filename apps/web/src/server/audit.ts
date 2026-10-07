import type { Prisma } from '@siow/db';
import { prisma } from './db.js';
import type { Ctx } from './http.js';

const SENSITIVE = new Set(['passwordHash', 'password', 'refreshTokenHash']);
function scrub(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v, (k, x: unknown) => (SENSITIVE.has(k) ? '[redacted]' : typeof x === 'bigint' ? x.toString() : x))) as Prisma.InputJsonValue;
}
export interface AuditEntry { action: string; resource: string; resourceId?: string | null; before?: unknown; after?: unknown; justification?: string | null }
export async function audit(ctx: Pick<Ctx, 'user' | 'ip' | 'userAgent'> | null, e: AuditEntry): Promise<void> {
  await prisma.auditLog.create({ data: { userId: ctx?.user?.id ?? null, action: e.action, resource: e.resource, resourceId: e.resourceId ?? null, before: scrub(e.before), after: scrub(e.after), justification: e.justification ?? null, ip: ctx?.ip ?? null, userAgent: ctx?.userAgent ?? null } }).catch((err) => console.error('audit failed', err));
}
