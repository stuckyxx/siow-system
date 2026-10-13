import { subscriptionInvoicePaySchema } from '@siow/shared';
import { platformJson, platformRoute } from '@/server/platform-auth';
import { payInvoice } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = platformRoute(async (ctx) => payInvoice(ctx, ctx.params['id']!, await platformJson(ctx.req, subscriptionInvoicePaySchema)));
