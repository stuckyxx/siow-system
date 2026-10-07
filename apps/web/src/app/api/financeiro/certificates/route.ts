import { z } from 'zod';
import { CERTIFICATE_STATUSES } from '@siow/shared';
import { json, parseQuery, route } from '@/server/http';
import { create, list } from '@/server/services/certificates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const listSchema = z.object({ entityId: z.string().uuid().optional(), status: z.enum(CERTIFICATE_STATUSES).optional() });
const createSchema = z.object({ name: z.string().min(3).max(200), entityId: z.string().uuid().optional().nullable(), notes: z.string().max(2000).optional().nullable() });

/** GET /api/financeiro/certificates — certidões da empresa + da entidade (CertificateView[]). */
export const GET = route(['certificates.read'], async (ctx) => {
  const q = parseQuery(ctx.query, listSchema);
  return list(q.entityId, q.status);
});

/** POST /api/financeiro/certificates — nova certidão (cadastro manual). */
export const POST = route(['certificates.manage'], async (ctx) => create(ctx, await json(ctx.req, createSchema)));
