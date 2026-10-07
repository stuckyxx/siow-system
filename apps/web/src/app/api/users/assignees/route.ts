import { route } from '@/server/http';
import { assignees } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/users/assignees — qualquer usuário autenticado (seletor de responsável). */
export const GET = route([], async () => assignees());
