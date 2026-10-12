import { badRequest, route } from '@/server/http';
import { list } from '@/server/services/documents';
import { addDocument } from '@/server/services/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — anexos do chamado. POST — multipart "file" (+ name). */
export const GET = route(['tickets.read'], async (ctx) => list({ ticketId: ctx.params['id']! }));
export const POST = route(['tickets.write'], async (ctx) => {
  let form: FormData;
  try { form = await ctx.req.formData(); } catch { throw badRequest('Envie multipart/form-data com o campo "file"'); }
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('Arquivo ausente (campo "file")');
  const name = form.get('name');
  return addDocument(ctx, ctx.params['id']!, file, typeof name === 'string' && name ? name : undefined);
});
