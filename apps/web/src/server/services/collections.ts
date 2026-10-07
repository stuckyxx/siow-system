/**
 * Cobranças (spec §17): o status da COBRANÇA é independente do status da NOTA.
 * Cada nota tem no máximo um "caso" de cobrança, com histórico de tentativas.
 */
import type { Prisma } from '@siow/db';
import { isoToDate } from '@siow/shared';
import type { z } from 'zod';
import type { registerCollectionAttemptSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { audit } from '../audit.js';
import { notFound, type Ctx } from '../http.js';

export async function ensureCase(invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, deletedAt: null } });
  if (!invoice) throw notFound('Nota não encontrada');
  return prisma.collectionCase.upsert({
    where: { invoiceId },
    update: {},
    create: { invoiceId, entityId: invoice.entityId, status: invoice.status === 'PAID' ? 'SETTLED' : 'NOT_CHARGED' },
    include: { attempts: { orderBy: { performedAt: 'desc' }, include: { performedBy: { select: { id: true, name: true } }, contact: { select: { id: true, name: true } }, outboundMessage: true } } },
  });
}

export async function list(filter: { entityId?: string; status?: string; assigneeUserId?: string; dueOnly?: boolean }) {
  const where: Prisma.CollectionCaseWhereInput = { entityId: filter.entityId, assigneeUserId: filter.assigneeUserId };
  if (filter.status) where.status = filter.status as Prisma.CollectionCaseWhereInput['status'];
  if (filter.dueOnly) {
    where.nextActionAt = { lte: new Date() };
    where.status = { not: 'SETTLED' };
  }
  return prisma.collectionCase.findMany({
    where,
    include: {
      entity: { select: { id: true, name: true, shortName: true } },
      invoice: { select: { id: true, number: true, amount: true, status: true, competenceMonth: true, competenceYear: true, issueDate: true } },
      assignee: { select: { id: true, name: true } },
      _count: { select: { attempts: true } },
    },
    orderBy: [{ nextActionAt: 'asc' }, { updatedAt: 'desc' }],
  });
}

/** Registra uma cobrança (manual ou vinculada a uma mensagem enviada). */
export async function registerAttempt(ctx: Ctx, invoiceId: string, input: z.infer<typeof registerCollectionAttemptSchema>, messageId?: string | null) {
  const c = await ensureCase(invoiceId);
  await prisma.$transaction(async (tx) => {
    const a = await tx.collectionAttempt.create({
      data: {
        caseId: c.id,
        performedByUserId: ctx.user.id,
        performedAt: input.performedAt ? new Date(input.performedAt) : new Date(),
        channel: input.channel,
        contactId: input.contactId ?? null,
        message: input.message ?? null,
        response: input.response ?? null,
        resultingStatus: input.resultingStatus,
        nextActionAt: input.nextActionAt ? isoToDate(input.nextActionAt) : null,
        nextActionNote: input.nextActionNote ?? null,
        messageId: messageId ?? null,
      },
    });
    await tx.collectionCase.update({
      where: { id: c.id },
      data: {
        status: input.resultingStatus,
        lastAttemptAt: a.performedAt,
        nextActionAt: input.nextActionAt ? isoToDate(input.nextActionAt) : null,
        nextActionNote: input.nextActionNote ?? null,
        promisedPaymentDate: input.promisedPaymentDate ? isoToDate(input.promisedPaymentDate) : undefined,
        assigneeUserId: c.assigneeUserId ?? ctx.user.id,
      },
    });
  });
  await audit(ctx, { action: 'COLLECTION_ATTEMPT', resource: 'invoice', resourceId: invoiceId, after: { channel: input.channel, status: input.resultingStatus, nextActionAt: input.nextActionAt } });
  return ensureCase(invoiceId);
}

export async function assign(ctx: Ctx, invoiceId: string, assigneeUserId: string | null) {
  const c = await ensureCase(invoiceId);
  const updated = await prisma.collectionCase.update({ where: { id: c.id }, data: { assigneeUserId } });
  await audit(ctx, { action: 'COLLECTION_ASSIGNED', resource: 'invoice', resourceId: invoiceId, before: { assigneeUserId: c.assigneeUserId }, after: { assigneeUserId } });
  return updated;
}
