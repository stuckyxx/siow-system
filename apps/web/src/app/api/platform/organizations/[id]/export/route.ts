import { NextResponse } from 'next/server';
import { platformRoute } from '@/server/platform-auth';
import { exportOrganization } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET — exportação completa (LGPD / portabilidade) em JSON. */
export const GET = platformRoute(async (ctx) => { const data = await exportOrganization(ctx.params['id']!); return new NextResponse(JSON.stringify(data, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="siow-export-${data.organization.slug}-${data.exportedAt.slice(0, 10)}.json"` } }); });
