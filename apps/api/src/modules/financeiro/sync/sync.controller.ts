import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { syncRunListFilterSchema } from '@siow/shared';
import { Ctx, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { SyncService } from './sync.service.js';

@Controller('financeiro/sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('overview')
  @RequirePermissions('sync.read')
  overview() {
    return this.sync.overview();
  }

  @Get('runs')
  @RequirePermissions('sync.read')
  runs(@Query(zod(syncRunListFilterSchema)) q: z.infer<typeof syncRunListFilterSchema>) {
    return this.sync.listRuns(q);
  }

  @Get('runs/:id')
  @RequirePermissions('sync.read')
  run(@Param('id') id: string) {
    return this.sync.getRun(id);
  }

  @Post('entities/:entityId')
  @RequirePermissions('sync.run')
  syncEntity(@Ctx() ctx: RequestContext, @Param('entityId') entityId: string) {
    return this.sync.syncEntityNow(ctx, entityId);
  }

  @Post('all')
  @RequirePermissions('sync.run', 'integrations.manage')
  syncAll(@Ctx() ctx: RequestContext) {
    return this.sync.syncAllNow(ctx);
  }
}
