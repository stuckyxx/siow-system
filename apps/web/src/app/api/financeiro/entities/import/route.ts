import { badRequest, route } from '@/server/http';
import { importBatch } from '@/server/services/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/entities/import — multipart: campo "file" (CSV ou XLSX, até 5 MB). */
export const POST = route(['entities.write'], async (ctx) => {
  let form: FormData;
  try { form = await ctx.req.formData(); } catch { throw badRequest('Envie multipart/form-data com o campo "file"'); }
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('Arquivo ausente (campo "file")');
  const buffer = Buffer.from(await file.arrayBuffer());
  return importBatch(ctx, { buffer, mimetype: file.type || 'application/octet-stream', originalname: file.name });
});
