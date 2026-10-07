import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { z } from 'zod';
import {
  createContactSchema,
  createDataSourceSchema,
  createEntitySchema,
  entityListFilterSchema,
  updateContactSchema,
  updateDataSourceSchema,
  updateEntitySchema,
} from '@siow/shared';
import { Ctx, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { EntitiesService } from './entities.service.js';

@Controller('financeiro/entities')
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get()
  @RequirePermissions('entities.read')
  list(@Query(zod(entityListFilterSchema)) q: z.infer<typeof entityListFilterSchema>) {
    return this.entities.list(q);
  }

  @Get(':id')
  @RequirePermissions('entities.read')
  get(@Param('id') id: string) {
    return this.entities.get(id);
  }

  @Post()
  @RequirePermissions('entities.write')
  create(@Ctx() ctx: RequestContext, @Body(zod(createEntitySchema)) body: z.infer<typeof createEntitySchema>) {
    return this.entities.create(ctx, body);
  }

  @Post('import')
  @RequirePermissions('entities.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  import(@Ctx() ctx: RequestContext, @UploadedFile() file: Express.Multer.File) {
    return this.entities.importBatch(ctx, file);
  }

  @Patch(':id')
  @RequirePermissions('entities.write')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(updateEntitySchema)) body: z.infer<typeof updateEntitySchema>) {
    return this.entities.update(ctx, id, body);
  }

  @Delete(':id')
  @RequirePermissions('entities.write')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.entities.softDelete(ctx, id);
    return { ok: true };
  }

  // ---- fontes de dados ----
  @Post(':id/data-sources')
  @RequirePermissions('entities.write')
  addDataSource(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(createDataSourceSchema)) body: z.infer<typeof createDataSourceSchema>) {
    return this.entities.addDataSource(ctx, id, body);
  }

  @Patch(':id/data-sources/:dsId')
  @RequirePermissions('entities.write')
  updateDataSource(@Ctx() ctx: RequestContext, @Param('id') id: string, @Param('dsId') dsId: string, @Body(zod(updateDataSourceSchema)) body: z.infer<typeof updateDataSourceSchema>) {
    return this.entities.updateDataSource(ctx, id, dsId, body);
  }

  @Delete(':id/data-sources/:dsId')
  @RequirePermissions('entities.write')
  async removeDataSource(@Ctx() ctx: RequestContext, @Param('id') id: string, @Param('dsId') dsId: string) {
    await this.entities.removeDataSource(ctx, id, dsId);
    return { ok: true };
  }

  // ---- contatos (dados pessoais: permissão própria) ----
  @Get(':id/contacts')
  @RequirePermissions('contacts.read')
  contacts(@Param('id') id: string) {
    return this.entities.listContacts(id);
  }

  @Post(':id/contacts')
  @RequirePermissions('contacts.write')
  addContact(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(createContactSchema)) body: z.infer<typeof createContactSchema>) {
    return this.entities.addContact(ctx, id, body);
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermissions('contacts.write')
  updateContact(@Ctx() ctx: RequestContext, @Param('id') id: string, @Param('contactId') contactId: string, @Body(zod(updateContactSchema)) body: z.infer<typeof updateContactSchema>) {
    return this.entities.updateContact(ctx, id, contactId, body);
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermissions('contacts.write')
  async removeContact(@Ctx() ctx: RequestContext, @Param('id') id: string, @Param('contactId') contactId: string) {
    await this.entities.removeContact(ctx, id, contactId);
    return { ok: true };
  }
}
