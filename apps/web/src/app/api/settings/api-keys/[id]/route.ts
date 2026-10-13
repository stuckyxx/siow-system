import { route } from '@/server/http';
import { revoke } from '@/server/services/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = route(['settings.manage'], async (ctx) => { await revoke(ctx, ctx.params['id']!); });
