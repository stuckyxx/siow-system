import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '@siow/db';
import { paginationSchema } from '@siow/shared';
import { AuditService } from '../../../common/audit/audit.service.js';
import { Ctx, CurrentUser, Public, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import type { CurrentUser as CurrentUserType } from '@siow/shared';

const auditFilter = paginationSchema.extend({
  userId: z.string().uuid().optional(),
  resource: z.string().optional(),
  resourceId: z.string().optional(),
  action: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const settingSchema = z.object({ value: z.unknown() });

@Controller()
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, time: new Date().toISOString() };
  }

  // ---------------- auditoria (somente leitura) ----------------
  @Get('audit')
  @RequirePermissions('audit.read')
  async auditList(@Query(zod(auditFilter)) q: z.infer<typeof auditFilter>) {
    const where: Prisma.AuditLogWhereInput = {
      userId: q.userId,
      resource: q.resource,
      resourceId: q.resourceId,
      action: q.action,
      createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  // ---------------- notificações ----------------
  @Get('notifications')
  async notifications(@CurrentUser() user: CurrentUserType, @Query('unread') unread?: string) {
    return this.prisma.notification.findMany({
      where: { OR: [{ userId: user.id }, { userId: null }], ...(unread === 'true' ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Patch('notifications/:id/read')
  async markRead(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    await this.prisma.notification.updateMany({ where: { id, OR: [{ userId: user.id }, { userId: null }] }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post('notifications/read-all')
  async markAllRead(@CurrentUser() user: CurrentUserType) {
    await this.prisma.notification.updateMany({ where: { readAt: null, OR: [{ userId: user.id }, { userId: null }] }, data: { readAt: new Date() } });
    return { ok: true };
  }

  // ---------------- configurações ----------------
  @Get('settings')
  @RequirePermissions('settings.manage')
  settings() {
    return this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
  }

  @Put('settings/:key')
  @RequirePermissions('settings.manage')
  async setSetting(@Ctx() ctx: RequestContext, @Param('key') key: string, @Body(zod(settingSchema)) body: { value: unknown }) {
    const before = await this.prisma.setting.findUnique({ where: { key } });
    const after = await this.prisma.setting.upsert({
      where: { key },
      update: { value: body.value as Prisma.InputJsonValue, updatedByUserId: ctx.user.id },
      create: { key, value: body.value as Prisma.InputJsonValue, updatedByUserId: ctx.user.id },
    });
    await this.audit.log(ctx, { action: 'SETTING_CHANGED', resource: 'setting', resourceId: key, before: before?.value, after: after.value });
    return after;
  }
}
