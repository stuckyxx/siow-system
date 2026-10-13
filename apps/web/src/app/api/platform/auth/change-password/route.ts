import { platformChangePasswordSchema } from '@siow/shared';
import { isStrongPassword, hashPassword, verifyPassword } from '@/server/password';
import { prismaPlatform } from '@/server/db';
import { badRequest, unauthorized } from '@/server/http';
import { platformJson, platformRoute } from '@/server/platform-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = platformRoute(async (ctx) => {
  const b = await platformJson(ctx.req, platformChangePasswordSchema);
  const admin = await prismaPlatform.platformAdmin.findUniqueOrThrow({ where: { id: ctx.admin.id } });
  if (!(await verifyPassword(admin.passwordHash, b.currentPassword))) throw unauthorized('Senha atual incorreta');
  if (!isStrongPassword(b.newPassword)) throw badRequest('Senha fraca: mínimo 10 caracteres com letras, números e símbolo');
  await prismaPlatform.platformAdmin.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(b.newPassword) } });
  return { ok: true };
});
