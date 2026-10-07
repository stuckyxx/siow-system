import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { SERVICE_ORDER_STATUSES, createServiceOrderSchema, registerManualSignatureSchema, updateServiceOrderSchema } from '@siow/shared';
import { Ctx, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { ServiceOrdersService } from './service-orders.service.js';

const listSchema = z.object({
  entityId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  status: z.enum(SERVICE_ORDER_STATUSES).optional(),
  year: z.coerce.number().int().optional(),
});

@Controller('financeiro/service-orders')
export class ServiceOrdersController {
  constructor(private readonly orders: ServiceOrdersService) {}

  @Get()
  @RequirePermissions('service_orders.read')
  list(@Query(zod(listSchema)) q: z.infer<typeof listSchema>) {
    return this.orders.list(q);
  }

  @Get('signature-capabilities')
  @RequirePermissions('service_orders.read')
  capabilities() {
    return this.orders.signatureCapabilities();
  }

  @Get(':id')
  @RequirePermissions('service_orders.read')
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Post()
  @RequirePermissions('service_orders.manage')
  create(@Ctx() ctx: RequestContext, @Body(zod(createServiceOrderSchema)) body: z.infer<typeof createServiceOrderSchema>) {
    return this.orders.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermissions('service_orders.manage')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(updateServiceOrderSchema)) body: z.infer<typeof updateServiceOrderSchema>) {
    return this.orders.update(ctx, id, body);
  }

  @Post(':id/document')
  @RequirePermissions('service_orders.manage')
  attach(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(z.object({ documentId: z.string().uuid() }))) body: { documentId: string }) {
    return this.orders.attachDocument(ctx, id, body.documentId);
  }

  @Post(':id/signature/manual')
  @RequirePermissions('service_orders.manage')
  signManual(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(registerManualSignatureSchema)) body: z.infer<typeof registerManualSignatureSchema>) {
    return this.orders.registerManualSignature(ctx, id, body);
  }
}
