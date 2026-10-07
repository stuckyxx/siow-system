import { z } from 'zod';
import { json, route } from '@/server/http';
import { updateRolePermissions } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ codes: z.array(z.string()) });

/** PUT /api/roles/[name]/permissions — { codes: string[] }. ADMINISTRADOR mantém users.manage. */
export const PUT = route(['users.manage'], async (ctx) => {
  const body = await json(ctx.req, bodySchema);
  await updateRolePermissions(ctx, decodeURIComponent(ctx.params['name']!), body.codes);
  return { ok: true };
});
