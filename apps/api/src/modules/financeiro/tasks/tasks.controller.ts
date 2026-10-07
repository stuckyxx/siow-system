import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { createTaskSchema, isoDate, taskListFilterSchema, updateTaskSchema } from '@siow/shared';
import { Ctx, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { TasksService } from './tasks.service.js';

const calendarSchema = z.object({ from: isoDate, to: isoDate, assigneeUserId: z.string().uuid().optional(), entityId: z.string().uuid().optional() });

@Controller('financeiro/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermissions('tasks.read')
  list(@Query(zod(taskListFilterSchema)) q: z.infer<typeof taskListFilterSchema>) {
    return this.tasks.list(q);
  }

  @Get('calendar')
  @RequirePermissions('tasks.read')
  calendar(@Query(zod(calendarSchema)) q: z.infer<typeof calendarSchema>) {
    return this.tasks.calendar(q.from, q.to, q.assigneeUserId, q.entityId);
  }

  @Get(':id')
  @RequirePermissions('tasks.read')
  get(@Param('id') id: string) {
    return this.tasks.get(id);
  }

  @Post()
  @RequirePermissions('tasks.manage')
  create(@Ctx() ctx: RequestContext, @Body(zod(createTaskSchema)) body: z.infer<typeof createTaskSchema>) {
    return this.tasks.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermissions('tasks.manage')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(updateTaskSchema)) body: z.infer<typeof updateTaskSchema>) {
    return this.tasks.update(ctx, id, body);
  }

  @Post(':id/comments')
  @RequirePermissions('tasks.manage')
  comment(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(z.object({ note: z.string().min(1).max(2000) }))) body: { note: string }) {
    return this.tasks.comment(ctx, id, body.note);
  }

  @Delete(':id')
  @RequirePermissions('tasks.manage')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.tasks.softDelete(ctx, id);
    return { ok: true };
  }
}
