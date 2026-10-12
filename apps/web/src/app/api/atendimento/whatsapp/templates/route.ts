import { route } from '@/server/http';
import { templates } from '@/server/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
/** GET — modelos aprovados na Meta (cache 5 min; ?force=1 recarrega). */
export const GET = route(['tickets.read'], async (ctx) => templates(ctx.query['force'] === '1'));
