import { z } from 'zod';
import { json, route } from '@/server/http';
import { setUserPermissions } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ grant: z.array(z.string()).default([]), revoke: z.array(z.string()).default([]) });

/** PUT /api/users/[id]/permissions — ajustes individuais { grant: codes[], revoke: codes[] } (substitui os anteriores). */
export const PUT = route(['users.manage'], async (ctx) => setUserPermissions(ctx, ctx.params['id']!, await json(ctx.req, bodySchema)));
