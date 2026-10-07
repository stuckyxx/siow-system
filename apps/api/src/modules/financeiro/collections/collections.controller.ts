import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { COLLECTION_STATUSES, boolParam, registerCollectionAttemptSchema, sendMessageSchema } from '@siow/shared';
import { Ctx, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { MessagingService } from '../messaging/messaging.service.js';
import { CollectionsService } from './collections.service.js';

const listSchema = z.object({
  entityId: z.string().uuid().optional(),
  status: z.enum(COLLECTION_STATUSES).optional(),
  assigneeUserId: z.string().uuid().optional(),
  dueOnly: boolParam,
});

/** Cobrança via mensagem: envia (ou prepara envio manual) e registra a tentativa no caso da nota. */
const chargeSchema = sendMessageSchema.extend({
  invoiceId: z.string().uuid(),
  resultingStatus: z.enum(COLLECTION_STATUSES).default('SENT'),
  nextActionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  nextActionNote: z.string().max(1000).optional().nullable(),
});

@Controller('financeiro/collections')
export class CollectionsController {
  constructor(
    private readonly collections: CollectionsService,
    private readonly messaging: MessagingService,
  ) {}

  @Get()
  @RequirePermissions('collections.read')
  list(@Query(zod(listSchema)) q: z.infer<typeof listSchema>) {
    return this.collections.list(q);
  }

  @Get('invoice/:invoiceId')
  @RequirePermissions('collections.read')
  byInvoice(@Param('invoiceId') invoiceId: string) {
    return this.collections.ensureCase(invoiceId);
  }

  @Post('invoice/:invoiceId/attempts')
  @RequirePermissions('collections.manage')
  register(@Ctx() ctx: RequestContext, @Param('invoiceId') invoiceId: string, @Body(zod(registerCollectionAttemptSchema)) body: z.infer<typeof registerCollectionAttemptSchema>) {
    return this.collections.registerAttempt(ctx, invoiceId, body);
  }

  @Post('charge')
  @RequirePermissions('collections.manage')
  async charge(@Ctx() ctx: RequestContext, @Body(zod(chargeSchema)) body: z.infer<typeof chargeSchema>) {
    const { resultingStatus, nextActionAt, nextActionNote, ...msg } = body;
    const result = await this.messaging.send(ctx, { ...msg, invoiceId: body.invoiceId });
    const status = result.sent ? resultingStatus : result.message.status === 'MANUAL_PENDING' ? 'SCHEDULED' : resultingStatus;
    const c = await this.collections.registerAttempt(
      ctx,
      body.invoiceId,
      { channel: body.channel, contactId: body.contactId, message: body.body, resultingStatus: status, nextActionAt: nextActionAt ?? null, nextActionNote: nextActionNote ?? null },
      result.message.id,
    );
    return { ...result, case: c };
  }

  @Post('invoice/:invoiceId/assign')
  @RequirePermissions('collections.manage')
  assign(@Ctx() ctx: RequestContext, @Param('invoiceId') invoiceId: string, @Body(zod(z.object({ assigneeUserId: z.string().uuid().nullable() }))) body: { assigneeUserId: string | null }) {
    return this.collections.assign(ctx, invoiceId, body.assigneeUserId);
  }
}
