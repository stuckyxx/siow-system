import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { createUserSchema, updateUserSchema } from '@siow/shared';
import { Ctx, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Qualquer usuário autenticado pode listar responsáveis (nome/id) para atribuir tarefas. */
  @Get('assignees')
  assignees() {
    return this.users.assignees();
  }

  @Get()
  @RequirePermissions('users.manage')
  list() {
    return this.users.list();
  }

  @Get('roles')
  @RequirePermissions('users.manage')
  roles() {
    return this.users.roles();
  }

  @Get('permissions')
  @RequirePermissions('users.manage')
  permissions() {
    return this.users.permissions();
  }

  @Post()
  @RequirePermissions('users.manage')
  create(@Ctx() ctx: RequestContext, @Body(zod(createUserSchema)) body: z.infer<typeof createUserSchema>) {
    return this.users.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermissions('users.manage')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(updateUserSchema)) body: z.infer<typeof updateUserSchema>) {
    return this.users.update(ctx, id, body);
  }

  @Put('roles/:roleId/permissions')
  @RequirePermissions('users.manage')
  async setRolePermissions(@Ctx() ctx: RequestContext, @Param('roleId') roleId: string, @Body(zod(z.object({ permissions: z.array(z.string()) }))) body: { permissions: string[] }) {
    await this.users.updateRolePermissions(ctx, roleId, body.permissions);
    return { ok: true };
  }
}
