/**
 * Plataforma SaaS (Fase 9): organizações, planos, assinaturas, faturas da plataforma, uso e exportação LGPD.
 * Tudo aqui roda em modo plataforma (prismaPlatform) — só é chamado por rotas protegidas pelo login de plataforma
 * ou pelo cron. Regras: nunca apaga dados reais; organização padrão (Edição Própria) não é bloqueada nem removida.
 */
import type { z } from 'zod';
import { Prisma } from '@siow/db';
import { runSeed } from '@siow/db';
import type { platformCreateOrganizationSchema, platformUpdateOrganizationSchema, planUpsertSchema, subscriptionUpsertSchema, subscriptionInvoicePaySchema, signupSchema } from '@siow/shared';
import { prisma, prismaPlatform } from '../db.js';
import { badRequest, conflict, notFound } from '../http.js';
import { runWithOrg } from '../tenant.js';
import { invalidateAccess, resolveAccess } from '../access.js';
import type { PlatformCtx } from '../platform-auth.js';

export const DEFAULT_ORG_ID = '7a1b5c3e-5e1f-4a4e-8c0d-000000000001';
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function paudit(ctx: PlatformCtx | null, e: { action: string; resource: string; resourceId?: string | null; organizationId?: string | null; before?: unknown; after?: unknown }): Promise<void> {
  const j = (v: unknown) => (v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v, (k, x: unknown) => (k === 'passwordHash' || k === 'keyHash' ? '[redacted]' : x))) as Prisma.InputJsonValue));
  await prismaPlatform.auditLog.create({ data: { organizationId: e.organizationId ?? null, userId: null, action: e.action, resource: e.resource, resourceId: e.resourceId ?? null, before: j(e.before), after: j(e.after), justification: ctx ? `plataforma:${ctx.admin.email}` : 'plataforma:cron', ip: ctx?.ip ?? null, userAgent: ctx?.userAgent ?? null } }).catch((err) => console.error('audit failed', err));
}

// ---------------------------------------------------------------- planos
export async function listPlans() { return prismaPlatform.plan.findMany({ orderBy: [{ priceMonthly: 'asc' }, { key: 'asc' }] }); }
export async function publicPlans() { return prismaPlatform.plan.findMany({ where: { isActive: true, isPublic: true }, orderBy: { priceMonthly: 'asc' }, select: { key: true, name: true, description: true, priceMonthly: true, maxUsers: true, maxEntities: true, modules: true, trialDays: true } }); }
export async function upsertPlan(ctx: PlatformCtx, input: z.infer<typeof planUpsertSchema>) {
  const before = await prismaPlatform.plan.findUnique({ where: { key: input.key } });
  const data = { name: input.name, description: input.description ?? null, priceMonthly: D(input.priceMonthly), maxUsers: input.maxUsers ?? null, maxEntities: input.maxEntities ?? null, modules: input.modules, trialDays: input.trialDays, isActive: input.isActive, isPublic: input.isPublic };
  const plan = await prismaPlatform.plan.upsert({ where: { key: input.key }, update: data, create: { key: input.key, ...data } });
  invalidateAccess();
  await paudit(ctx, { action: before ? 'PLAN_UPDATED' : 'PLAN_CREATED', resource: 'plan', resourceId: plan.key, before, after: plan });
  return plan;
}

// ---------------------------------------------------------------- organizações
const orgSelect = {
  id: true, name: true, slug: true, document: true, plan: true, modules: true, branding: true, limits: true, domain: true, status: true, trialEndsAt: true, blockedAt: true, blockReason: true, createdAt: true, deletedAt: true,
  subscription: true,
  _count: { select: { users: { where: { deletedAt: null, isActive: true } }, entities: { where: { deletedAt: null } }, contracts: true, invoices: true } },
} satisfies Prisma.OrganizationSelect;

export async function listOrganizations(filter: { includeRemoved?: boolean } = {}) {
  const orgs = await prismaPlatform.organization.findMany({ where: filter.includeRemoved ? {} : { deletedAt: null }, select: orgSelect, orderBy: { createdAt: 'asc' } });
  const open = await prismaPlatform.subscriptionInvoice.groupBy({ by: ['organizationId', 'status'], where: { status: { in: ['OPEN', 'OVERDUE'] } }, _sum: { amount: true }, _count: true });
  return orgs.map((o) => ({ ...o, openInvoices: open.filter((x) => x.organizationId === o.id).map((x) => ({ status: x.status, count: x._count, amount: x._sum.amount?.toString() ?? '0' })) }));
}

export async function getOrganization(id: string) {
  const org = await prismaPlatform.organization.findUnique({ where: { id }, select: orgSelect });
  if (!org) throw notFound('Organização não encontrada');
  const [invoices, access, usage] = await Promise.all([
    prismaPlatform.subscriptionInvoice.findMany({ where: { organizationId: id }, orderBy: { period: 'desc' }, take: 36 }),
    resolveAccess(id),
    usageOf(id),
  ]);
  return { ...org, invoices, access, usage };
}

export async function usageOf(organizationId: string) {
  const [users, entities, contracts, invoices, tickets, opportunities, tenders, documents, lastLogin] = await Promise.all([
    prismaPlatform.user.count({ where: { organizationId, deletedAt: null, isActive: true } }),
    prismaPlatform.entity.count({ where: { organizationId, deletedAt: null } }),
    prismaPlatform.contract.count({ where: { organizationId } }),
    prismaPlatform.invoice.count({ where: { organizationId } }),
    prismaPlatform.ticket.count({ where: { organizationId } }),
    prismaPlatform.opportunity.count({ where: { organizationId } }),
    prismaPlatform.tender.count({ where: { organizationId } }),
    prismaPlatform.documentBlob.aggregate({ where: { organizationId }, _sum: { size: true }, _count: true }),
    prismaPlatform.user.aggregate({ where: { organizationId }, _max: { lastLoginAt: true } }),
  ]);
  return { users, entities, contracts, invoices, tickets, opportunities, tenders, documents: documents._count, storageBytes: Number(documents._sum.size ?? 0), lastLoginAt: lastLogin._max.lastLoginAt };
}

async function planOrThrow(key: string) {
  const plan = await prismaPlatform.plan.findUnique({ where: { key } });
  if (!plan || !plan.isActive) throw badRequest(`Plano "${key}" inexistente ou inativo`);
  return plan;
}

export async function createOrganization(ctx: PlatformCtx | null, input: z.infer<typeof platformCreateOrganizationSchema>, opts: { selfSignup?: boolean } = {}) {
  const plan = await planOrThrow(input.planKey);
  if (await prismaPlatform.organization.findUnique({ where: { slug: input.slug } })) throw conflict('Já existe uma organização com este identificador (slug)');
  if (input.domain && (await prismaPlatform.organization.findUnique({ where: { domain: input.domain } }))) throw conflict('Domínio já utilizado por outra organização');
  if (await prismaPlatform.user.findFirst({ where: { email: input.adminEmail.toLowerCase(), deletedAt: null } })) throw conflict('Já existe um usuário com este e-mail');
  const trialDays = input.trial ? plan.trialDays : 0;
  const trialEndsAt = trialDays > 0 ? new Date(Date.now() + trialDays * 86_400_000) : null;
  const org = await prismaPlatform.organization.create({
    data: { name: input.name, slug: input.slug, document: input.document ?? null, plan: plan.key, domain: input.domain ?? null, branding: (input.branding ?? {}) as Prisma.InputJsonValue, trialEndsAt,
      subscription: { create: { planKey: plan.key, status: plan.priceMonthly.isZero() ? 'EXEMPT' : trialEndsAt ? 'TRIAL' : 'ACTIVE', amount: plan.priceMonthly, trialEndsAt, currentPeriodStart: new Date(), currentPeriodEnd: trialEndsAt ?? undefined } } },
  });
  const seed = await runWithOrg(org.id, () => runSeed(prisma, { organizationId: org.id, adminEmail: input.adminEmail, adminName: input.adminName, adminPassword: input.adminPassword, requireStrongAdminPassword: true, log: () => undefined }));
  // Nome da empresa usado em mensagens/relatórios da nova organização.
  await prismaPlatform.setting.update({ where: { organizationId_key: { organizationId: org.id, key: 'company.name' } }, data: { value: input.name } }).catch(() => undefined);
  await paudit(ctx, { action: opts.selfSignup ? 'ORGANIZATION_SIGNUP' : 'ORGANIZATION_CREATED', resource: 'organization', resourceId: org.id, organizationId: org.id, after: { name: org.name, slug: org.slug, plan: plan.key, trialEndsAt, adminEmail: seed.adminEmail } });
  return { organization: { id: org.id, slug: org.slug, name: org.name, trialEndsAt }, admin: { email: seed.adminEmail, created: seed.adminCreated } };
}

export async function updateOrganization(ctx: PlatformCtx, id: string, input: z.infer<typeof platformUpdateOrganizationSchema>) {
  const before = await prismaPlatform.organization.findUnique({ where: { id } });
  if (!before || before.deletedAt) throw notFound('Organização não encontrada');
  if (id === DEFAULT_ORG_ID && input.status && input.status !== 'ACTIVE') throw badRequest('A organização padrão não pode ser bloqueada ou suspensa');
  if (input.domain && input.domain !== before.domain && (await prismaPlatform.organization.findUnique({ where: { domain: input.domain } }))) throw conflict('Domínio já utilizado por outra organização');
  const branding = input.branding ? { ...((before.branding as Record<string, unknown>) ?? {}), ...Object.fromEntries(Object.entries(input.branding).filter(([, v]) => v !== undefined)) } : undefined;
  const limits = input.limits ? { ...((before.limits as Record<string, unknown>) ?? {}), ...input.limits } : undefined;
  const statusChange = input.status && input.status !== before.status;
  const org = await prismaPlatform.organization.update({
    where: { id },
    data: {
      name: input.name, document: input.document, domain: input.domain, modules: input.modules as Prisma.InputJsonValue | undefined,
      branding: branding as Prisma.InputJsonValue | undefined, limits: limits as Prisma.InputJsonValue | undefined, status: input.status,
      blockReason: input.status === 'ACTIVE' ? null : input.blockReason,
      blockedAt: statusChange ? (input.status === 'ACTIVE' ? null : new Date()) : undefined,
    },
  });
  if (statusChange && input.status === 'SUSPENDED') {
    const users = await prismaPlatform.user.findMany({ where: { organizationId: id }, select: { id: true } });
    await prismaPlatform.session.updateMany({ where: { userId: { in: users.map((u) => u.id) }, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  invalidateAccess(id);
  await paudit(ctx, { action: 'ORGANIZATION_UPDATED', resource: 'organization', resourceId: id, organizationId: id, before, after: org });
  return org;
}

export async function removeOrganization(ctx: PlatformCtx, id: string) {
  const org = await prismaPlatform.organization.findUnique({ where: { id }, include: { _count: { select: { entities: { where: { deletedAt: null } }, invoices: true, contracts: true } } } });
  if (!org || org.deletedAt) throw notFound('Organização não encontrada');
  if (org.id === DEFAULT_ORG_ID) throw badRequest('A organização padrão não pode ser removida');
  if (org._count.entities || org._count.invoices || org._count.contracts) throw badRequest('Organização com dados de negócio: use suspensão (nada é apagado)');
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  await prismaPlatform.$transaction(async (tx) => {
    const users = await tx.user.findMany({ where: { organizationId: org.id }, select: { id: true, email: true } });
    await tx.session.updateMany({ where: { userId: { in: users.map((u) => u.id) }, revokedAt: null }, data: { revokedAt: new Date() } });
    for (const u of users) await tx.user.update({ where: { id: u.id }, data: { isActive: false, deletedAt: new Date(), email: `${u.email}.removida-${stamp}` } });
    await tx.subscription.updateMany({ where: { organizationId: org.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    await tx.organization.update({ where: { id: org.id }, data: { status: 'SUSPENDED', deletedAt: new Date(), slug: `${org.slug}-removida-${stamp}`, domain: null } });
  });
  invalidateAccess(id);
  await paudit(ctx, { action: 'ORGANIZATION_REMOVED', resource: 'organization', resourceId: id, organizationId: id, before: { slug: org.slug } });
  return { ok: true, mode: 'soft-delete' };
}

// ---------------------------------------------------------------- assinaturas e faturas
export async function upsertSubscription(ctx: PlatformCtx, organizationId: string, input: z.infer<typeof subscriptionUpsertSchema>) {
  const org = await prismaPlatform.organization.findUnique({ where: { id: organizationId } });
  if (!org || org.deletedAt) throw notFound('Organização não encontrada');
  const plan = await planOrThrow(input.planKey);
  const before = await prismaPlatform.subscription.findUnique({ where: { organizationId } });
  const amount = input.amount !== undefined ? D(input.amount) : plan.priceMonthly;
  const trialEndsAt = input.trialEndsAt ? new Date(`${input.trialEndsAt}T23:59:59.000Z`) : input.status === 'TRIAL' ? before?.trialEndsAt ?? new Date(Date.now() + plan.trialDays * 86_400_000) : null;
  const data = { planKey: plan.key, status: input.status, amount, billingDay: input.billingDay, graceDays: input.graceDays, trialEndsAt, notes: input.notes ?? null, cancelledAt: input.status === 'CANCELLED' ? before?.cancelledAt ?? new Date() : null };
  const sub = await prismaPlatform.subscription.upsert({ where: { organizationId }, update: data, create: { organizationId, ...data, currentPeriodStart: new Date() } });
  // Desbloqueio/bloqueio acompanha o status da assinatura (bloqueio suave = somente leitura).
  const orgStatus = input.status === 'BLOCKED' ? 'READONLY' : org.status === 'READONLY' && before?.status === 'BLOCKED' ? 'ACTIVE' : undefined;
  await prismaPlatform.organization.update({ where: { id: organizationId }, data: { plan: plan.key, trialEndsAt, status: orgStatus, blockedAt: orgStatus === 'READONLY' ? new Date() : orgStatus === 'ACTIVE' ? null : undefined, blockReason: orgStatus === 'READONLY' ? 'Assinatura bloqueada' : orgStatus === 'ACTIVE' ? null : undefined } });
  invalidateAccess(organizationId);
  await paudit(ctx, { action: 'SUBSCRIPTION_UPDATED', resource: 'subscription', resourceId: sub.id, organizationId, before, after: sub });
  return sub;
}

export async function listInvoices(filter: { organizationId?: string; status?: string }) {
  return prismaPlatform.subscriptionInvoice.findMany({ where: { organizationId: filter.organizationId, status: filter.status }, include: { organization: { select: { name: true, slug: true } } }, orderBy: [{ dueDate: 'desc' }], take: 300 });
}

/** Gera (idempotente) a fatura do período para uma assinatura cobrável. Período = "YYYY-MM"; vencimento = billingDay do mês. */
export async function generateInvoice(organizationId: string, period: string, ctx: PlatformCtx | null = null) {
  const sub = await prismaPlatform.subscription.findUnique({ where: { organizationId } });
  if (!sub) throw notFound('Organização sem assinatura');
  if (!['ACTIVE', 'PAST_DUE', 'BLOCKED'].includes(sub.status) || sub.amount.isZero()) throw badRequest('Assinatura não cobrável (isenta, em teste ou cancelada)');
  const existing = await prismaPlatform.subscriptionInvoice.findUnique({ where: { organizationId_period: { organizationId, period } } });
  if (existing) return { invoice: existing, created: false };
  const [y, m] = period.split('-').map(Number) as [number, number];
  const dueDate = new Date(Date.UTC(y, m - 1, sub.billingDay));
  const invoice = await prismaPlatform.subscriptionInvoice.create({ data: { organizationId, period, amount: sub.amount, dueDate, status: 'OPEN' } });
  await prismaPlatform.subscription.update({ where: { organizationId }, data: { currentPeriodStart: new Date(Date.UTC(y, m - 1, 1)), currentPeriodEnd: new Date(Date.UTC(y, m, 0)) } });
  await paudit(ctx, { action: 'PLATFORM_INVOICE_CREATED', resource: 'subscription_invoice', resourceId: invoice.id, organizationId, after: invoice });
  return { invoice, created: true };
}

export async function payInvoice(ctx: PlatformCtx, id: string, input: z.infer<typeof subscriptionInvoicePaySchema>) {
  const inv = await prismaPlatform.subscriptionInvoice.findUnique({ where: { id } });
  if (!inv) throw notFound('Fatura não encontrada');
  if (inv.status === 'PAID') return inv;
  if (inv.status === 'CANCELLED') throw badRequest('Fatura cancelada');
  const paid = await prismaPlatform.subscriptionInvoice.update({ where: { id }, data: { status: 'PAID', paidAt: new Date(`${input.paidAt ?? ymd(new Date())}T00:00:00.000Z`), paymentRef: input.paymentRef ?? null, notes: input.notes ?? inv.notes } });
  // Sem mais faturas vencidas → assinatura volta a ACTIVE e desbloqueia a organização.
  const stillOverdue = await prismaPlatform.subscriptionInvoice.count({ where: { organizationId: inv.organizationId, status: 'OVERDUE' } });
  if (!stillOverdue) {
    const sub = await prismaPlatform.subscription.findUnique({ where: { organizationId: inv.organizationId } });
    if (sub && ['PAST_DUE', 'BLOCKED'].includes(sub.status)) {
      await prismaPlatform.subscription.update({ where: { organizationId: inv.organizationId }, data: { status: 'ACTIVE' } });
      await prismaPlatform.organization.updateMany({ where: { id: inv.organizationId, status: 'READONLY' }, data: { status: 'ACTIVE', blockedAt: null, blockReason: null } });
      invalidateAccess(inv.organizationId);
    }
  }
  await paudit(ctx, { action: 'PLATFORM_INVOICE_PAID', resource: 'subscription_invoice', resourceId: id, organizationId: inv.organizationId, before: inv, after: paid });
  return paid;
}

export async function cancelInvoice(ctx: PlatformCtx, id: string, reason: string) {
  const inv = await prismaPlatform.subscriptionInvoice.findUnique({ where: { id } });
  if (!inv) throw notFound('Fatura não encontrada');
  if (inv.status === 'PAID') throw badRequest('Fatura paga não pode ser cancelada');
  const out = await prismaPlatform.subscriptionInvoice.update({ where: { id }, data: { status: 'CANCELLED', notes: reason } });
  await paudit(ctx, { action: 'PLATFORM_INVOICE_CANCELLED', resource: 'subscription_invoice', resourceId: id, organizationId: inv.organizationId, before: inv, after: out });
  return out;
}

/**
 * Rotina diária da plataforma (cron): gera a fatura do mês, marca vencidas (OVERDUE → assinatura PAST_DUE),
 * bloqueia suavemente após a carência (BLOCKED → organização READONLY) e encerra testes vencidos.
 * Idempotente; a organização padrão nunca é bloqueada.
 */
export async function runBilling(now = new Date()) {
  const period = now.toISOString().slice(0, 7);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const out = { period, generated: 0, overdue: 0, blocked: 0, trialsEnded: 0, reactivated: 0 };
  const subs = await prismaPlatform.subscription.findMany({ where: { organization: { deletedAt: null } }, include: { organization: { select: { id: true, status: true } } } });
  for (const sub of subs) {
    const orgId = sub.organizationId;
    if (sub.status === 'TRIAL' && sub.trialEndsAt && sub.trialEndsAt < now) {
      // Teste encerrado: plano pago passa a cobrar (ACTIVE); plano gratuito fica isento.
      await prismaPlatform.subscription.update({ where: { organizationId: orgId }, data: { status: sub.amount.isZero() ? 'EXEMPT' : 'ACTIVE' } });
      sub.status = sub.amount.isZero() ? 'EXEMPT' : 'ACTIVE';
      out.trialsEnded++;
    }
    if (!['ACTIVE', 'PAST_DUE', 'BLOCKED'].includes(sub.status) || sub.amount.isZero()) continue;
    const r = await generateInvoice(orgId, period).catch(() => null);
    if (r?.created) out.generated++;
    const marked = await prismaPlatform.subscriptionInvoice.updateMany({ where: { organizationId: orgId, status: 'OPEN', dueDate: { lt: today } }, data: { status: 'OVERDUE' } });
    out.overdue += marked.count;
    const overdue = await prismaPlatform.subscriptionInvoice.findMany({ where: { organizationId: orgId, status: 'OVERDUE' }, orderBy: { dueDate: 'asc' } });
    if (overdue.length) {
      const oldest = overdue[0]!;
      const blockAt = new Date(oldest.dueDate.getTime() + sub.graceDays * 86_400_000);
      const shouldBlock = today > blockAt && orgId !== DEFAULT_ORG_ID;
      const next = shouldBlock ? 'BLOCKED' : 'PAST_DUE';
      if (sub.status !== next) await prismaPlatform.subscription.update({ where: { organizationId: orgId }, data: { status: next } });
      if (shouldBlock && sub.organization.status === 'ACTIVE') {
        await prismaPlatform.organization.update({ where: { id: orgId }, data: { status: 'READONLY', blockedAt: now, blockReason: `Fatura ${oldest.period} vencida em ${ymd(oldest.dueDate)} sem pagamento após ${sub.graceDays} dias de carência` } });
        await paudit(null, { action: 'ORGANIZATION_SOFT_BLOCKED', resource: 'organization', resourceId: orgId, organizationId: orgId, after: { period: oldest.period } });
        out.blocked++;
      }
      invalidateAccess(orgId);
    } else if (['PAST_DUE', 'BLOCKED'].includes(sub.status)) {
      await prismaPlatform.subscription.update({ where: { organizationId: orgId }, data: { status: 'ACTIVE' } });
      await prismaPlatform.organization.updateMany({ where: { id: orgId, status: 'READONLY' }, data: { status: 'ACTIVE', blockedAt: null, blockReason: null } });
      invalidateAccess(orgId);
      out.reactivated++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- configurações da plataforma (guardadas na organização padrão)
export async function platformSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await prismaPlatform.setting.findUnique({ where: { organizationId_key: { organizationId: DEFAULT_ORG_ID, key } } });
  return (s?.value as T | undefined) ?? fallback;
}
export async function setPlatformSetting(ctx: PlatformCtx, key: string, value: unknown) {
  const before = await prismaPlatform.setting.findUnique({ where: { organizationId_key: { organizationId: DEFAULT_ORG_ID, key } } });
  const after = await prismaPlatform.setting.upsert({ where: { organizationId_key: { organizationId: DEFAULT_ORG_ID, key } }, update: { value: value as Prisma.InputJsonValue }, create: { organizationId: DEFAULT_ORG_ID, key, value: value as Prisma.InputJsonValue, description: 'Configuração da plataforma' } });
  await paudit(ctx, { action: 'PLATFORM_SETTING_CHANGED', resource: 'setting', resourceId: key, before: before?.value, after: after.value });
  return after;
}

/** Autocadastro público (quando habilitado em `platform.selfSignup`). */
export async function selfSignup(input: z.infer<typeof signupSchema>) {
  if (!(await platformSetting('platform.selfSignup', false))) throw badRequest('O cadastro por conta própria está desabilitado. Fale com a Siow System.');
  const planKey = input.planKey ?? (await platformSetting('platform.defaultPlan', 'SAAS_BASICO'));
  const plan = await prismaPlatform.plan.findUnique({ where: { key: planKey } });
  if (!plan || !plan.isActive || !plan.isPublic) throw badRequest('Plano indisponível para autocadastro');
  const base = input.companyName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'empresa';
  let slug = base;
  for (let i = 2; await prismaPlatform.organization.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
  return createOrganization(null, { name: input.companyName, slug, document: input.document ?? null, adminName: input.adminName, adminEmail: input.adminEmail, adminPassword: input.adminPassword, planKey: plan.key, trial: true, domain: null }, { selfSignup: true });
}

// ---------------------------------------------------------------- exportação LGPD (JSON completo da organização)
export async function exportOrganization(organizationId: string) {
  const org = await prismaPlatform.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, slug: true, document: true, plan: true, branding: true, createdAt: true } });
  if (!org) throw notFound('Organização não encontrada');
  const w = { organizationId };
  const [users, entities, contracts, invoices, collections, serviceOrders, certificates, opportunities, tenders, tickets, campaigns, partners, tasks, settings, documents, waConversations] = await Promise.all([
    prismaPlatform.user.findMany({ where: w, select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true, createdAt: true, roles: { select: { role: { select: { name: true } } } } } }),
    prismaPlatform.entity.findMany({ where: w, include: { contacts: true } }),
    prismaPlatform.contract.findMany({ where: w, include: { amendments: true } }),
    prismaPlatform.invoice.findMany({ where: w }),
    prismaPlatform.collectionCase.findMany({ where: w, include: { attempts: true } }),
    prismaPlatform.serviceOrder.findMany({ where: w }),
    prismaPlatform.certificate.findMany({ where: w }),
    prismaPlatform.opportunity.findMany({ where: w, include: { items: true, events: true, proposals: true } }),
    prismaPlatform.tender.findMany({ where: w }),
    prismaPlatform.ticket.findMany({ where: w, include: { interactions: true } }),
    prismaPlatform.campaign.findMany({ where: w, include: { recipients: true } }),
    prismaPlatform.partner.findMany({ where: w }),
    prismaPlatform.financialTask.findMany({ where: w }),
    prismaPlatform.setting.findMany({ where: w }),
    prismaPlatform.document.findMany({ where: w, select: { id: true, name: true, type: true, createdAt: true, entityId: true, contractId: true, invoiceId: true, blob: { select: { mimeType: true, size: true } } } }),
    prismaPlatform.waConversation.findMany({ where: w, include: { messages: true } }),
  ]);
  return { exportedAt: new Date().toISOString(), format: 'siow-export/v1', organization: org, users, entities, contracts, invoices, collections, serviceOrders, certificates, opportunities, tenders, tickets, campaigns, partners, tasks, settings, documents, whatsapp: waConversations };
}

/** Painel da plataforma: visão geral. */
export async function overview() {
  const [orgs, subs, invoices, plans] = await Promise.all([
    prismaPlatform.organization.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
    prismaPlatform.subscription.groupBy({ by: ['status'], where: { organization: { deletedAt: null } }, _count: true, _sum: { amount: true } }),
    prismaPlatform.subscriptionInvoice.groupBy({ by: ['status'], _count: true, _sum: { amount: true } }),
    prismaPlatform.plan.count({ where: { isActive: true } }),
  ]);
  const mrr = subs.filter((s) => ['ACTIVE', 'PAST_DUE'].includes(s.status)).reduce((a, s) => a.plus(s._sum.amount ?? 0), new Prisma.Decimal(0));
  return { organizations: orgs.map((o) => ({ status: o.status, count: o._count })), subscriptions: subs.map((s) => ({ status: s.status, count: s._count, amount: s._sum.amount?.toString() ?? '0' })), invoices: invoices.map((i) => ({ status: i.status, count: i._count, amount: i._sum.amount?.toString() ?? '0' })), plans, mrr: mrr.toString() };
}
