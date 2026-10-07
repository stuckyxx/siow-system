import { route } from '@/server/http';
import { signatureCapabilities } from '@/server/services/service-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/service-orders/signature-capabilities — provedor de assinatura eletrônica configurado? */
export const GET = route(['service_orders.read'], async () => signatureCapabilities());
