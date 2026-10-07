import { z } from 'zod';
import { badRequest, json, route } from '@/server/http';
import { updateRolePermissions } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ permissions: z.array(z.string()).optional(), codes: z.array(z.string()).optional() });

/** PUT /api/users/roles/[roleId]/permissions — body { permissions: string[] } (ou { codes }). */
export const PUT = route(['users.manage'], async (ctx) => {
  const body = await json(ctx.req, bodySchema);
  const codes = body.permissions ?? body.codes;
  if (!codes) throw badRequest('Informe "permissions" (lista de códigos)');
  await updateRolePermissions(ctx, ctx.params['roleId']!, codes);
  return { ok: true };
});
