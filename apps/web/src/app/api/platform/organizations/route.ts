import { NextResponse, type NextRequest } from 'next/server';
import { createOrganizationSchema } from '@siow/shared';
import { runSeed } from '@siow/db';
import { cronAuthorized } from '@/server/cron';
import { prisma, prismaPlatform } from '@/server/db';
import { runWithOrg } from '@/server/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Plataforma (superadmin, protegido por CRON_SECRET até a Fase 9 trazer o login de plataforma):
 *  GET  — lista organizações.
 *  POST — cria organização + papéis padrão + administrador (senha com troca obrigatória).
 *  DELETE ?slug= — exclusão lógica de uma organização SEM entidades/notas (suspende, desativa usuários, libera slug/e-mails).
 */
export async function GET(req: NextRequest): Promise<Response> {
  if (!cronAuthorized(req)) return NextResponse.json({ statusCode: 401, message: 'Não autorizado' }, { status: 401 });
  const orgs = await prismaPlatform.organization.findMany({ where: { deletedAt: null }, select: { id: true, name: true, slug: true, status: true, plan: true, createdAt: true, _count: { select: { users: true, entities: true } } }, orderBy: { createdAt: 'asc' } });
  return NextResponse.json(orgs);
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!cronAuthorized(req)) return NextResponse.json({ statusCode: 401, message: 'Não autorizado' }, { status: 401 });
  const body = createOrganizationSchema.parse(await req.json());
  const org = await prismaPlatform.organization.create({ data: { name: body.name, slug: body.slug, document: body.document ?? null, plan: 'SAAS' } });
  const seed = await runWithOrg(org.id, () => runSeed(prisma, { organizationId: org.id, adminEmail: body.adminEmail, adminName: body.adminName, adminPassword: body.adminPassword, requireStrongAdminPassword: true, log: () => undefined }));
  return NextResponse.json({ ok: true, organization: { id: org.id, slug: org.slug, name: org.name }, admin: { email: seed.adminEmail, created: seed.adminCreated } });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  if (!cronAuthorized(req)) return NextResponse.json({ statusCode: 401, message: 'Não autorizado' }, { status: 401 });
  const slug = req.nextUrl.searchParams.get('slug') ?? '';
  const org = await prismaPlatform.organization.findUnique({ where: { slug }, include: { _count: { select: { entities: { where: { deletedAt: null } }, invoices: true, contracts: true } } } });
  if (!org || org.deletedAt) return NextResponse.json({ statusCode: 404, message: 'Organização não encontrada' }, { status: 404 });
  if (org.slug === 'siow-system-tecnologia') return NextResponse.json({ statusCode: 400, message: 'A organização padrão não pode ser removida' }, { status: 400 });
  if (org._count.entities || org._count.invoices || org._count.contracts) return NextResponse.json({ statusCode: 400, message: 'Organização com dados de negócio: remova entidades/notas antes' }, { status: 400 });
  // Exclusão lógica: nada é apagado (audit_logs é append-only e referencia usuários/organização). A organização fica
  // suspensa e com slug/e-mails renomeados para liberar as unicidades; o login passa a ser recusado (loadUser).
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  await prismaPlatform.$transaction(async (tx) => {
    const users = await tx.user.findMany({ where: { organizationId: org.id }, select: { id: true, email: true } });
    await tx.session.updateMany({ where: { userId: { in: users.map((u) => u.id) }, revokedAt: null }, data: { revokedAt: new Date() } });
    for (const u of users) await tx.user.update({ where: { id: u.id }, data: { isActive: false, deletedAt: new Date(), email: `${u.email}.removida-${stamp}` } });
    await tx.organization.update({ where: { id: org.id }, data: { status: 'SUSPENDED', deletedAt: new Date(), slug: `${org.slug}-removida-${stamp}` } });
  });
  return NextResponse.json({ ok: true, removed: slug, mode: 'soft-delete' });
}
