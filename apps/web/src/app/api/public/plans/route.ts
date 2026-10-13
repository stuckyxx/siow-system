import { route } from '@/server/http';
import { platformSetting, publicPlans } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(null, async () => ({ selfSignup: await platformSetting('platform.selfSignup', false), plans: await publicPlans() }));
