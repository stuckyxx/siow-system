import { NextResponse, type NextRequest } from 'next/server';
import { createOrganizationSchema } from '@siow/shared';
import { hashPassword, runSeed } from '@siow/db';
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
 *  DELETE ?slug= — remove uma organização SEM entidades/notas (uso: teste de isolamento e onboarding desfeito).
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
  void hashPassword;
  return NextResponse.json({ ok: true, organization: { id: org.id, slug: org.slug, name: org.name }, admin: { email: seed.adminEmail, created: seed.adminCreated } });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  if (!cronAuthorized(req)) return NextResponse.json({ statusCode: 401, message: 'Não autorizado' }, { status: 401 });
  const slug = req.nextUrl.searchParams.get('slug') ?? '';
  const org = await prismaPlatform.organization.findUnique({ where: { slug }, include: { _count: { select: { entities: true, invoices: true, contracts: true } } } });
  if (!org) return NextResponse.json({ statusCode: 404, message: 'Organização não encontrada' }, { status: 404 });
  if (org.slug === 'siow-system-tecnologia') return NextResponse.json({ statusCode: 400, message: 'A organização padrão não pode ser removida' }, { status: 400 });
  if (org._count.entities || org._count.invoices || org._count.contracts) return NextResponse.json({ statusCode: 400, message: 'Organização com dados de negócio: remova entidades/notas antes' }, { status: 400 });
  await prismaPlatform.$transaction(async (tx) => {
    await tx.auditLog.updateMany({ where: { organizationId: org.id }, data: { organizationId: null } });
    await tx.notification.deleteMany({ where: { organizationId: org.id } });
    const users = await tx.user.findMany({ where: { organizationId: org.id }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await tx.session.deleteMany({ where: { userId: { in: ids } } });
    await tx.userRole.deleteMany({ where: { userId: { in: ids } } });
    await tx.userPermission.deleteMany({ where: { userId: { in: ids } } });
    await tx.user.deleteMany({ where: { organizationId: org.id } });
    const roles = await tx.role.findMany({ where: { organizationId: org.id }, select: { id: true } });
    await tx.rolePermission.deleteMany({ where: { roleId: { in: roles.map((r) => r.id) } } });
    await tx.role.deleteMany({ where: { organizationId: org.id } });
    await tx.messageTemplate.deleteMany({ where: { organizationId: org.id } });
    await tx.organization.delete({ where: { id: org.id } });
  });
  return NextResponse.json({ ok: true, removed: slug });
}
