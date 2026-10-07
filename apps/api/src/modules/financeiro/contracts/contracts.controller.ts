import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CONTRACT_STATUSES, createAmendmentSchema, createContractSchema, updateContractSchema } from '@siow/shared';
import { Ctx, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { ContractsService } from './contracts.service.js';
import { LedgerService } from './ledger.service.js';

const listSchema = z.object({
  entityId: z.string().uuid().optional(),
  status: z.enum(CONTRACT_STATUSES).optional(),
  expiringDays: z.coerce.number().int().min(1).max(3650).optional(),
  q: z.string().max(100).optional(),
});

@Controller('financeiro/contracts')
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly ledger: LedgerService,
  ) {}

  @Get()
  @RequirePermissions('contracts.read')
  list(@Query(zod(listSchema)) q: z.infer<typeof listSchema>) {
    return this.contracts.list(q);
  }

  @Get(':id')
  @RequirePermissions('contracts.read')
  get(@Param('id') id: string) {
    return this.contracts.get(id);
  }

  /** Conta corrente do contrato. */
  @Get(':id/ledger')
  @RequirePermissions('contracts.read')
  ledgerOf(@Param('id') id: string) {
    return this.ledger.build(id);
  }

  @Post()
  @RequirePermissions('contracts.write')
  create(@Ctx() ctx: RequestContext, @Body(zod(createContractSchema)) body: z.infer<typeof createContractSchema>) {
    return this.contracts.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermissions('contracts.write')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(updateContractSchema)) body: z.infer<typeof updateContractSchema>) {
    return this.contracts.update(ctx, id, body);
  }

  @Delete(':id')
  @RequirePermissions('contracts.write')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.contracts.softDelete(ctx, id);
    return { ok: true };
  }

  @Post(':id/amendments')
  @RequirePermissions('contracts.write')
  addAmendment(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(createAmendmentSchema)) body: z.infer<typeof createAmendmentSchema>) {
    return this.contracts.addAmendment(ctx, id, body);
  }

  @Delete(':id/amendments/:amendmentId')
  @RequirePermissions('contracts.write')
  async removeAmendment(@Ctx() ctx: RequestContext, @Param('id') id: string, @Param('amendmentId') amendmentId: string) {
    await this.contracts.removeAmendment(ctx, id, amendmentId);
    return { ok: true };
  }
}
