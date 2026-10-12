# Fase 0 — Diagnóstico e planejamento · Siow System → Plataforma Integrada de CRM e Contratos Públicos

Data: 12/10/2026 · Base: `docs/PROMPT-MESTRE-CRM-v2.md` (comando inicial) e `docs/PROMPT-MESTRE-v2.md` (Financeiro). Nenhum código foi modificado nesta fase; apenas leitura do repositório e consultas de contagem no banco de produção (somente leitura).

---

## 1. Diagnóstico da arquitetura atual

**Estado:** o Módulo Financeiro está em produção na Vercel (projeto `siow-system`, commit `d876c90` na `main`), banco Neon (`dark-sound-41190359`), arquivos no Vercel Blob. 35 commits nesta frente de trabalho, deploy feito pela API da Vercel a partir do GitHub (sem auto-deploy por push, pois a conta Vercel não tem o GitHub conectado).

**Forma do código (o que vale para os novos módulos):**

| Camada | Como está hoje | Observação para o CRM |
|---|---|---|
| App | `apps/web` Next.js 15 App Router; API em Route Handlers (`src/app/api/**`, 95 rotas); regras de negócio em `src/server/services/*.ts` (19 serviços, ~3.700 linhas) | Novos módulos seguem o mesmo padrão: `services/<modulo>.ts` + rotas finas + páginas em `(app)/<modulo>` |
| Autorização | `route([perms], handler)` em `src/server/http.ts`: CSRF, usuário da sessão, checagem de permissões **antes** do handler; `null` = rota pública | Ponto único para injetar `organizationId` do usuário no contexto (`ctx.org`) |
| Dados | Prisma 6, 34 modelos, 21 enums; UUID texto; `Decimal(14,2)`; soft delete por `deletedAt`; `schema.sql` idempotente (1.134 linhas, 34 `CREATE TABLE`) espelhando o `schema.prisma` | Esquema **não** tem `organizationId` em nenhuma tabela; nenhuma noção de tenant |
| Pacotes | `shared` (tipos, Zod, enums, datas/moeda), `db` (Prisma, seed, senha), `integrations` (providers ASSESI/ADOIS, registry, http client), `sync-core` (apply-snapshot, contratos, certidões), `storage` (blob), `queue` (resquício Redis/BullMQ, não usado na Vercel) | `shared` é o lugar dos tipos/schemas dos novos módulos; `integrations` recebe PNCP/IBGE/CNPJ |
| UI | Tema "aurora" em `globals.css` (escuro padrão, claro opcional), `components/ui.tsx` (Button, Card, Dialog, Field, Input, Select, Tabs, Stat, Badge, Table, useToast), painéis por aba em `components/panels/*` (9), filtros globais, busca global e busca rápida por regras | Kanban e calendário não existem ainda; o resto (tabelas, diálogos, cards) é reutilizável |
| Jobs | `GET /api/cron/sync` (GitHub Actions 20 min + Vercel 1x/dia) e `GET /api/cron/daily` (`services/alerts.ts`: certidões, contratos, tarefas, alarmes de emissão) protegidos por `CRON_SECRET` | Automações do CRM entram no `daily` (SLA de funil, renovações, saúde do cliente, prazos de licitação) |
| Legado | `apps/api` e `apps/worker` (NestJS) compilam e espelham tipos; só para Docker/VPS | Cada novo campo em tipos compartilhados exige ajuste mínimo lá (como feito com `DashboardCards` e `EntitySummary`) |
| Testes | 3 arquivos (parsers ASSESI/ADOIS com fixtures reais, senha). **Não há** testes de `sync-core`, permissões, serviços ou rotas | Risco principal de regressão: cobertura baixa fora dos parsers |

**Volume real em produção** (consulta somente leitura, 12/10/2026):

| Tabela | Registros | Tabela | Registros |
|---|---|---|---|
| entities | 92 | invoices | 2.425 |
| contracts | 101 | data_sources | 51 |
| documents | 27 | certificates | 18 |
| sync_runs | 2.136 | audit_logs | 288 |
| users | 3 | notifications | 18 |
| contacts, financial_tasks, collection_cases, service_orders | 0 | issuance_alarms | 2 |

Conclusão: a migração multi-organização é pequena em volume (poucos milhares de linhas) e pode ser feita por SQL idempotente em uma janela curta, com backup por snapshot do Neon.

---

## 2. Inventário dos módulos, tabelas e serviços existentes

**Modelos (34):** User, Role, Permission, UserRole, RolePermission, UserPermission, Session · Entity, DataSource, SyncRun · Contract, ContractAmendment · Invoice, InvoiceEvent, SyncConflict · DocumentBlob, Document · Certificate, CertificateVersion · Contact · FinancialTask, TaskEvent · CollectionCase, CollectionAttempt · MessageTemplate, OutboundMessage · ServiceOrder, ServiceOrderSignatory, ServiceOrderEvent, SignatureRequest · AuditLog · IssuanceAlarm · Notification · Setting.

**Unicidades que o CRM precisa respeitar (hoje globais, passarão a ser por organização):** `entities (type, municipality, uf)`, `data_sources (provider, url, entityId)`, `contracts (entityId, number)`, `invoices (entityId, number)`, `contract_amendments (contractId, sequence)`, `certificates (slug, entityId)`, `service_orders (contractId, competenceYear, competenceMonth)`, `users.email`, `notifications.dedupeKey`.

**Serviços (apps/web/src/server/services):** `entities` (lista com contagens, CRUD, fontes, importação por CSV/XLSX, link e parceiro Adois), `sync` (lote por orçamento de tempo, circuito aberto), `invoices` (lista, override com justificativa, lote de situação, manual, reconcile, conflitos), `contracts` (manuais, aditivos, documentos, conta corrente), `collections`, `certificates`, `service-orders` + `signature`, `documents`, `tasks`, `messaging` (modelos, preparar/enviar/confirmar manual), `reports` (PDF/XLSX/CSV com logo), `dashboard` (cards, séries, aging, atenção, previsão), `alerts` (cron diário), `alarms` (prazos de emissão), `users`, `auth`, `system`, `import-template`.

**Permissões (30):** `dashboard.read` · `entities.read/write` · `contacts.read/write` · `contracts.read/write` · `invoices.read/override/reconcile` · `payments.read` · `documents.read/write` · `certificates.read/manage` · `tasks.read/manage` · `collections.read/manage` · `service_orders.read/manage` · `reports.read/export` · `sync.read/run` · `integrations.manage` · `templates.manage` · `users.manage` · `audit.read` · `settings.manage`. Papéis: Administrador, Financeiro, Gestor, Consulta; ajustes individuais (+/−) por usuário.

**Telas (16):** login, dashboard financeiro, entidades (lista com 7 filtros, importar, editar, excluir) e ficha (7 abas: Visão geral, Notas fiscais, Alarme, Contratos, Agenda, Ordens de serviço, Contatos), notas, contratos, agenda, cobranças, certidões, OS, relatórios, sincronização, prazos de emissão, notificações, administração (usuários/papéis/permissões/configurações/auditoria), alterar senha.

**Integrações:** `BillingProvider` com `ASSESI_PORTAL`, `ADOIS_PORTAL` (link de entidade e de parceiro, agrupamento por descrição) e `MANUAL`; WhatsApp/e-mail abstraídos com modo manual; assinatura abstraída (provider MANUAL). Não existem adaptadores PNCP, Compras.gov, IBGE ou CNPJ.

---

## 3. Mapa de integração dos dez módulos

```
0 NÚCLEO (organizações, usuários/RBAC, auditoria, agenda, notificações, documentos, busca, tema, SaaS)
   │ dá contexto (organizationId, usuário, permissões) a tudo abaixo
   ▼
1 CADASTRO ──entidade/contatos/agentes──▶ 2 CRM ──oportunidade ganha──▶ 4 CONTRATOS ──contrato ativo──▶ 5 FINANCEIRO
   ▲                                       │  │                           ▲   │                            │
   │ ficha 360º recebe eventos de todos    │  └── "aguardando contratação"│   │ renovação gera oportunidade│ nota paga
   │                                       │       aponta para ──▶ 3 LICITAÇÕES ──homologado──┘            │ (evento)
   │                                       ▼                                                                 ▼
6 ATENDIMENTO ◀── tickets de cobrança/OS ── 7 PARCEIROS & COMISSÕES ◀──── comissão calculada sobre recebimento confirmado
   │                                                       │
   └──────────────▶ 8 RELATÓRIOS & BI ◀───────────────────┘   (somente leitura de todos; distingue confirmado × projeção × calculado)
                              ▲
9 INTEGRAÇÕES (ASSESI, ADOIS, PNCP, Compras.gov, IBGE, CNPJ, WhatsApp, e-mail, assinatura, webhooks) — adaptadores + modo manual
```

**Dono de cada conceito (uma só verdade):**

| Conceito | Tabela dona | Módulo | Já existe? |
|---|---|---|---|
| Organização, usuário, papel, permissão, sessão, auditoria, notificação, documento, configuração | `organizations` (nova), demais existentes | 0 Núcleo | parcial |
| Entidade, contato, agente público | `entities`, `contacts`, `public_agents` (nova) | 1 Cadastro | sim / sim / não |
| Tarefa/atividade (agenda única) | `financial_tasks` (+ colunas `module`, `opportunityId`, `tenderId`, `ticketId`) | 0 Núcleo | sim |
| Funil, oportunidade, proposta, catálogo, meta | `pipelines`, `pipeline_stages`, `opportunities`, `opportunity_items`, `opportunity_events`, `proposals`, `proposal_items`, `catalog_items`, `goals` (novas) | 2 CRM | não |
| Licitação, prazos, concorrentes, checklist | `tenders`, `tender_deadlines`, `tender_competitors`, `tender_checklist_items` (novas) | 3 Licitações | não |
| Contrato, aditivo, renovação, assinatura | `contracts`, `contract_amendments` (+ colunas), `contract_renewals` (nova), `signature_requests` | 4 Contratos | sim (estender) |
| Nota, evento, conflito, cobrança, certidão, OS, alarme de emissão | existentes | 5 Financeiro | sim (não alterar comportamento) |
| Ticket, visita, campanha, avaliação | `tickets`, `ticket_messages`, `visits`, `campaigns`, `campaign_recipients` (novas) | 6 Atendimento | não |
| Parceiro, regra, comissão | `partners`, `commission_rules`, `commissions` (novas); `entities.partnerId`, `contracts.partnerId` | 7 Parceiros | não |
| Indicadores consolidados, saúde do cliente | `entity_health_snapshots` (nova), `timeline_events` (nova) | 8 Relatórios | não |
| Credenciais, logs e execuções de integração, webhooks, chaves de API | `integration_configs`, `integration_runs` (reaproveitar `sync_runs` onde couber), `webhooks`, `api_keys` (novas) | 9 Integrações | parcial |

**Regra de comunicação:** serviços de domínio chamam serviços de domínio (`crm.markWon` → `contracts.createFromOpportunity` → `alarms.create`), dentro de `prisma.$transaction` quando o fluxo for atômico; eventos persistentes só onde um módulo precisa reagir a outro de forma assíncrona (nota paga → comissão; contrato a vencer → oportunidade de renovação), com `dedupeKey` para idempotência. Sem microserviços.

---

## 4. Funcionalidades que serão reutilizadas (sem reescrever)

- **Cadastro:** tela de Entidades (cards, 7 filtros, Editar, Excluir sem notas), ficha com abas, importação por link/planilha/CSV, `Contact`, `responsibleUserId`, `cnpj` (já existe no modelo, hoje não usado na interface).
- **Contratos:** `Contract` + `ContractAmendment` + `ContractDocument` + conta corrente + `SignatureRequest`; regra "aba Contratos mostra só manuais" mantida.
- **Financeiro inteiro:** sincronização, notas, override/lote, cobrança, certidões, OS, alarmes de emissão, relatórios, dashboard; vira **fonte** dos indicadores de receita realizada/recebida, inadimplência e base de comissão.
- **Núcleo:** `route()` (ponto de injeção do tenant), RBAC com ajustes individuais, `AuditLog` com trigger de imutabilidade, `Notification` com `dedupeKey`, `FinancialTask` como agenda única, `Document`/`DocumentBlob`, busca global/rápida, tema claro/escuro, filtros globais, exportadores PDF/XLSX/CSV com logo, `Setting` por chave.
- **Integrações:** `BillingProvider`/registry (modelo para os novos adaptadores), `httpRequest` com timeout/UA, modo manual de mensagens e assinatura, `cronRoute`.
- **Infra:** `schema.sql` idempotente (padrão das migrações), Vercel + Neon + Blob, cron, Playwright/curl de validação ao vivo usados nesta sessão.

---

## 5. Riscos para o Financeiro em produção e mitigação

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R1 | Adicionar `organizationId` e trocar unicidades (ex.: `entities (type, municipality, uf)` → `(organizationId, type, municipality, uf)`) em tabelas vivas | Sincronização (upsert por `entityId_number`, `provider_url_entityId`) pode quebrar se as chaves mudarem de nome | Manter os nomes dos índices compostos usados pelo Prisma (`entityId_number`, `provider_url_entityId`); `organizationId` entra como coluna com `DEFAULT` da organização Siow e `NOT NULL` só depois de preenchida; unicidades novas são **adicionais**, as antigas ficam até a Fase 10 |
| R2 | Filtro de tenant esquecido em consulta SQL crua (`entities.list`, `dashboard`, relatórios usam `$queryRaw`) | Vazamento entre organizações no SaaS | Middleware Prisma para modelos Prisma + helper `tenantSql(ctx)` obrigatório nas consultas cruas + teste automatizado de isolamento com duas organizações (critério de aceite) |
| R3 | Cron (`/api/cron/sync`, `/api/cron/daily`) roda sem usuário/organização | Jobs precisam iterar por organização e respeitar módulos habilitados | `cronRoute` passa a percorrer `organizations` ativas; orçamento de tempo dividido; dedupeKeys prefixadas com `org` |
| R4 | Cobertura de testes baixa em `sync-core` e serviços | Regressão silenciosa ao estender `contracts`/`entities` | Antes da Fase 1: testes de regressão com fixtures reais (CM Bom Lugar 20/7/R$ 9.240, CM Araioses 37 pagas, conflito manual, sumiço em massa) e teste de permissões efetivas |
| R5 | Mudança de `FinancialTask` para agenda única (colunas novas, rótulo) | Agenda/alertas existentes | Só adicionar colunas opcionais; tipos de tarefa novos entram no enum `TaskType` sem remover os atuais |
| R6 | Deploy sem auto-deploy (GitHub não conectado à Vercel) e sem secrets do GitHub Actions | Publicação manual pela API; sync de 20 min depende do workflow | Conectar GitHub à Vercel e criar os secrets `APP_URL`/`CRON_SECRET` (ação do dono da conta) antes da Fase 1 |
| R7 | Timeout de 60 s na Vercel Hobby | Importações grandes (IBGE, PNCP) e relatórios consolidados | Processar em lotes por requisição (padrão já usado em `syncBatch`), paginação e cache em tabela |
| R8 | Dados sensíveis já expostos em chat (senha do banco, `CRON_SECRET`) | Segurança | Rotacionar no Neon e na Vercel antes de abrir o sistema a outras organizações |
| R9 | `apps/api`/`apps/worker` (NestJS) desatualizam | CI quebra | Manter compilando com ajustes mínimos de tipo; não implementar CRM neles |
| R10 | Duplicidade de entidades em importações (IBGE/PNCP) | Cadastro sujo | Chave natural `normalizeKey(municipality) + type + uf (+ organizationId)` e `ibgeCode`; "dry-run" com prévia antes de gravar, como no Importar entidade |

---

## 6. Plano de banco de dados e migração

**Princípios:** SQL idempotente em `packages/db/prisma/schema.sql` (seções novas), aplicado por `run_sql_transaction` no Neon apenas após aprovação; `schema.prisma` atualizado e `prisma generate` no build; reversível por script inverso onde possível (drop de colunas/tabelas novas; nunca drop de dados existentes).

**Fase 1 (núcleo multi-organização):**

1. **Backup:** snapshot do Neon (branch `pre-fase1`) + `pg_dump` lógico; validação de contagens (tabela da seção 1).
2. `CREATE TABLE organizations` (id, name, slug único, document, plan, modules JSON, branding JSON, status, locale, createdAt/updatedAt/deletedAt) e `platform_admins`.
3. Inserir organização `siow-system-tecnologia` (id fixo, gravado em `Setting platform.defaultOrganizationId`).
4. Para cada tabela de negócio (34 menos `permissions`, `roles`*, `platform_admins`): `ALTER TABLE … ADD COLUMN "organizationId" TEXT NULL`; `UPDATE … SET "organizationId" = <siow>` ; `ALTER … SET NOT NULL` + `DEFAULT` removido; índice `(organizationId)`; FK para `organizations`. (*`roles` passam a ser por organização: coluna + unicidade `(organizationId, name)`; permissões continuam globais.)
5. Unicidades novas **adicionais**: `users (organizationId, email)`, `entities (organizationId, type, municipality, uf)`, `roles (organizationId, name)`, `settings (organizationId, key)`; as antigas permanecem até a Fase 10 para não quebrar o Financeiro (na Edição Própria são equivalentes).
6. `financial_tasks`: colunas opcionais `module`, `opportunityId`, `tenderId`, `ticketId`; `TaskType` ganha valores comerciais.
7. `public_agents`, `timeline_events`, `entity_health_snapshots`; `entities` ganha `ibgeCode`, `partnerId` (nullable, FK criada na Fase 4), `segment`, `lifecycle` (calculado, não persistido inicialmente).
8. **Validação pós-migração:** contagens iguais; `/api/health` ok; sincronização de CM Bom Lugar e CM Araioses com os números de referência; login dos 3 usuários; critérios do PROMPT-MESTRE v2.
9. **Recuperação:** restaurar branch `pre-fase1` no Neon e republicar o deploy anterior (Instant Rollback na Vercel). Tempo estimado de rollback: minutos.

**Fases seguintes:** cada módulo adiciona suas tabelas (seção 3) em seções próprias do `schema.sql`, sempre com `organizationId`, `createdAt/updatedAt/deletedAt`, índices por `(organizationId, <chave natural>)` e sem alterar colunas existentes do Financeiro.

**LGPD:** exportação por organização (JSON + arquivos) e exclusão/anonimização (`users`, `contacts`, `public_agents`) ficam na Fase 9; auditoria de acesso a dados pessoais já existe via `AuditLog`.

---

## 7. Sequência técnica de implementação

| Fase | Entregas técnicas principais | Dependências |
|---|---|---|
| 1 Núcleo e Cadastro | migração multi-org (seção 6), `ctx.org` em `route()`, middleware Prisma + `tenantSql`, cron por organização, teste de isolamento, testes de regressão do Financeiro, `public_agents`, linha do tempo, lifecycle/saúde (v1 com pesos configuráveis em `Setting`), importação IBGE (lotes), abas Comercial/Licitações/Atendimento/Linha do tempo na ficha (vazias até os módulos existirem) | R1–R5, R6 resolvido pelo dono da conta |
| 2 CRM Comercial | `pipelines/stages` (padrão: Lead → Contato realizado → Qualificado → Proposta → Negociação → Aguardando contratação → Ganho/Perdido), `opportunities` + eventos, propostas com versões e PDF (exportador existente), catálogo, atividades (agenda única), metas, Kanban + lista + calendário, SLA de etapa no cron, "Ganho" abre assistente de formalização (não cria contrato ativo sem confirmação), Dashboard comercial | Fase 1 |
| 3 Contratos e integração financeira | colunas novas em `contracts`, `contract_renewals`, assistente de criação a partir de oportunidade/licitação, renovação 90 dias → oportunidade + tarefa (dedupe), reajuste manual com índice informado, encerramento, "situação financeira do contrato" (previsto × faturado × recebido, sempre separados), alarme de emissão criado na formalização | Fase 2 |
| 4 Parceiros e Comissões | `partners`, `commission_rules`, `commissions`; gatilho em `invoices.override`/`apply-snapshot`/`bulkStatus` quando nota vira PAGA (e reversão quando volta a pendente/cancelada); pagamentos parciais pelo `paidAmount`; extrato e relatórios; papel Parceiro com escopo | Fase 3 |
| 5 Licitações | `tenders` + prazos + concorrentes + checklist ligado a `certificates`; calendário; alertas no cron; importação PNCP (adaptador leitura, chave oficial) e planilha; homologação → assistente de contrato | Fases 1, 3 |
| 6 Atendimento | `tickets`, `visits`, `campaigns`, SLA no cron, NPS, ficha 360º completa | Fase 1 |
| 7 Relatórios e BI | dashboard executivo (abas Executivo/Comercial/Financeiro), relatórios consolidados com filtros globais, mapa por município/UF, rótulos confirmado × projeção × calculado | Fases 2–6 |
| 8 Integrações externas | `integration_configs` por organização, adaptadores IBGE/CNPJ/PNCP/Compras.gov, WhatsApp/e-mail/assinatura configuráveis por organização, webhooks e API keys, monitoramento (reaproveitar tela Sincronização) | Fase 1 |
| 9 SaaS/White-label | onboarding, planos/licenciamento por módulo, bloqueio suave, branding/domínio, superadmin com impersonação auditada, portabilidade | Fases 1–8 |
| 10 Homologação | testes integrados do fluxo Lead → Renovação, isolamento, desempenho (60 s), segurança, documentação, rotação de segredos | todas |

---

## 8. Critérios de aceite da Fase 1

1. `pnpm typecheck`, `pnpm --filter @siow/web build` e `pnpm -r test` verdes; `apps/api`/`apps/worker` compilando.
2. Migração aplicada no Neon com backup prévio; contagens das 15 tabelas da seção 1 inalteradas; todas as linhas com `organizationId` da Siow; nenhuma unicidade antiga removida.
3. **Regressão do Financeiro ao vivo:** CM Bom Lugar 20 notas / 7 pendentes / R$ 9.240; CM Araioses 37 pagas; receita prevista do Dashboard igual à anterior à migração; nota alterada manualmente + sincronização gera conflito; Importar entidade por link (Tuntum) e "Baixar planilha do link" funcionando; alarme de emissão de PM Tuntum preservado; login dos 3 usuários.
4. **Isolamento:** teste automatizado cria duas organizações com o mesmo e-mail de usuário, uma entidade em cada, e prova que lista, ficha, dashboard, relatórios, sincronização e notificações de uma não veem a outra; chamada direta à API com id de outra organização retorna 404/403 e é auditada.
5. `route()` expõe `ctx.org`; nenhuma consulta nova sem filtro de organização (revisão + helper obrigatório); cron percorre organizações.
6. Cadastro Público: agentes públicos (CRUD, mandato, decisor), `cnpj`/`ibgeCode`/segmento na ficha, lifecycle (Lead/Prospect/Cliente/Ex-cliente) derivado e filtrável na lista, importação IBGE de uma UF sem duplicar as 92 entidades atuais (prévia antes de gravar).
7. Ficha 360º com aba Linha do tempo unificada (eventos de notas, contratos, sincronização, alarmes, tarefas, auditoria relevante) e abas reservadas para os módulos futuros.
8. Agenda única: tarefas de qualquer módulo com responsável e vencimento; "Minha agenda" e "Da equipe"; nada removido da agenda atual.
9. Saúde do cliente v1 visível no card da entidade com fórmula e pesos em `Setting` e distinção explícita de "sem dados".
10. Documentação atualizada: `docs/ARCHITECTURE.md` (tenant, módulos), `docs/DEPLOY-VERCEL.md` (migração, rollback), este diagnóstico com o que foi executado.

---

## Pendências do dono da conta antes da Fase 1 (não dependem de código)

- Conectar o GitHub à Vercel (deploy automático) e criar os secrets `APP_URL` e `CRON_SECRET` no repositório (sincronização a cada 20 min).
- Rotacionar a senha do banco no Neon e o `CRON_SECRET` (foram expostos em chat) e atualizar as variáveis na Vercel.
- Aprovar: nomes das etapas padrão do funil, papéis padrão (inclusive "Parceiro"), pesos iniciais da saúde do cliente e a janela de renovação (90 dias).

---

## Executado na Fase 1 (12/10/2026)

**Banco (Neon, produção)** — backup prévio no branch `pre-fase1-backup-2026-10-12` (`br-shy-mud-b4mlobv5`). Migração idempotente aplicada em 3 transações
+ 6 `ALTER TYPE` (fora de transação): `organizations`, `platform_admins`, `organizationId` em 20 tabelas (preenchido com a organização padrão,
`NOT NULL`, `DEFAULT` temporário, índice e FK), `audit_logs.organizationId` nulo (preenchido via `DEFAULT` no `ADD COLUMN` porque a tabela é
append-only), novas colunas em `entities`/`financial_tasks`, novas tabelas `public_agents` e `entity_health_snapshots`, unicidades por organização.
Contagens após a migração iguais às anteriores (entities 94, contracts 101, invoices 2425, data_sources 51, documents 27, certificates 18,
sync_runs 2151, audit_logs 288, users 3, notifications 18, issuance_alarms 2); 100% das linhas com `organizationId` da Siow.

**Desvios em relação ao plano (seção 6)**, todos necessários para a 2ª organização funcionar e validados em teste local com duas organizações:
- Unicidades globais `roles.name`, `entities(type,municipality,uf)` e `message_templates.key` **removidas** (substituídas pelas unicidades por
  organização, já criadas). `users.email` continua global (o login é só por e-mail).
- Remoção de organização é **exclusão lógica** (`status=SUSPENDED`, `deletedAt`, slug/e-mails renomeados, sessões revogadas): nada é apagado,
  porque `audit_logs` é append-only e referencia usuários e organização.

**Código** — commits `4d10dc2` (Fase 1) e seguintes: contexto de tenant (`AsyncLocalStorage` + extensão Prisma com testes), `organizationId` em
todos os `create`, raw SQL filtrado, crons por organização, `CurrentUser.organization`, Cadastro Público (agentes públicos, linha do tempo,
saúde do cliente v1, importação IBGE como leads, ciclo de vida LEAD/CLIENTE/EX_CLIENTE), rota de plataforma `POST/GET/DELETE /api/platform/organizations`
protegida por `CRON_SECRET` até a Fase 9.

**Correção encontrada na validação**: `runWithOrg/runAsPlatform` precisam fazer `await fn()` dentro do `als.run` — uma PrismaPromise é preguiçosa
e, sem isso, a consulta executava fora do contexto e toda requisição autenticada respondia 401. Corrigido antes da publicação definitiva.

**Testes de aceite** — ver relatório de entrega no chat/commit: regressão do Financeiro ao vivo, teste de isolamento com organização
`isolamento-teste` (lista vazia, 404 para entidade da Siow, dashboard zerado, cron por organização), depois removida (exclusão lógica).

---

## Executado na Fase 2 (12/10/2026)

**Banco (Neon, produção)** — backup prévio no branch `pre-fase2-backup-2026-10-12` (`br-ancient-fog-b4vepg9v`). Migração aditiva e idempotente
(seção "FASE 2" do `schema.sql`): tipo `OpportunityStatus`, valor `OPPORTUNITY_STALLED` em `NotificationType`, 9 tabelas novas
(`pipelines`, `pipeline_stages`, `opportunities`, `opportunity_items`, `opportunity_events`, `proposals`, `proposal_items`, `catalog_items`,
`goals`), índice/FK de `financial_tasks.opportunityId`. Nenhuma coluna existente alterada. Bootstrap aplica permissões `crm.*`, papel
COMERCIAL, funil padrão e configurações `crm.lossReasons` / `crm.stalledDays`.

**Código** — commit `c301e77`: serviços `crm/*` (funil, oportunidades, propostas com PDF, catálogo, metas, dashboard), rotas
`/api/comercial/*`, telas Comercial (Painel, Kanban, Lista, Calendário), ficha da oportunidade (etapas, itens, propostas versionadas,
atividades, histórico), catálogo, metas, configurar funil, aba Comercial na entidade, eventos do CRM na linha do tempo, alerta de
oportunidade parada no cron diário.

**Validação** — fluxo completo testado localmente (Postgres 16 + Next) e em produção: catálogo → oportunidade com itens → mover etapa →
proposta v1/v2 (v1 vira "substituída") → PDF → atividade (calendário comercial) → ganho → formalização em rascunho (não entra em
"contratos ativos") → meta apurada → dashboard; oportunidade parada detectada, notificada pelo cron e listada no painel; funil editado
com etapa nova; regressão do Financeiro mantida.

---

## Executado na Fase 3 (12/10/2026)

**Banco (Neon, produção)** — backup prévio `pre-fase3-backup-2026-10-12`. Migração aditiva e idempotente (seção "FASE 3" do `schema.sql`):
colunas opcionais em `contracts` e `contract_amendments`, valores `ADJUSTMENT`/`EXTENSION` em `AmendmentKind`, tabela `contract_renewals`,
configuração `contracts.renewalDays` (90). Nenhuma coluna existente alterada; comportamento do Financeiro preservado.

**Código** — ativação de rascunho, encerramento, reajuste por índice informado, prorrogação (aditivo), situação financeira do contrato
(previsto × faturado × recebido × pendente), renovações automáticas (oportunidade + tarefa) com decisão humana, ficha do contrato
(`/financeiro/contratos/[id]`), lista de contratos com filtros e aba Renovações, hub do Financeiro (`/financeiro/central`), menu no formato
do PROMPT MESTRE, alerta de renovações no Dashboard, contrato formalizado guarda a oportunidade de origem.

**Validação** — fluxo local e em produção: oportunidade ganha → rascunho → ativação com alarme → reajuste IPCA 5% (valor atualizado na conta
corrente) → cron abre a renovação (idempotente) com oportunidade RENOVACAO e tarefa → prorrogação por aditivo → decisão "renovado" fecha a
oportunidade como ganha e conclui a tarefa → encerramento com motivo; regressão do Financeiro mantida.

---

## Executado na Fase 4 (12/10/2026)

**Banco (Neon, produção)** — backup `pre-fase4-backup-2026-10-12`. Migração aditiva e idempotente (seção "FASE 4" do `schema.sql`):
`partners`, `commission_rules`, `commissions`, FKs de `partnerId` em entidades/contratos/oportunidades. Permissões `partners.*` e papel PARCEIRO.

**Código** — cadastro de parceiros (tipo, contato, dados bancários, usuário do portal), vínculo de entidades (no parceiro e no cadastro da
entidade), regras de comissão (base recebimento/faturamento, percentual, escopo por entidade/contrato, janela de competências, N primeiras
competências), motor idempotente de comissões ligado ao Financeiro (manual, lote, conflitos, sincronização, cron), extrato por parceiro,
registro de pagamento em lote (auditado), estornos, portal do parceiro (`/parceiro`) restrito ao próprio parceiro, menu "Parceiros".

**Validação** — fluxo local e em produção: parceiro + usuário PARCEIRO → vínculo de entidade → regra 10% sobre recebimento → comissões
prevista/a pagar → nota paga em lote vira "a pagar" → pagamento registrado → nota volta a pendente gera estorno (comissão já paga) →
pagamento parcial (base = valor recebido) → recálculo idempotente (cron) → portal do parceiro vê só os próprios dados e recebe 403 fora dele.
