import { platformRoute } from '@/server/platform-auth';
import { overview } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = platformRoute(async () => overview());
