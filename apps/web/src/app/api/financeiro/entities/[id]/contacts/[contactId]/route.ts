import { updateContactSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { removeContact, updateContact } from '@/server/services/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/financeiro/entities/[id]/contacts/[contactId] */
export const PATCH = route(['contacts.write'], async (ctx) => updateContact(ctx, ctx.params['id']!, ctx.params['contactId']!, await json(ctx.req, updateContactSchema)));

/** DELETE /api/financeiro/entities/[id]/contacts/[contactId] — exclusão lógica. */
export const DELETE = route(['contacts.write'], async (ctx) => {
  await removeContact(ctx, ctx.params['id']!, ctx.params['contactId']!);
  return { ok: true };
});
