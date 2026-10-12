import { badRequest, route } from '@/server/http';
import { importSheet } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST — multipart "file" (CSV/XLSX) com colunas entidade, modalidade, numero, objeto, valor_estimado, proposta, sessao, url, id_oficial. */
export const POST = route(['tenders.write'], async (ctx) => {
  let form: FormData;
  try { form = await ctx.req.formData(); } catch { throw badRequest('Envie multipart/form-data com o campo "file"'); }
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('Arquivo ausente (campo "file")');
  return importSheet(ctx, { buffer: Buffer.from(await file.arrayBuffer()), mimetype: file.type, originalname: file.name });
});
