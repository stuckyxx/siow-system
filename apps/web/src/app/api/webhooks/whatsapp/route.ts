import { NextResponse, type NextRequest } from 'next/server';
import { handleWhatsAppWebhook, verifyWhatsAppWebhook } from '@/server/services/inbound';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook da Meta (WhatsApp Cloud API). GET = verificação (hub.verify_token da integração);
 * POST = mensagens recebidas e status de entrega. Sem autenticação de usuário: validação por token/assinatura.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const q = req.nextUrl.searchParams;
  const r = await verifyWhatsAppWebhook(q.get('hub.mode'), q.get('hub.verify_token'), q.get('hub.challenge'));
  return r.ok ? new Response(r.challenge, { status: 200 }) : NextResponse.json({ statusCode: 403, message: 'Token inválido' }, { status: 403 });
}
export async function POST(req: NextRequest): Promise<Response> {
  const raw = await req.text();
  const r = await handleWhatsAppWebhook(raw, req.headers.get('x-hub-signature-256'));
  return NextResponse.json(r, { status: r.ok ? 200 : 401 });
}
