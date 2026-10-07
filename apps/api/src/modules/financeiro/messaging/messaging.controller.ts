import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import { prepareMessageSchema, sendMessageSchema, upsertTemplateSchema } from '@siow/shared';
import { Ctx, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { MessagingService } from './messaging.service.js';

@Controller('financeiro/messages')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('templates')
  @RequirePermissions('collections.read')
  templates() {
    return this.messaging.listTemplates();
  }

  @Put('templates')
  @RequirePermissions('templates.manage')
  upsertTemplate(@Ctx() ctx: RequestContext, @Body(zod(upsertTemplateSchema)) body: z.infer<typeof upsertTemplateSchema>) {
    return this.messaging.upsertTemplate(ctx, body);
  }

  @Post('prepare')
  @RequirePermissions('collections.manage')
  prepare(@Body(zod(prepareMessageSchema)) body: z.infer<typeof prepareMessageSchema>) {
    return this.messaging.prepare(body);
  }

  @Post('send')
  @RequirePermissions('collections.manage')
  send(@Ctx() ctx: RequestContext, @Body(zod(sendMessageSchema)) body: z.infer<typeof sendMessageSchema>) {
    return this.messaging.send(ctx, body);
  }

  @Post(':id/confirm-manual')
  @RequirePermissions('collections.manage')
  confirm(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.messaging.confirmManual(ctx, id);
  }

  @Get()
  @RequirePermissions('collections.read')
  list(@Query('entityId') entityId: string) {
    return this.messaging.listByEntity(entityId);
  }
}
