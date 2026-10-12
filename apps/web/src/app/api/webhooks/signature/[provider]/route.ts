import { NextResponse, type NextRequest } from 'next/server';
import { handleSignatureWebhook } from '@/server/services/inbound';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/webhooks/signature/clicksign — eventos do provedor de assinatura (validação HMAC quando configurada). */
export async function POST(req: NextRequest, rp: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider } = await rp.params;
  const raw = await req.text();
  const r = await handleSignatureWebhook(provider, Object.fromEntries(req.headers.entries()), raw);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
