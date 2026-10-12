import { route } from '@/server/http';
import { stats } from '@/server/services/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/atendimento/tickets/stats — painel: abertos, em atendimento, aguardando, SLA, resolvidos 30d, tempos médios, satisfação. */
export const GET = route(['tickets.read'], async (ctx) => stats(ctx.user.id));
