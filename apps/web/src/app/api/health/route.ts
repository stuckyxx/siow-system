import { NextResponse } from 'next/server';
import { health } from '@/server/services/system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/health — público; verifica somente o banco (SELECT 1). */
export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(await health());
  } catch (e) {
    console.error('health check failed', e);
    return NextResponse.json({ ok: false, time: new Date().toISOString(), db: 'error' }, { status: 503 });
  }
}
