import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@siow/db';
import { formatBRL, formatBrDate, renderTemplate, type TemplateVars } from '@siow/shared';
import type { z } from 'zod';
import type { prepareMessageSchema, sendMessageSchema, upsertTemplateSchema } from '@siow/shared';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { RequestContext } from '../../../common/auth/decorators.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { adapterFor } from './adapters.js';

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------- templates ----------------
  listTemplates() {
    return this.prisma.messageTemplate.findMany({ orderBy: { name: 'asc' } });
  }

  async upsertTemplate(ctx: RequestContext, input: z.infer<typeof upsertTemplateSchema>) {
    const before = await this.prisma.messageTemplate.findUnique({ where: { key: input.key } });
    const t = await this.prisma.messageTemplate.upsert({ where: { key: input.key }, update: input, create: input });
    await this.audit.log(ctx, { action: before ? 'UPDATE' : 'CREATE', resource: 'messageTemplate', resourceId: t.id, before, after: t });
    return t;
  }

  // ---------------- variáveis ----------------
  async buildVars(input: { entityId: string; contactId?: string | null; invoiceId?: string | null; serviceOrderId?: string | null; extra?: Record<string, string> }): Promise<TemplateVars> {
    const [entity, contact, invoice, so, company] = await Promise.all([
      this.prisma.entity.findFirst({ where: { id: input.entityId, deletedAt: null } }),
      input.contactId ? this.prisma.contact.findFirst({ where: { id: input.contactId, deletedAt: null } }) : null,
      input.invoiceId ? this.prisma.invoice.findFirst({ where: { id: input.invoiceId }, include: { contract: true } }) : null,
      input.serviceOrderId ? this.prisma.serviceOrder.findFirst({ where: { id: input.serviceOrderId }, include: { contract: true } }) : null,
      this.prisma.setting.findUnique({ where: { key: 'company.name' } }),
    ]);
    if (!entity) throw new NotFoundException('Entidade não encontrada');
    const comp = so ?? invoice;
    return {
      entidade: entity.name,
      entidade_curta: entity.shortName ?? entity.name,
      municipio: entity.municipality,
      uf: entity.uf,
      contato: contact?.name ?? '',
      cargo: contact?.role ?? '',
      competencia: comp ? String(comp.competenceMonth).padStart(2, '0') : '',
      exercicio: comp ? String(comp.competenceYear) : '',
      contrato: so?.contract?.number ?? invoice?.contract?.number ?? '',
      numeroNota: invoice?.number ?? '',
      valor: invoice ? formatBRL(invoice.amount.toFixed(2)) : '',
      emissao: invoice ? formatBrDate(invoice.issueDate) : '',
      empresa: typeof company?.value === 'string' ? company.value : 'Nossa empresa',
      ...(input.extra ?? {}),
    };
  }

  /** Pré-preenche a mensagem (o usuário pode editar antes de confirmar). */
  async prepare(input: z.infer<typeof prepareMessageSchema>) {
    const template = await this.prisma.messageTemplate.findUnique({ where: { key: input.templateKey } });
    if (!template || !template.isActive) throw new NotFoundException('Modelo de mensagem não encontrado');
    const contact = await this.prisma.contact.findFirst({ where: { id: input.contactId, entityId: input.entityId, deletedAt: null } });
    if (!contact) throw new NotFoundException('Contato não encontrado');
    const recipient = input.channel === 'WHATSAPP' ? (contact.whatsapp ?? contact.phone) : contact.email;
    if (!recipient) throw new BadRequestException(`Contato sem ${input.channel === 'WHATSAPP' ? 'WhatsApp/telefone' : 'e-mail'} cadastrado`);
    const vars = await this.buildVars({ entityId: input.entityId, contactId: input.contactId, invoiceId: input.invoiceId, serviceOrderId: input.serviceOrderId, extra: input.extraVars });
    const adapter = adapterFor(input.channel);
    return {
      templateKey: template.key,
      channel: input.channel,
      recipient,
      subject: template.subject ? renderTemplate(template.subject, vars) : null,
      body: renderTemplate(template.body, vars),
      providerConfigured: adapter.isConfigured(),
      vars,
    };
  }

  /**
   * Envia (via provedor configurado) ou registra para envio manual.
   * Status SENT só quando o provedor confirma aceite.
   */
  async send(ctx: RequestContext, input: z.infer<typeof sendMessageSchema>) {
    const contact = await this.prisma.contact.findFirst({ where: { id: input.contactId, entityId: input.entityId, deletedAt: null } });
    if (!contact) throw new NotFoundException('Contato não encontrado');
    const recipient = input.channel === 'WHATSAPP' ? (contact.whatsapp ?? contact.phone) : contact.email;
    if (!recipient) throw new BadRequestException('Contato sem canal de destino');
    const template = input.templateKey ? await this.prisma.messageTemplate.findUnique({ where: { key: input.templateKey } }) : null;
    const adapter = adapterFor(input.channel);

    const base: Prisma.OutboundMessageUncheckedCreateInput = {
      channel: input.channel,
      templateId: template?.id ?? null,
      entityId: input.entityId,
      contactId: contact.id,
      invoiceId: input.invoiceId ?? null,
      serviceOrderId: input.serviceOrderId ?? null,
      recipient,
      subject: input.subject ?? null,
      body: input.body,
      sentByUserId: ctx.user.id,
      status: 'DRAFT',
    };

    if (!adapter.isConfigured()) {
      const msg = await this.prisma.outboundMessage.create({ data: { ...base, status: 'MANUAL_PENDING', providerName: 'manual' } });
      await this.audit.log(ctx, { action: 'MESSAGE_PREPARED_MANUAL', resource: 'outboundMessage', resourceId: msg.id, after: { channel: msg.channel, entityId: msg.entityId } });
      return { message: msg, manualLink: adapter.manualLink({ recipient, subject: input.subject, body: input.body }), sent: false };
    }

    const msg = await this.prisma.outboundMessage.create({ data: { ...base, status: 'QUEUED', providerName: adapter.providerName } });
    try {
      const result = await adapter.send({ recipient, subject: input.subject, body: input.body });
      const updated = await this.prisma.outboundMessage.update({
        where: { id: msg.id },
        data: {
          status: result.accepted ? 'SENT' : 'FAILED',
          providerMessageId: result.providerMessageId,
          providerResponse: result.response as Prisma.InputJsonValue,
          sentAt: result.accepted ? new Date() : null,
          errorMessage: result.accepted ? null : 'Provedor não confirmou o envio',
        },
      });
      await this.audit.log(ctx, { action: result.accepted ? 'MESSAGE_SENT' : 'MESSAGE_FAILED', resource: 'outboundMessage', resourceId: msg.id, after: { channel: msg.channel, providerMessageId: result.providerMessageId } });
      return { message: updated, manualLink: null, sent: result.accepted };
    } catch (err) {
      const updated = await this.prisma.outboundMessage.update({ where: { id: msg.id }, data: { status: 'FAILED', errorMessage: (err as Error).message.slice(0, 500) } });
      await this.audit.log(ctx, { action: 'MESSAGE_FAILED', resource: 'outboundMessage', resourceId: msg.id, after: { error: (err as Error).message } });
      return { message: updated, manualLink: adapter.manualLink({ recipient, subject: input.subject, body: input.body }), sent: false };
    }
  }

  /** Usuário confirma que enviou manualmente (wa.me/mailto). */
  async confirmManual(ctx: RequestContext, id: string) {
    const msg = await this.prisma.outboundMessage.findFirst({ where: { id, status: 'MANUAL_PENDING' } });
    if (!msg) throw new NotFoundException('Mensagem não encontrada ou já confirmada');
    const updated = await this.prisma.outboundMessage.update({ where: { id }, data: { status: 'MANUALLY_CONFIRMED', sentAt: new Date(), sentByUserId: ctx.user.id } });
    await this.audit.log(ctx, { action: 'MESSAGE_MANUALLY_CONFIRMED', resource: 'outboundMessage', resourceId: id });
    return updated;
  }

  listByEntity(entityId: string) {
    return this.prisma.outboundMessage.findMany({ where: { entityId }, include: { contact: { select: { id: true, name: true } }, sentBy: { select: { id: true, name: true } }, template: { select: { key: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  }
}
