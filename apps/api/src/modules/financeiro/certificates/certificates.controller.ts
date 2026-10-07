import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CERTIFICATE_STATUSES, registerCertificateVersionSchema } from '@siow/shared';
import { Ctx, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { CertificatesService } from './certificates.service.js';

const listSchema = z.object({ entityId: z.string().uuid().optional(), status: z.enum(CERTIFICATE_STATUSES).optional() });
const createSchema = z.object({ name: z.string().min(3).max(200), entityId: z.string().uuid().optional().nullable(), notes: z.string().max(2000).optional().nullable() });

@Controller('financeiro/certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  @RequirePermissions('certificates.read')
  list(@Query(zod(listSchema)) q: z.infer<typeof listSchema>) {
    return this.certificates.list(q.entityId, q.status);
  }

  @Get(':id')
  @RequirePermissions('certificates.read')
  get(@Param('id') id: string) {
    return this.certificates.get(id);
  }

  @Post()
  @RequirePermissions('certificates.manage')
  create(@Ctx() ctx: RequestContext, @Body(zod(createSchema)) body: z.infer<typeof createSchema>) {
    return this.certificates.create(ctx, body);
  }

  @Post(':id/versions')
  @RequirePermissions('certificates.manage')
  registerVersion(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(zod(registerCertificateVersionSchema)) body: z.infer<typeof registerCertificateVersionSchema>) {
    return this.certificates.registerVersion(ctx, id, body);
  }
}
