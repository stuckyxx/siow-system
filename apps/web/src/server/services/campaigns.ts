/**
 * Campanhas de relacionamento (Fase 6): um público (filtro de entidades/contatos) recebe uma mensagem
 * por WhatsApp/e-mail pelos mesmos modelos e provedores do Financeiro. Envio idempotente por destinatário:
 * só destinatários PENDING são processados; sem provedor configurado, cada mensagem fica para envio manual.
 */
import type { Prisma } from '@siow/db';
import { renderTemplate, type CampaignDetail, type CampaignRow } from '@siow/shared';
import type { z } from 'zod';
import type { campaignAudienceSchema, campaignSchema, updateCampaignSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
import { audit } from '../audit.js';
import { badRequest, notFound, type Ctx } from '../http.js';
import { adapterFor } from '../messaging/adapters.js';
import { buildVars, send as sendMessage } from './messaging.js';
import { emit } from './webhooks.js';

type Audience = z.infer<typeof campaignAudienceSchema>;

const include = { recipients: { select: { status: true } } } satisfies Prisma.CampaignInclude;
type Row = Prisma.CampaignGetPayload<{ include: typeof include }>;
function toRow(c: Row, creators: Map<string, string>): CampaignRow {
  const counts = { total: c.recipients.length, pending: 0, sent: 0, manual: 0, failed: 0, skipped: 0 };
  for (const r of c.recipients) { if (r.status === 'PENDING') counts.pending += 1; else if (r.status === 'SENT') counts.sent += 1; else if (r.status === 'MANUAL_PENDING') counts.manual += 1; else if (r.status === 'FAILED') counts.failed += 1; else counts.skipped += 1; }
  return { id: c.id, name: c.name, channel: c.channel, templateKey: c.templateKey, subject: c.subject, body: c.body, audience: (c.audience ?? {}) as Record<string, unknown>, status: c.status, scheduledAt: c.scheduledAt?.toISOString() ?? null, startedAt: c.startedAt?.toISOString() ?? null, finishedAt: c.finishedAt?.toISOString() ?? null, createdByName: c.createdByUserId ? creators.get(c.createdByUserId) ?? null : null, createdAt: c.createdAt.toISOString(), counts };
}
async function creators(ids: Array<string | null>): Promise<Map<string, string>> {
  const u = await prisma.user.findMany({ where: { id: { in: ids.filter(Boolean) as string[] } }, select: { id: true, name: true } });
  return new Map(u.map((x) => [x.id, x.name]));
}

/** Resolve o público: entidades (filtros) × contatos ativos com o canal preenchido. */
export async function resolveAudience(a: Audience, channel: 'WHATSAPP' | 'EMAIL'): Promise<Array<{ entityId: string; entityName: string; contactId: string; contactName: string; recipient: string }>> {
  const where: Prisma.EntityWhereInput = { deletedAt: null };
  if (a.entityIds?.length) where.id = { in: a.entityIds };
  if (a.entityTypes?.length) where.type = { in: a.entityTypes as never };
  if (a.ufs?.length) where.uf = { in: a.ufs.map((u) => u.toUpperCase()) };
  if (a.lifecycles?.length) {
    // ciclo de vida é derivado (mesma regra da lista de entidades): CLIENTE = contrato ativo; EX_CLIENTE = já teve contrato/nota; LEAD = nenhum
    const active: Prisma.ContractWhereInput = { status: 'ACTIVE', deletedAt: null };
    const or: Prisma.EntityWhereInput[] = [];
    if (a.lifecycles.includes('CLIENTE')) or.push({ contracts: { some: active } });
    if (a.lifecycles.includes('EX_CLIENTE')) or.push({ contracts: { none: active }, OR: [{ contracts: { some: { deletedAt: null } } }, { invoices: { some: {} } }] });
    if (a.lifecycles.includes('LEAD') || a.lifecycles.includes('PROSPECT')) or.push({ contracts: { none: { deletedAt: null } }, invoices: { none: {} } });
    if (or.length) where.OR = or;
  }
  if (a.withActiveContract === true) where.contracts = { some: { status: 'ACTIVE', deletedAt: null } };
  if (a.withActiveContract === false) where.contracts = { none: { status: 'ACTIVE', deletedAt: null } };
  const entities = await prisma.entity.findMany({ where, select: { id: true, name: true, shortName: true, contacts: { where: { deletedAt: null, isActive: true, ...(a.onlyPrimaryContacts ? { isPrimary: true } : {}), ...(a.onlyFinancialContacts ? { isFinancial: true } : {}) }, select: { id: true, name: true, phone: true, whatsapp: true, email: true } } }, orderBy: { name: 'asc' }, take: 2000 });
  const out: Array<{ entityId: string; entityName: string; contactId: string; contactName: string; recipient: string }> = [];
  for (const e of entities) for (const c of e.contacts) {
    const recipient = channel === 'WHATSAPP' ? (c.whatsapp ?? c.phone) : c.email;
    if (recipient) out.push({ entityId: e.id, entityName: e.shortName ?? e.name, contactId: c.id, contactName: c.name, recipient });
  }
  return out;
}

export async function preview(a: Audience, channel: 'WHATSAPP' | 'EMAIL'): Promise<{ total: number; entities: number; sample: Array<{ entityName: string; contactName: string; recipient: string }>; providerConfigured: boolean }> {
  const rows = await resolveAudience(a, channel);
  return { total: rows.length, entities: new Set(rows.map((r) => r.entityId)).size, sample: rows.slice(0, 10).map(({ entityName, contactName, recipient }) => ({ entityName, contactName, recipient })), providerConfigured: (await adapterFor(channel)).isConfigured() };
}

export async function list(): Promise<CampaignRow[]> {
  const rows = await prisma.campaign.findMany({ where: { deletedAt: null }, include, orderBy: { createdAt: 'desc' } });
  const cr = await creators(rows.map((r) => r.createdByUserId));
  return rows.map((c) => toRow(c, cr));
}

export async function get(id: string): Promise<CampaignDetail> {
  const c = await prisma.campaign.findFirst({ where: { id, deletedAt: null }, include: { ...include, recipients: { include: { entity: { select: { name: true, shortName: true } }, contact: { select: { name: true } }, outboundMessage: { select: { subject: true, body: true, recipient: true } } }, orderBy: { createdAt: 'asc' } } } });
  if (!c) throw notFound('Campanha não encontrada');
  const adapter = await adapterFor(c.channel as 'WHATSAPP' | 'EMAIL');
  const cr = await creators([c.createdByUserId]);
  return { ...toRow(c, cr), recipients: c.recipients.map((r) => ({ id: r.id, entityName: r.entity.shortName ?? r.entity.name, contactName: r.contact?.name ?? null, recipient: r.recipient, status: r.status, error: r.error, sentAt: r.sentAt?.toISOString() ?? null, manualLink: r.status === 'MANUAL_PENDING' && r.outboundMessage ? adapter.manualLink({ recipient: r.outboundMessage.recipient, subject: r.outboundMessage.subject, body: r.outboundMessage.body }) : null })) };
}

export async function create(ctx: Ctx, input: z.infer<typeof campaignSchema>): Promise<CampaignDetail> {
  const rows = await resolveAudience(input.audience, input.channel);
  if (!rows.length) throw badRequest('Nenhum contato com este canal no público escolhido');
  const c = await prisma.campaign.create({ data: { organizationId: currentOrgId(), name: input.name, channel: input.channel, templateKey: input.templateKey ?? null, subject: input.subject ?? null, body: input.body, audience: input.audience as Prisma.InputJsonValue, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null, createdByUserId: ctx.user.id, recipients: { create: rows.map((r) => ({ entityId: r.entityId, contactId: r.contactId, recipient: r.recipient })) } } });
  await audit(ctx, { action: 'CREATE', resource: 'campaign', resourceId: c.id, after: { name: c.name, channel: c.channel, recipients: rows.length } });
  return get(c.id);
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof updateCampaignSchema>): Promise<CampaignDetail> {
  const before = await prisma.campaign.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Campanha não encontrada');
  if (before.status !== 'DRAFT') throw badRequest('Só campanhas em rascunho podem ser editadas');
  const data: Prisma.CampaignUncheckedUpdateInput = { name: input.name, channel: input.channel, templateKey: input.templateKey, subject: input.subject, body: input.body, scheduledAt: input.scheduledAt === undefined ? undefined : input.scheduledAt ? new Date(input.scheduledAt) : null };
  if (input.audience || (input.channel && input.channel !== before.channel)) {
    const audience = input.audience ?? (before.audience as Audience);
    const rows = await resolveAudience(audience, (input.channel ?? before.channel) as 'WHATSAPP' | 'EMAIL');
    if (!rows.length) throw badRequest('Nenhum contato com este canal no público escolhido');
    await prisma.campaignRecipient.deleteMany({ where: { campaignId: id, status: 'PENDING' } });
    data.audience = audience as Prisma.InputJsonValue;
    await prisma.campaignRecipient.createMany({ data: rows.map((r) => ({ campaignId: id, entityId: r.entityId, contactId: r.contactId, recipient: r.recipient })), skipDuplicates: true });
  }
  await prisma.campaign.update({ where: { id }, data });
  await audit(ctx, { action: 'UPDATE', resource: 'campaign', resourceId: id, before: { name: before.name }, after: { name: input.name ?? before.name } });
  return get(id);
}

/** Processa até `limit` destinatários pendentes (idempotente; chamadas repetidas continuam de onde parou). */
export async function run(ctx: Ctx, id: string, limit = 50): Promise<{ processed: number; remaining: number; status: string }> {
  const c = await prisma.campaign.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw notFound('Campanha não encontrada');
  if (c.status === 'CANCELLED') throw badRequest('Campanha cancelada');
  if (c.status === 'DRAFT') await prisma.campaign.update({ where: { id }, data: { status: 'RUNNING', startedAt: new Date() } });
  const pending = await prisma.campaignRecipient.findMany({ where: { campaignId: id, status: 'PENDING' }, take: limit, orderBy: { createdAt: 'asc' } });
  let processed = 0;
  for (const r of pending) {
    try {
      if (!r.contactId) throw new Error('sem contato');
      const vars = await buildVars({ entityId: r.entityId, contactId: r.contactId });
      const res = await sendMessage(ctx, { channel: c.channel as 'WHATSAPP' | 'EMAIL', entityId: r.entityId, contactId: r.contactId, templateKey: c.templateKey ?? undefined, subject: c.subject ? renderTemplate(c.subject, vars) : null, body: renderTemplate(c.body, vars) });
      await prisma.campaignRecipient.update({ where: { id: r.id }, data: { outboundMessageId: res.message.id, status: res.sent ? 'SENT' : res.message.status === 'MANUAL_PENDING' ? 'MANUAL_PENDING' : 'FAILED', sentAt: res.sent ? new Date() : null, error: res.sent || res.message.status === 'MANUAL_PENDING' ? null : res.message.errorMessage } });
    } catch (e) {
      await prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 300) } });
    }
    processed += 1;
  }
  const remaining = await prisma.campaignRecipient.count({ where: { campaignId: id, status: 'PENDING' } });
  const status = remaining === 0 ? 'DONE' : 'RUNNING';
  await prisma.campaign.update({ where: { id }, data: { status, finishedAt: remaining === 0 ? new Date() : null } });
  await audit(ctx, { action: 'CAMPAIGN_RUN', resource: 'campaign', resourceId: id, after: { processed, remaining } });
  if (status === 'DONE') await emit('campaign.finished', { campaignId: id, name: c.name, channel: c.channel }, `campaign-finished-${id}`);
  return { processed, remaining, status };
}

export async function cancel(ctx: Ctx, id: string): Promise<void> {
  const c = await prisma.campaign.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw notFound('Campanha não encontrada');
  await prisma.campaignRecipient.updateMany({ where: { campaignId: id, status: 'PENDING' }, data: { status: 'SKIPPED' } });
  await prisma.campaign.update({ where: { id }, data: { status: 'CANCELLED', finishedAt: new Date() } });
  await audit(ctx, { action: 'UPDATE', resource: 'campaign', resourceId: id, before: { status: c.status }, after: { status: 'CANCELLED' } });
}

export async function softDelete(ctx: Ctx, id: string): Promise<void> {
  const c = await prisma.campaign.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw notFound('Campanha não encontrada');
  if (c.status === 'RUNNING') throw badRequest('Cancele a campanha antes de excluir');
  await prisma.campaign.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'campaign', resourceId: id, before: { name: c.name } });
}
