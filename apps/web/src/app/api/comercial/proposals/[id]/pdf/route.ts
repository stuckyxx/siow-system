import { route } from '@/server/http';
import { pdf } from '@/server/services/crm/proposals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/comercial/proposals/:id/pdf — PDF da proposta (gerado sob demanda). */
export const GET = route(['crm.read'], async (ctx) => {
  const { buffer, fileName } = await pdf(ctx.params['id']!);
  return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'no-store' } });
});
