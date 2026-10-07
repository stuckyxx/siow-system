import { registerCertificateVersionSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { registerVersion } from '@/server/services/certificates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/certificates/[id]/versions — nova versão (documento já enviado via /api/documents). */
export const POST = route(['certificates.manage'], async (ctx) => registerVersion(ctx, ctx.params['id']!, await json(ctx.req, registerCertificateVersionSchema)));
