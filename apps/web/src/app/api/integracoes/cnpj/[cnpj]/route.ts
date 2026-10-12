import { route } from '@/server/http';
import { lookupCnpj } from '@/server/services/lookups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/integracoes/cnpj/[cnpj] — dados cadastrais públicos (nome, município, UF, IBGE). */
export const GET = route(['entities.read'], async (ctx) => lookupCnpj(ctx.params['cnpj']!));
