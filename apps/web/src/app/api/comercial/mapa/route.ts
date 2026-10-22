/** GET /api/comercial/mapa — Mapa de cobertura: situação por município (MA, PI, TO), entidades, módulos e totais por estado. */
import { route } from '@/server/http';
import { getMap } from '@/server/services/coverage';

export const dynamic = 'force-dynamic';
export const GET = route(['crm.read'], async () => getMap());
