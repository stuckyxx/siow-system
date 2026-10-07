/**
 * Núcleo do seed (idempotente): permissões, papéis, administrador inicial,
 * modelos de mensagem, configurações e proteção da tabela de auditoria.
 *
 * Usado por `prisma/seed.ts` (CLI, via tsx) e pela rota
 * `POST /api/admin/bootstrap` do app Next.js (Vercel) — por isso NÃO lê
 * `process.env` diretamente: tudo chega via `SeedOptions`.
 */
import type { PrismaClient, TaskType } from '@prisma/client';
import { hashPassword } from './password.js';

/**
 * Catálogo de permissões granulares. Papéis são apenas agrupamentos —
 * a autorização sempre verifica a permissão, nunca o nome do papel.
 * Todo código usado em `route(['...'])` nas rotas da API deve constar aqui.
 */
export const PERMISSIONS: Record<string, string> = {
  'entities.read': 'Visualizar entidades',
  'entities.write': 'Cadastrar/editar entidades e fontes de dados',
  'contacts.read': 'Visualizar contatos (dados pessoais)',
  'contacts.write': 'Gerenciar contatos',
  'contracts.read': 'Visualizar contratos',
  'contracts.write': 'Cadastrar/editar contratos e aditivos',
  'invoices.read': 'Visualizar notas fiscais',
  'invoices.override': 'Alterar manualmente dados financeiros (exige justificativa)',
  'invoices.reconcile': 'Resolver reconciliações e conflitos de sincronização',
  'payments.read': 'Visualizar pagamentos e recebimentos',
  'documents.read': 'Visualizar/baixar documentos',
  'documents.write': 'Enviar documentos',
  'certificates.read': 'Visualizar certidões',
  'certificates.manage': 'Gerenciar certidões',
  'tasks.read': 'Visualizar agenda financeira',
  'tasks.manage': 'Criar/editar/transferir tarefas',
  'collections.read': 'Visualizar cobranças',
  'collections.manage': 'Registrar cobranças e enviar mensagens',
  'service_orders.read': 'Visualizar ordens de serviço',
  'service_orders.manage': 'Gerenciar ordens de serviço e assinaturas',
  'reports.read': 'Visualizar relatórios',
  'reports.export': 'Exportar relatórios (PDF/XLSX/CSV)',
  'dashboard.read': 'Visualizar dashboard',
  'sync.read': 'Visualizar monitoramento de sincronização',
  'sync.run': 'Disparar sincronizações',
  'integrations.manage': 'Configurar integrações e mensageria',
  'templates.manage': 'Gerenciar modelos de mensagem',
  'users.manage': 'Gerenciar usuários, papéis e permissões',
  'audit.read': 'Consultar auditoria',
  'settings.manage': 'Alterar configurações do sistema',
};

const ALL = Object.keys(PERMISSIONS);
const READ_ONLY = ALL.filter((p) => p.endsWith('.read'));

export const ROLES: Array<{ name: string; description: string; permissions: string[] }> = [
  { name: 'ADMINISTRADOR', description: 'Acesso total', permissions: ALL },
  {
    name: 'FINANCEIRO',
    description: 'Operação do setor financeiro',
    permissions: ALL.filter(
      (p) => !['users.manage', 'integrations.manage', 'settings.manage'].includes(p),
    ),
  },
  {
    name: 'GESTOR',
    description: 'Diretoria/gestão: leitura ampla e relatórios',
    permissions: [...READ_ONLY, 'reports.export', 'tasks.manage'],
  },
  { name: 'CONSULTA', description: 'Somente leitura', permissions: READ_ONLY },
];

export const TEMPLATES = [
  {
    key: 'SERVICE_ORDER_ISSUE_REMINDER',
    name: 'Avisar cliente para emissão da ordem de serviço',
    subject: 'Emissão de ordem de serviço — competência {{competencia}}/{{exercicio}}',
    body:
      'Olá{{#contato}}, {{contato}}{{/contato}}. Identificamos que a ordem de serviço referente à competência ' +
      '{{competencia}}/{{exercicio}} ainda precisa ser emitida. Solicitamos, por gentileza, a emissão ' +
      'para darmos prosseguimento ao faturamento.\n\nAtenciosamente,\n{{empresa}}',
    variables: ['contato', 'entidade', 'competencia', 'exercicio', 'contrato', 'empresa'],
  },
  {
    key: 'INVOICE_COLLECTION',
    name: 'Cobrança de nota fiscal pendente',
    subject: 'Nota fiscal {{numeroNota}} — competência {{competencia}}/{{exercicio}}',
    body:
      'Olá{{#contato}}, {{contato}}{{/contato}}. Consta em aberto a nota fiscal nº {{numeroNota}}, ' +
      'competência {{competencia}}/{{exercicio}}, no valor de {{valor}}, emitida em {{emissao}}. ' +
      'Poderiam nos informar a previsão de pagamento?\n\nAtenciosamente,\n{{empresa}}',
    variables: [
      'contato',
      'entidade',
      'numeroNota',
      'competencia',
      'exercicio',
      'valor',
      'emissao',
      'empresa',
    ],
  },
  {
    key: 'INVOICE_COLLECTION_FOLLOWUP',
    name: 'Nova cobrança (lembrete)',
    subject: 'Lembrete — nota fiscal {{numeroNota}}',
    body:
      'Olá{{#contato}}, {{contato}}{{/contato}}. Retomamos o contato sobre a nota fiscal nº {{numeroNota}} ' +
      '({{competencia}}/{{exercicio}}, {{valor}}), que segue pendente. Ficamos à disposição para qualquer ' +
      'esclarecimento.\n\nAtenciosamente,\n{{empresa}}',
    variables: ['contato', 'entidade', 'numeroNota', 'competencia', 'exercicio', 'valor', 'empresa'],
  },
];

export const SETTINGS: Array<{ key: string; value: unknown; description: string }> = [
  { key: 'certificates.expiringDays', value: 30, description: 'Dias para considerar certidão "vencendo"' },
  { key: 'contracts.expiringDays', value: 60, description: 'Dias para alertar contrato próximo do vencimento' },
  { key: 'sync.cron', value: '0 */6 * * *', description: 'Frequência da sincronização automática' },
  { key: 'sync.fetchInvoiceDocuments', value: false, description: 'Baixar automaticamente PDFs de notas durante a sincronização' },
  { key: 'company.name', value: 'Sua Empresa de Tecnologia', description: 'Nome usado em mensagens e relatórios' },
  { key: 'invoices.overdueAfterDays', value: 30, description: 'Dias após a emissão para considerar a nota em atraso' },
];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  CHARGE_CLIENT: 'Cobrar município',
  CHARGE_AGAIN: 'Cobrar novamente',
  VERIFY_PAYMENT: 'Verificar pagamento',
  REQUEST_SERVICE_ORDER: 'Solicitar ordem de serviço',
  VERIFY_SIGNATURE: 'Verificar assinatura',
  RENEW_CERTIFICATE: 'Renovar certidão',
  VERIFY_CONTRACT: 'Verificar contrato',
  SEND_DOCUMENT: 'Enviar documento',
  CONFIRM_PAYMENT: 'Confirmar pagamento',
  CUSTOM: 'Tarefa personalizada',
};

/**
 * SQL que protege a tabela de auditoria contra UPDATE/DELETE/TRUNCATE via
 * aplicação. Exportado para que `prisma/schema.sql` e o seed usem o mesmo texto.
 */
export const AUDIT_PROTECTION_SQL: string[] = [
  `CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (operation % blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;`,
  `DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;`,
  `CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();`,
  `DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;`,
  `CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();`,
];

export interface SeedOptions {
  /** E-mail do administrador inicial (padrão: admin@empresa.com.br). */
  adminEmail?: string;
  /** Nome do administrador inicial (padrão: Administrador). */
  adminName?: string;
  /** Senha inicial. Obrigatória (≥ 12 caracteres) quando `requireStrongAdminPassword` é true. */
  adminPassword?: string;
  /** Em produção: recusa criar o admin sem senha forte vinda do ambiente. */
  requireStrongAdminPassword?: boolean;
  /** Cria 2 entidades de exemplo com fontes do portal (apenas dev/teste). */
  sampleEntities?: boolean;
  /** Logger (padrão: silencioso). */
  log?: (message: string) => void;
}

export interface SeedResult {
  permissions: number;
  roles: number;
  adminCreated: boolean;
  adminEmail: string;
  templates: number;
  settings: number;
  auditProtected: boolean;
  sampleEntities: number;
}

async function protectAuditLog(prisma: PrismaClient): Promise<void> {
  for (const sql of AUDIT_PROTECTION_SQL) await prisma.$executeRawUnsafe(sql);
}

/** Executa o seed de forma idempotente (pode rodar quantas vezes for preciso). */
export async function runSeed(prisma: PrismaClient, opts: SeedOptions = {}): Promise<SeedResult> {
  const log = opts.log ?? (() => undefined);

  log('→ permissões');
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { code },
      update: { description },
      create: { code, description },
    });
  }

  log('→ papéis');
  for (const r of ROLES) {
    const before = await prisma.role.findUnique({ where: { name: r.name }, select: { id: true } });
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description, isSystem: true },
      create: { name: r.name, description: r.description, isSystem: true },
    });
    const perms = await prisma.permission.findMany({ where: { code: { in: r.permissions } } });
    if (!before) {
      // Papel novo: conjunto padrão completo.
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    }
    // Papel existente: apenas garante as permissões padrão (não remove ajustes feitos pelo admin na UI),
    // o que permite re-executar o bootstrap com segurança após adicionar permissões novas ao catálogo.
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  log('→ usuário administrador');
  const email = (opts.adminEmail ?? 'admin@empresa.com.br').toLowerCase();
  const name = opts.adminName ?? 'Administrador';
  const existing = await prisma.user.findUnique({ where: { email } });
  let adminCreated = false;
  if (!existing) {
    const envPassword = opts.adminPassword;
    if (opts.requireStrongAdminPassword && (!envPassword || envPassword.length < 12)) {
      throw new Error(
        'SEED_ADMIN_PASSWORD é obrigatório em produção (mínimo 12 caracteres). ' +
          'Recusando criar o administrador com senha padrão.',
      );
    }
    // Fallback somente para desenvolvimento/teste.
    const password = envPassword ?? 'Admin@12345';
    const passwordHash = await hashPassword(password);
    const admin = await prisma.user.create({ data: { name, email, passwordHash, mustChangePassword: true } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMINISTRADOR' } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: adminRole.id } });
    adminCreated = true;
    log(`   criado ${email}`);
  } else {
    log('   já existe, mantido');
  }

  log('→ modelos de mensagem');
  for (const t of TEMPLATES) {
    await prisma.messageTemplate.upsert({
      where: { key: t.key },
      update: {},
      create: { ...t, isSystem: true },
    });
  }

  log('→ configurações');
  for (const s of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { description: s.description },
      create: { key: s.key, value: s.value as object, description: s.description },
    });
  }
  await prisma.setting.upsert({
    where: { key: 'tasks.typeLabels' },
    update: { value: TASK_TYPE_LABELS },
    create: { key: 'tasks.typeLabels', value: TASK_TYPE_LABELS, description: 'Rótulos dos tipos de tarefa' },
  });

  log('→ proteção da auditoria');
  let auditProtected = true;
  try {
    await protectAuditLog(prisma);
  } catch (e) {
    // Em bancos onde o usuário não pode criar funções/triggers (raro no Neon), não aborta o seed.
    auditProtected = false;
    log('   aviso: não foi possível criar os triggers de auditoria: ' + (e instanceof Error ? e.message : String(e)));
  }

  let sampleEntities = 0;
  if (opts.sampleEntities) {
    log('→ entidades de exemplo (fontes de teste)');
    const samples = [
      { type: 'CM' as const, name: 'CÂMARA MUNICIPAL DE ARAIOSES', shortName: 'CM ARAIOSES', municipality: 'Araioses', uf: 'MA', url: 'https://assesi.com.br/adm_faturas/index.php?e=545110&t=1' },
      { type: 'CM' as const, name: 'CÂMARA MUNICIPAL DE BOM LUGAR', shortName: 'CM BOM LUGAR', municipality: 'Bom Lugar', uf: 'MA', url: 'https://www.assesi.com.br/adm_faturas/index.php?e=504673&t=1' },
    ];
    for (const s of samples) {
      const entity = await prisma.entity.upsert({
        where: { type_municipality_uf: { type: s.type, municipality: s.municipality, uf: s.uf } },
        update: {},
        create: { type: s.type, name: s.name, shortName: s.shortName, municipality: s.municipality, uf: s.uf },
      });
      await prisma.dataSource.upsert({
        where: { provider_url: { provider: 'ASSESI_PORTAL', url: s.url } },
        update: {},
        create: { entityId: entity.id, provider: 'ASSESI_PORTAL', url: s.url, label: 'Portal do Cliente' },
      });
      sampleEntities++;
    }
  }

  log('seed concluído');
  return {
    permissions: ALL.length,
    roles: ROLES.length,
    adminCreated,
    adminEmail: email,
    templates: TEMPLATES.length,
    settings: SETTINGS.length + 1,
    auditProtected,
    sampleEntities,
  };
}
