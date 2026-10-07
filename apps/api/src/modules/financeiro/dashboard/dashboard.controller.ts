import { Controller, Get, Query } from '@nestjs/common';
import { dashboardFilterSchema, type DashboardFilter } from '@siow/shared';
import { RequirePermissions } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { DashboardService } from './dashboard.service.js';

@Controller('financeiro/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions('dashboard.read')
  get(@Query(zod(dashboardFilterSchema)) f: DashboardFilter) {
    return this.dashboard.build(f);
  }

  @Get('filter-options')
  @RequirePermissions('dashboard.read')
  options() {
    return this.dashboard.filterOptions();
  }
}
