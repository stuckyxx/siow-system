import { signupSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { selfSignup } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/public/signup — autocadastro (habilitado pela plataforma). Cria organização em teste gratuito. */
export const POST = route(null, async (ctx) => selfSignup(await json(ctx.req, signupSchema)));
