import { z } from 'zod';
import { json, route } from '@/server/http';
import { setSetting } from '@/server/services/system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ value: z.unknown() });

/** PUT /api/settings/[key] — { value } (JSON livre). */
export const PUT = route(['settings.manage'], async (ctx) => {
  const body = await json(ctx.req, bodySchema);
  return setSetting(ctx, decodeURIComponent(ctx.params['key']!), body.value);
});
