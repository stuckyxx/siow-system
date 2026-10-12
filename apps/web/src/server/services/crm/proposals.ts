/**
 * Propostas comerciais versionadas: cada nova proposta da oportunidade recebe version = anterior + 1 e as
 * anteriores (DRAFT/SENT) passam a SUPERSEDED. PDF gerado sob demanda com o padrão visual dos relatórios.
 */
import PDFDocument from 'pdfkit';
import { Prisma } from '@siow/db';
import { formatBRL, formatBrDate, formatBrDateTime, isoToDate, RECURRENCE_LABELS, type ProposalRow, type Recurrence } from '@siow/shared';
import type { z } from 'zod';
import type { createProposalSchema, updateProposalStatusSchema } from '@siow/shared';
import { prisma } from '../../db.js';
import { currentOrgId } from '../../tenant.js';
import { audit } from '../../audit.js';
import { badRequest, notFound, type Ctx } from '../../http.js';
import { LOGO_PNG } from '../../reports/logo.js';

const toRow = (p: Prisma.ProposalGetPayload<{ include: { items: true } }>): ProposalRow => ({
  id: p.id, opportunityId: p.opportunityId, version: p.version, title: p.title, status: p.status, validUntil: p.validUntil ? p.validUntil.toISOString().slice(0, 10) : null,
  introduction: p.introduction, terms: p.terms, notes: p.notes, totalMonthly: p.totalMonthly.toFixed(2), totalOneTime: p.totalOneTime.toFixed(2), sentAt: p.sentAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString(),
  items: [...p.items].sort((a, b) => a.position - b.position).map((i) => ({ id: i.id, description: i.description, quantity: i.quantity.toFixed(2), unitPrice: i.unitPrice.toFixed(2), recurrence: i.recurrence, total: i.total.toFixed(2), position: i.position })),
});

export async function list(opportunityId: string): Promise<ProposalRow[]> {
  const rows = await prisma.proposal.findMany({ where: { opportunityId }, include: { items: true }, orderBy: { version: 'desc' } });
  return rows.map(toRow);
}

export async function get(id: string): Promise<ProposalRow> {
  const p = await prisma.proposal.findFirst({ where: { id }, include: { items: true } });
  if (!p) throw notFound('Proposta não encontrada');
  return toRow(p);
}

export async function create(ctx: Ctx, opportunityId: string, input: z.infer<typeof createProposalSchema>): Promise<ProposalRow> {
  const o = await prisma.opportunity.findFirst({ where: { id: opportunityId, deletedAt: null }, select: { id: true, status: true, title: true } });
  if (!o) throw notFound('Oportunidade não encontrada');
  if (o.status === 'LOST') throw badRequest('Oportunidade perdida: reabra antes de criar proposta');
  let monthly = new Prisma.Decimal(0); let oneTime = new Prisma.Decimal(0);
  const items = input.items.map((it, i) => {
    const total = new Prisma.Decimal(it.unitPrice).mul(it.quantity);
    if (it.recurrence === 'MONTHLY') monthly = monthly.add(total); else if (it.recurrence === 'YEARLY') monthly = monthly.add(total.div(12)); else oneTime = oneTime.add(total);
    return { description: it.description, quantity: new Prisma.Decimal(it.quantity), unitPrice: new Prisma.Decimal(it.unitPrice), recurrence: it.recurrence, total, position: i };
  });
  const p = await prisma.$transaction(async (tx) => {
    const last = await tx.proposal.findFirst({ where: { opportunityId }, orderBy: { version: 'desc' }, select: { version: true } });
    await tx.proposal.updateMany({ where: { opportunityId, status: { in: ['DRAFT', 'SENT'] } }, data: { status: 'SUPERSEDED' } });
    const created = await tx.proposal.create({
      data: { organizationId: currentOrgId(), opportunityId, version: (last?.version ?? 0) + 1, title: input.title, validUntil: input.validUntil ? isoToDate(input.validUntil) : null, introduction: input.introduction ?? null, terms: input.terms ?? null, notes: input.notes ?? null, totalMonthly: monthly.toDecimalPlaces(2), totalOneTime: oneTime, createdByUserId: ctx.user.id, items: { create: items } },
      include: { items: true },
    });
    await tx.opportunityEvent.create({ data: { opportunityId, userId: ctx.user.id, action: 'PROPOSAL_CREATED', toValue: `v${created.version} · ${created.title}` } });
    await tx.opportunity.update({ where: { id: opportunityId }, data: { lastActivityAt: new Date() } });
    return created;
  });
  await audit(ctx, { action: 'CREATE', resource: 'proposal', resourceId: p.id, after: { opportunityId, version: p.version, totalMonthly: p.totalMonthly, totalOneTime: p.totalOneTime } });
  return toRow(p);
}

export async function setStatus(ctx: Ctx, id: string, input: z.infer<typeof updateProposalStatusSchema>): Promise<ProposalRow> {
  const before = await prisma.proposal.findFirst({ where: { id }, include: { items: true } });
  if (!before) throw notFound('Proposta não encontrada');
  if (before.status === 'SUPERSEDED') throw badRequest('Proposta substituída por uma versão mais nova');
  const p = await prisma.proposal.update({ where: { id }, data: { status: input.status, sentAt: input.status === 'SENT' && !before.sentAt ? new Date() : undefined }, include: { items: true } });
  await prisma.opportunityEvent.create({ data: { opportunityId: p.opportunityId, userId: ctx.user.id, action: 'PROPOSAL_STATUS', fromValue: before.status, toValue: `${input.status} (v${p.version})` } });
  await prisma.opportunity.update({ where: { id: p.opportunityId }, data: { lastActivityAt: new Date() } });
  await audit(ctx, { action: 'UPDATE', resource: 'proposal', resourceId: id, before: { status: before.status }, after: { status: p.status } });
  return toRow(p);
}

/** PDF da proposta (A4): cabeçalho no padrão dos relatórios, dados da entidade, itens, totais, condições e validade. */
export async function pdf(id: string): Promise<{ buffer: Buffer; fileName: string }> {
  const p = await prisma.proposal.findFirst({ where: { id }, include: { items: { orderBy: { position: 'asc' } }, opportunity: { include: { entity: true, owner: { select: { name: true, email: true } } } } } });
  if (!p) throw notFound('Proposta não encontrada');
  const [org, company] = await Promise.all([prisma.organization.findUnique({ where: { id: currentOrgId() }, select: { name: true, branding: true } }), prisma.setting.findUnique({ where: { key: 'company.name' } })]);
  const companyName = (typeof company?.value === 'string' && company.value) || org?.name || 'Siow System Tecnologia';
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width; const L = doc.page.margins.left; const R = W - doc.page.margins.right;
    const grad = doc.linearGradient(0, 0, W, 90); grad.stop(0, '#0f2a5a').stop(1, '#3b1f8a');
    doc.rect(0, 0, W, 90).fill(grad);
    doc.image(LOGO_PNG, L, 20, { height: 48 });
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(16).text('PROPOSTA COMERCIAL', L + 130, 24, { width: R - L - 130 });
    doc.font('Helvetica').fontSize(9).fillColor('#dbe4ff').text(`${companyName} · Proposta nº ${p.version} · ${formatBrDate(p.createdAt)}`, L + 130, 48);
    doc.fillColor('#111').font('Helvetica');
    let y = 112;
    doc.font('Helvetica-Bold').fontSize(13).text(p.title, L, y, { width: R - L }); y = doc.y + 6;
    doc.font('Helvetica').fontSize(10).fillColor('#333');
    const e = p.opportunity.entity;
    doc.text(`Para: ${e.name}`, L, y); y = doc.y;
    doc.text(`${e.municipality}/${e.uf}${e.cnpj ? ` · CNPJ ${e.cnpj}` : ''}`, L, y); y = doc.y;
    if (p.validUntil) { doc.text(`Validade: ${formatBrDate(p.validUntil)}`, L, y); y = doc.y; }
    if (p.opportunity.owner) { doc.text(`Responsável comercial: ${p.opportunity.owner.name}${p.opportunity.owner.email ? ` · ${p.opportunity.owner.email}` : ''}`, L, y); y = doc.y; }
    y += 10;
    if (p.introduction) { doc.fillColor('#111').fontSize(10).text(p.introduction, L, y, { width: R - L, align: 'justify' }); y = doc.y + 12; }
    // tabela de itens
    const cols = [{ k: 'd', label: 'Descrição', w: 0.46, a: 'left' }, { k: 'q', label: 'Qtd.', w: 0.1, a: 'right' }, { k: 'u', label: 'Valor unit.', w: 0.16, a: 'right' }, { k: 'r', label: 'Recorrência', w: 0.13, a: 'left' }, { k: 't', label: 'Total', w: 0.15, a: 'right' }] as const;
    const tw = R - L;
    const header = (): void => {
      doc.rect(L, y, tw, 18).fill('#eef2f8'); doc.fillColor('#0f2a5a').font('Helvetica-Bold').fontSize(9);
      let x = L; for (const c of cols) { doc.text(c.label, x + 4, y + 5, { width: c.w * tw - 8, align: c.a }); x += c.w * tw; }
      y += 18; doc.fillColor('#111').font('Helvetica');
    };
    header();
    for (const it of p.items) {
      const h = Math.max(16, doc.heightOfString(it.description, { width: cols[0].w * tw - 8 }) + 6);
      if (y + h > doc.page.height - 120) { doc.addPage(); y = doc.page.margins.top; header(); }
      const vals = { d: it.description, q: it.quantity.toFixed(2).replace('.', ','), u: formatBRL(it.unitPrice.toString()), r: RECURRENCE_LABELS[it.recurrence as Recurrence] ?? it.recurrence, t: formatBRL(it.total.toString()) };
      let x = L; doc.fontSize(9);
      for (const c of cols) { doc.text(vals[c.k], x + 4, y + 3, { width: c.w * tw - 8, align: c.a }); x += c.w * tw; }
      y += h; doc.moveTo(L, y).lineTo(R, y).strokeColor('#e3e8ef').stroke();
    }
    y += 8;
    doc.font('Helvetica-Bold').fontSize(10);
    if (p.totalMonthly.gt(0)) { doc.text(`Total mensal: ${formatBRL(p.totalMonthly.toString())}`, L, y, { width: tw, align: 'right' }); y = doc.y + 2; }
    if (p.totalOneTime.gt(0)) { doc.text(`Total único: ${formatBRL(p.totalOneTime.toString())}`, L, y, { width: tw, align: 'right' }); y = doc.y + 2; }
    if (p.opportunity.termMonths && p.totalMonthly.gt(0)) { doc.font('Helvetica').fontSize(9).fillColor('#333').text(`Prazo previsto: ${p.opportunity.termMonths} meses · valor global estimado ${formatBRL(p.totalMonthly.mul(p.opportunity.termMonths).add(p.totalOneTime).toString())}`, L, y, { width: tw, align: 'right' }); y = doc.y + 2; }
    y += 12;
    if (p.terms) { doc.fillColor('#111').font('Helvetica-Bold').fontSize(10).text('Condições', L, y); y = doc.y + 2; doc.font('Helvetica').fontSize(9.5).text(p.terms, L, y, { width: tw, align: 'justify' }); y = doc.y + 10; }
    if (p.notes) { doc.font('Helvetica-Bold').fontSize(10).text('Observações', L, y); y = doc.y + 2; doc.font('Helvetica').fontSize(9.5).text(p.notes, L, y, { width: tw }); y = doc.y + 10; }
    doc.fontSize(8).fillColor('#777').text(`Documento gerado pelo Siow System em ${formatBrDateTime(new Date())} · versão ${p.version}${p.status === 'SUPERSEDED' ? ' (substituída)' : ''}`, L, doc.page.height - 60, { width: tw, align: 'center' });
    doc.end();
  });
  const slug = p.opportunity.entity.shortName ?? p.opportunity.entity.name;
  return { buffer, fileName: `proposta-v${p.version}-${slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf` };
}
