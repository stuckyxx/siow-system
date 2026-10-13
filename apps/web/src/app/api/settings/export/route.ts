import { NextResponse } from 'next/server';
import { route } from '@/server/http';
import { audit } from '@/server/audit';
import { runAsPlatform } from '@/server/tenant';
import { exportOrganization } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET — exportação completa dos dados da própria organização (LGPD / portabilidade), JSON. */
export const GET = route(['settings.manage', 'audit.read'], async (ctx) => {
  const data = await runAsPlatform(() => exportOrganization(ctx.user.organizationId));
  await audit(ctx, { action: 'EXPORT', resource: 'organization', resourceId: ctx.user.organizationId, after: { format: data.format } });
  return new NextResponse(JSON.stringify(data, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="siow-export-${data.organization.slug}-${data.exportedAt.slice(0, 10)}.json"` } });
});
