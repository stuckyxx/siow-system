import { createContactSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { addContact, listContacts } from '@/server/services/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/entities/[id]/contacts — dados pessoais: permissão própria. */
export const GET = route(['contacts.read'], async (ctx) => listContacts(ctx.params['id']!));

/** POST /api/financeiro/entities/[id]/contacts */
export const POST = route(['contacts.write'], async (ctx) => addContact(ctx, ctx.params['id']!, await json(ctx.req, createContactSchema)));
