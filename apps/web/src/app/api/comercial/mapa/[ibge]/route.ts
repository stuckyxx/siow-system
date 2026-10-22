/** PUT /api/comercial/mapa/[ibge] — muda a situação comercial manual do município (implantação, negociação, sem atuação). */
import { json, route } from '@/server/http';
import { setCoverageStatusSchema, setStatus } from '@/server/services/coverage';

export const dynamic = 'force-dynamic';
export const PUT = route(['crm.write'], async (ctx) => setStatus(ctx, ctx.params['ibge']!, await json(ctx.req, setCoverageStatusSchema)));
