import { route } from '@/server/http';
import { summary } from '@/server/services/commissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(['partners.read'], async () => summary());
