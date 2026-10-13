import { platformRoute } from '@/server/platform-auth';
import { listInvoices } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = platformRoute(async (ctx) => listInvoices({ status: ctx.query['status'] || undefined }));
