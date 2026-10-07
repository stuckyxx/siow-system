import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { DOCUMENT_TYPES, documentUploadMetaSchema } from '@siow/shared';
import { Ctx, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { DocumentsService, type UploadMeta } from './documents.service.js';

const listSchema = z.object({
  entityId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  serviceOrderId: z.string().uuid().optional(),
  type: z.enum(DOCUMENT_TYPES).optional(),
});

@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get()
  @RequirePermissions('documents.read')
  list(@Query(zod(listSchema)) q: z.infer<typeof listSchema>) {
    return this.docs.list(q);
  }

  @Get(':id')
  @RequirePermissions('documents.read')
  get(@Param('id') id: string) {
    return this.docs.get(id);
  }

  @Get(':id/download-url')
  @RequirePermissions('documents.read')
  downloadUrl(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.docs.downloadUrl(ctx, id);
  }

  @Post()
  @RequirePermissions('documents.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  upload(@Ctx() ctx: RequestContext, @UploadedFile() file: Express.Multer.File, @Body(zod(documentUploadMetaSchema)) meta: UploadMeta) {
    return this.docs.upload(ctx, file, meta);
  }

  @Delete(':id')
  @RequirePermissions('documents.write')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.docs.softDelete(ctx, id);
    return { ok: true };
  }
}
