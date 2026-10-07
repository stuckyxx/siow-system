import { z } from 'zod';
import { badRequest, route } from '@/server/http';
import { addDocument } from '@/server/services/contracts';
import { list } from '@/server/services/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const metaSchema = z.object({
  type: z.enum(['CONTRACT', 'AMENDMENT_REQUEST', 'OTHER']).optional(),
  name: z.string().max(200).optional(),
});

/** GET /api/financeiro/contracts/[id]/documents */
export const GET = route(['contracts.read'], async (ctx) => list({ contractId: ctx.params['id']! }));

/** POST /api/financeiro/contracts/[id]/documents — multipart: campo "file" (PDF) + type/name opcionais. */
export const POST = route(['contracts.write'], async (ctx) => {
  let form: FormData;
  try { form = await ctx.req.formData(); } catch { throw badRequest('Envie multipart/form-data com o campo "file"'); }
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('Arquivo ausente (campo "file")');
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k !== 'file' && typeof v === 'string' && v !== '') fields[k] = v;
  return addDocument(ctx, ctx.params['id']!, file, metaSchema.parse(fields));
});
