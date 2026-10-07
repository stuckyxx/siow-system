import { z } from 'zod';
import { DOCUMENT_TYPES, documentUploadMetaSchema } from '@siow/shared';
import { badRequest, parseQuery, route } from '@/server/http';
import { list, upload } from '@/server/services/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const listSchema = z.object({
  entityId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  serviceOrderId: z.string().uuid().optional(),
  type: z.enum(DOCUMENT_TYPES).optional(),
});

/** GET /api/documents?entityId=&contractId=&invoiceId=&serviceOrderId=&type= */
export const GET = route(['documents.read'], async (ctx) => list(parseQuery(ctx.query, listSchema)));

/** POST /api/documents — multipart: campo "file" + metadados (type, entityId, …). */
export const POST = route(['documents.write'], async (ctx) => {
  let form: FormData;
  try { form = await ctx.req.formData(); } catch { throw badRequest('Envie multipart/form-data com o campo "file"'); }
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('Arquivo ausente (campo "file")');
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k !== 'file' && typeof v === 'string' && v !== '') fields[k] = v;
  const meta = documentUploadMetaSchema.parse(fields);
  return upload(ctx, file, meta);
});
