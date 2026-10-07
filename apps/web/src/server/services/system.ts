/** Saúde, auditoria (leitura), notificações e configurações. */
import { z } from 'zod';
import type { Prisma } from '@siow/db';
import { paginationSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { audit } from '../audit.js';
import type { Ctx } from '../http.js';

export async function health(): Promise<{ ok: true; time: string; db: 'ok' }> {
  await prisma.$queryRaw`SELECT 1`;
  return { ok: true, time: new Date().toISOString(), db: 'ok' };
}

export const auditFilterSchema = paginationSchema.extend({
  userId: z.string().uuid().optional(),
  resource: z.string().optional(),
  resourceId: z.string().optional(),
  action: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export async function auditList(q: z.infer<typeof auditFilterSchema>) {
  const where: Prisma.AuditLogWhereInput = {
    userId: q.userId,
    resource: q.resource,
    resourceId: q.resourceId,
    action: q.action,
    createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
  };
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({ where, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

export async function notifications(userId: string, unreadOnly: boolean) {
  return prisma.notification.findMany({
    where: { OR: [{ userId }, { userId: null }], ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function markRead(userId: string, id: string): Promise<void> {
  await prisma.notification.updateMany({ where: { id, OR: [{ userId }, { userId: null }] }, data: { readAt: new Date() } });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { readAt: null, OR: [{ userId }, { userId: null }] }, data: { readAt: new Date() } });
}

export async function settings() {
  return prisma.setting.findMany({ orderBy: { key: 'asc' } });
}

export async function setSetting(ctx: Ctx, key: string, value: unknown) {
  const before = await prisma.setting.findUnique({ where: { key } });
  const after = await prisma.setting.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue, updatedByUserId: ctx.user.id },
    create: { key, value: value as Prisma.InputJsonValue, updatedByUserId: ctx.user.id },
  });
  await audit(ctx, { action: 'SETTING_CHANGED', resource: 'setting', resourceId: key, before: before?.value, after: after.value });
  return after;
}
