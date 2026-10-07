import { route } from '@/server/http';
import { downloadUrl } from '@/server/services/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/documents/[id]/download-url → { url, name, mimeType, size } */
export const GET = route(['documents.read'], async (ctx) => downloadUrl(ctx, ctx.params['id']!));
