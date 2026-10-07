import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { createManualInvoiceSchema, invoiceListFilterSchema, invoiceOverrideSchema, reconcileInvoiceSchema, resolveConflictSchema } from '@siow/shared';
import { Ctx, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { InvoicesService } from './invoices.service.js';

@Controller('financeiro/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions('invoices.read')
  list(@Query(zod(invoiceListFilterSchema)) q: z.infer<typeof invoiceListFilterSchema>) {
    return this.invoices.list(q);
  }

  @Get(':id')
  @RequirePermissions('invoices.read')
  get(@Param('id') id: string) {
    return this.invoices.get(id);
  }

  @Post()
  @RequirePermissions('invoices.override')
  createManual(@Ctx() ctx: RequestContext, @Body(zod(createManualInvoiceSchema)) body: z.infer<typeof createManualInvoiceSchema>) {
    return this.invoices.createManual(ctx, body);
  }

  @Patch(':id/override')
  @RequirePermissions('invoices.override')
  override(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(invoiceOverrideSchema)) body: z.infer<typeof invoiceOverrideSchema>) {
    return this.invoices.override(ctx, id, body);
  }

  @Post(':id/reconcile')
  @RequirePermissions('invoices.reconcile')
  reconcile(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(reconcileInvoiceSchema)) body: z.infer<typeof reconcileInvoiceSchema>) {
    return this.invoices.reconcile(ctx, id, body);
  }

  @Post(':id/conflicts/:conflictId/resolve')
  @RequirePermissions('invoices.reconcile')
  resolveConflict(@Ctx() ctx: RequestContext, @Param('id') id: string, @Param('conflictId') conflictId: string, @Body(zod(resolveConflictSchema)) body: z.infer<typeof resolveConflictSchema>) {
    return this.invoices.resolveConflict(ctx, id, conflictId, body);
  }

  @Post(':id/capture-document')
  @RequirePermissions('documents.write')
  capture(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.invoices.requestDocumentCapture(ctx, id);
  }

  @Delete(':id')
  @RequirePermissions('invoices.override')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(z.object({ justification: z.string().min(10) }))) body: { justification: string }) {
    await this.invoices.softDelete(ctx, id, body.justification);
    return { ok: true };
  }
}
