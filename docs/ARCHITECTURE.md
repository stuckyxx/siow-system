# Siow System — Arquitetura

Plataforma modular da Siow System Tecnologia. O primeiro módulo é o **Financeiro**
(gestão de contratos e recebimentos de órgãos públicos). Novos módulos entram
ao lado dele reutilizando a plataforma (autenticação, RBAC, auditoria,
documentos, notificações, filas e armazenamento).

## 1. Visão geral

```
                 ┌────────────────────────┐
   navegador ───▶│  apps/web  (Next.js)    │  App Router, Tailwind, TanStack Query
                 └───────────┬────────────┘
                             │ HTTPS + cookies HttpOnly (SameSite=Strict) + X-Requested-With
                 ┌───────────▼────────────┐
                 │  apps/api  (NestJS)     │  REST /api/...  RBAC granular, auditoria, zod
                 └──┬─────────┬───────────┘
                    │         │ enfileira jobs (BullMQ)
        Prisma      │         ▼
                 ┌──▼────┐ ┌──────────┐    ┌──────────────┐
                 │Postgres│ │  Redis   │◀──▶│ apps/worker  │  sync, documentos, alertas
                 └────────┘ └──────────┘    └──────┬───────┘
                                                   │ BillingProvider (HTTP + parser)
                 ┌────────┐                 ┌──────▼───────┐
                 │ MinIO/ │◀────────────────│ Portal do    │  fonte externa (por entidade)
                 │  S3    │  PDFs privados  │ Cliente      │
                 └────────┘                 └──────────────┘
```

O frontend **nunca** acessa o portal externo; toda coleta acontece no worker.

## 2. Monorepo (pnpm workspaces)

| Caminho | Pacote | Papel |
|---|---|---|
| `apps/api` | `@siow/api` | API NestJS. `modules/platform/*` (auth, users, documents, system) e `modules/financeiro/*` (módulo Financeiro). |
| `apps/worker` | `@siow/worker` | Workers BullMQ separados da API: `financeiro.sync`, `financeiro.documents`, `financeiro.alerts` + agendamentos. |
| `apps/web` | `@siow/web` | Next.js 15 (App Router). Rotas do módulo em `src/app/(app)/financeiro/*`. |
| `packages/db` | `@siow/db` | Schema Prisma, migrations, seed (papéis, permissões, admin, templates, configurações, proteção da auditoria). |
| `packages/shared` | `@siow/shared` | Enums + rótulos PT-BR, schemas Zod (validação compartilhada API/web), tipos de resposta, utilidades de dinheiro/datas/competência, renderizador de templates. |
| `packages/integrations` | `@siow/integrations` | Camada de integração desacoplada: `BillingProvider`, `AssesiPortalProvider` (HTTP + parser cheerio), cliente HTTP com timeout/retry/backoff, registry de providers. |
| `packages/sync-core` | `@siow/sync-core` | Regras de aplicação de um snapshot ao banco com histórico, reconciliação e conflitos (contratos, notas, certidões). |
| `packages/queue` | `@siow/queue` | Nomes de filas, payloads de jobs e fábrica de conexões — único acoplamento API ⇄ worker. |
| `packages/storage` | `@siow/storage` | S3-compatible (MinIO em dev), URLs pré-assinadas, `DocumentStore` com deduplicação por SHA-256. |
| `infra/` | — | `docker-compose.yml` (Postgres 16, Redis 7, MinIO). |

## 3. Camada de integração (spec §3)

```
BillingProvider (interface)
 ├── AssesiPortalProvider   ✔ implementado — GET página + POST ajax/Faturas.ajax.php (listagem completa)
 ├── AssesiApiProvider      placeholder — quando existir API oficial, implementa a mesma interface
 └── (Playwright)           só se o portal passar a exigir JS/sessão; mesma interface
```

Saída normalizada (`BillingSnapshot`): entidade, contratos (número, aditivo, vigência),
notas (número, competência, valor, emissão, status **normalizado** `PENDING|PAID|CANCELLED|UNKNOWN`,
data de pagamento, links de documentos), certidões (nome, PDF, validade), resumo dos cards
e `invoiceListComplete` (se a listagem completa foi obtida).

Observações do portal real (set/2026):
- A página inicial lista só pendentes; a listagem completa vem do endpoint AJAX sem autenticação.
- O link da NF (`ver_nota.php`) **incrementa um contador de visualização** no portal a cada acesso:
  por isso o PDF da nota só é capturado **sob demanda** de um usuário (auditado), nunca em cada sync.
  Recibos e certidões são GET sem efeito colateral e são capturados automaticamente.
- A descrição/histórico do serviço só existe nos modais das notas pendentes.

## 4. Sincronização (spec §5, §6, §26)

Fluxo do job `sync-one` (worker):
1. `SyncRun` → RUNNING; busca snapshot via provider (timeout + 3 tentativas HTTP com backoff).
2. `applySnapshot` (transação):
   - contratos: upsert por (entidade, número); contrato manual não é sobrescrito; aditivo "Nº ADT" vira `ContractAmendment`.
   - notas: nova → `CREATED`; existente → diff campo a campo, cada mudança vira `InvoiceEvent`
     (`STATUS_CHANGED`, `FIELD_CHANGED`) com origem `SYNC` e `syncRunId`.
   - nota com `manualOverride` → campos protegidos (`status`, `paidAt`, `amount`) **não** são
     sobrescritos; divergência gera `SyncConflict(OPEN)` para decisão humana (manter manual / aceitar fonte).
   - nota ausente da fonte → **não é apagada nem marcada como paga**: recebe `missingSince`,
     `needsReconciliation=true` e evento `MISSING_FROM_SOURCE`. Se a listagem completa não foi obtida,
     só as pendentes ausentes são marcadas.
   - PAID → PENDING na fonte → mantém a fonte mas marca `needsReconciliation` (regressão suspeita).
   - certidões: nova versão a cada mudança de arquivo/validade; anteriores viram histórico.
   - confere o total de débitos calculado com o card do portal e registra aviso se divergir.
3. `SyncRun` → SUCCESS/PARTIAL (com `stats` e `warnings`) ou FAILED (mensagem + stack).
4. Retry: BullMQ (4 tentativas, backoff exponencial). Erros não-retryable (página não é o portal) param.
   **Circuit breaker**: 3 falhas consecutivas abrem o circuito por 60 min — a sync agendada pula a fonte
   (`SKIPPED`), a manual sempre tenta. Falhas geram `Notification(SYNC_FAILED)`.

Agendamentos (`upsertJobScheduler`): `sync-all` pelo cron `Setting sync.cron` (padrão 6/6h) e
`daily-checks` às 07:00 (certidões vencendo/vencidas, contratos vencendo, tarefas do dia).

## 5. Modelo de dados (resumo)

`packages/db/prisma/schema.prisma` — principais entidades:

- **Plataforma**: `User`, `Role`, `Permission`, `UserRole`, `RolePermission`, `Session` (refresh rotativo, hash),
  `AuditLog` (append-only, triggers impedem UPDATE/DELETE/TRUNCATE), `Notification`, `Setting`,
  `Document` + `DocumentBlob` (dedupe por checksum, bucket privado).
- **Financeiro**: `Entity` (PM/CM/…), `DataSource` (URL por entidade, circuito), `SyncRun`,
  `Contract` + `ContractAmendment`, `Invoice` + `InvoiceEvent` + `SyncConflict`,
  `Certificate` + `CertificateVersion`, `Contact`, `FinancialTask` + `TaskEvent`,
  `CollectionCase` + `CollectionAttempt` (status de cobrança ≠ status da nota),
  `MessageTemplate` + `OutboundMessage`, `ServiceOrder` + `ServiceOrderSignatory` + `ServiceOrderEvent` + `SignatureRequest`.

Convenções: dinheiro `Decimal(14,2)` (trafega como string), datas de negócio `@db.Date` em UTC-civil,
exclusão lógica (`deletedAt`), tudo crítico em `AuditLog` (usuário, ação, recurso, antes/depois, IP, UA, justificativa).

A **conta corrente do contrato** (spec §23) é calculada em `LedgerService`: mês a mês, esperado × faturado × pago × pendente,
distinguindo `NOT_INVOICED` (não houve nota) de `PENDING` (nota emitida e não paga).

## 6. Segurança (spec §27–29)

- Senhas Argon2id; login com custo constante (não revela e-mail); rate limit específico no login.
- Access token JWT curto (15 min) e refresh opaco rotativo (7 d) em cookies `HttpOnly; SameSite=Strict; Secure` (obrigatório em produção).
  Reuso de refresh já rotacionado revoga todas as sessões do usuário.
- CSRF: SameSite=Strict + guard exigindo `X-Requested-With` e `Origin` permitido em métodos mutantes.
- RBAC por **permissão** (`invoices.override`, `reports.export`, …); papéis são só agrupamentos (seed: ADMINISTRADOR, FINANCEIRO, GESTOR, CONSULTA).
- Helmet, CORS restritivo, validação Zod em toda entrada, queries parametrizadas (Prisma; raw SQL só com `Prisma.sql`).
- Segredos só por variáveis de ambiente (`.env.example`), logs com redação de campos sensíveis.
- Contatos (dados pessoais) sob permissões próprias (`contacts.read/write`); documentos só via URL pré-assinada temporária.
- Estrutura pronta para 2FA (`twoFactorEnabled/Secret` no usuário).

## 6a. Multi-organização (Fase 1 do CRM)

Toda tabela de negócio tem `organizationId` (FK para `organizations`). O isolamento é aplicado no **backend**, em duas camadas:

- `apps/web/src/server/tenant.ts`: contexto por requisição em `AsyncLocalStorage` (`runWithOrg`, `runAsPlatform`, `currentOrgId`).
  `route()` (`http.ts`) entra em `runWithOrg(user.organizationId)` para requisições autenticadas e em `runAsPlatform` para as públicas.
- `packages/db/src/tenant.ts`: extensão Prisma (`$allModels.$allOperations`) que injeta `organizationId` no `where` de leitura/atualização/exclusão
  e nos `create`. Modelos filhos sem a coluna (`Session`, `UserRole`, `ContractAmendment`, `InvoiceEvent`, …) são filtrados pela relação
  (`CHILD_TENANT_PATHS`). Modelos globais: `Permission`, `Setting`, `Organization`, `PlatformAdmin`. Sem contexto e fora do modo plataforma,
  a operação falha com `TenantContextError` (nunca vaza dados entre organizações por omissão).
- Raw SQL (`entities.ts`, `dashboard.ts`, `reports.ts`) adiciona `e."organizationId" = ${currentOrgId()}` explicitamente.
- Crons (`cron.ts` → `forEachOrganization`) iteram as organizações ativas e executam cada job dentro de `runWithOrg`.

Organização padrão: `DEFAULT_ORGANIZATION_ID` (`@siow/shared`) = Siow System Tecnologia. `Setting` continua global na Fase 1 (overrides por
organização ficam para a Fase 9). Unicidades antigas (`users.email`, `roles.name`, `entities(type,municipality,uf)`) foram mantidas e as
por organização adicionadas; as colunas `organizationId` têm `DEFAULT` da organização padrão até a Fase 10.

Cadastro Público (módulo 1) acrescenta `public_agents` (agentes públicos por entidade), `entity_health_snapshots` (saúde do cliente diária,
pesos em `Setting health.weights`), campos `ibgeCode/segment/partnerId/healthScore` em `entities`, importação de municípios do IBGE como leads
(`entities/import-ibge`) e a linha do tempo unificada (`services/timeline.ts`).

## 6b. CRM Comercial (Fase 2)

Tabelas (todas com `organizationId`): `pipelines`/`pipeline_stages` (funil configurável; padrão Lead → Contato realizado → Qualificado →
Proposta → Negociação → Aguardando contratação → Ganho/Perdido, com probabilidade e SLA por etapa), `opportunities` (+ `opportunity_items`,
`opportunity_events`), `proposals` (+ `proposal_items`, versionadas por oportunidade), `catalog_items`, `goals`. A agenda única
(`financial_tasks`) recebe as atividades comerciais via `module = 'COMERCIAL'` + `opportunityId`.

Serviços em `apps/web/src/server/services/crm/*` e rotas em `/api/comercial/*` (permissões `crm.read`, `crm.write`, `crm.manage`).
Regras: "Ganho" só pelas ações da oportunidade (nunca arrastando no Kanban); a formalização cria o contrato em **rascunho** e só o ativa com
confirmação explícita (`activate`), opcionalmente criando o alarme de emissão; oportunidade formalizada não pode ser perdida/reaberta/excluída;
"parada" = sem movimentação há mais dias que o SLA da etapa (ou `crm.stalledDays`), notificada 1×/semana pelo cron diário
(`OPPORTUNITY_STALLED`). O dashboard comercial é calculado a partir das oportunidades e nunca é apresentado como receita confirmada.

## 6c. Gestão de Contratos (Fase 3)

`contracts` ganhou `opportunityId`, `tenderId`, `partnerId` (FK na Fase 4), `renewalNoticeDays`, `activatedAt`, `terminatedAt`,
`terminationReason`; `contract_amendments` ganhou `adjustmentIndex`/`adjustmentPercent` e os tipos `ADJUSTMENT` (reajuste) e `EXTENSION`
(prorrogação). Nova tabela `contract_renewals` (uma por contrato/vigência).

Ciclo de vida (`services/contracts.ts`): rascunho → `activate` (confirmação explícita; opcionalmente cria o alarme de emissão) → ativo →
`adjust` (reajuste com índice e percentual informados pelo usuário, nunca consultado automaticamente; vira aditivo e passa a valer na conta
corrente a partir da competência) → `terminate` (encerramento com data e motivo; cancela renovações e tarefas abertas).
`financialStatus` apresenta PREVISTO (contrato), FATURADO, RECEBIDO e PENDENTE (Financeiro) sempre separados, por exercício.

Renovações (`services/renewals.ts`): o cron diário (`detectRenewals`) abre a renovação quando a vigência entra na janela
(`contracts.renewalDays`, padrão 90, ou `renewalNoticeDays` do contrato), criando uma oportunidade (origem RENOVACAO) e uma tarefa RENEWAL;
idempotente por `(contractId, endDate)`. A decisão é humana (`decide`): RENEWED fecha a oportunidade como ganha e conclui a tarefa;
NOT_RENEWED marca perdida e cancela. Nenhum aditivo é criado automaticamente.

Menu: Dashboard | Comercial | Entidades | Contratos | Financeiro (hub `/financeiro/central`) | Relatórios | Administração.

## 6d. Parceiros e Comissões (Fase 4)

Tabelas `partners`, `commission_rules`, `commissions` (todas com `organizationId`); `entities.partnerId`, `contracts.partnerId` e
`opportunities.partnerId` ganharam FK para `partners`. Permissões `partners.read`, `partners.manage` e `partners.portal` (papel PARCEIRO:
só o portal, com os dados do parceiro ligado ao próprio usuário via `Partner.userId`).

Motor (`services/commissions.ts#recompute`): idempotente, uma comissão por (regra, nota) garantida por unicidade no banco. Regra RECEIVED
usa o valor recebido (`paidAmount`, cobre pagamento parcial); INVOICED usa o valor da nota. Situações: FORECAST (nota emitida, não paga) →
DUE (recebimento confirmado) → PAID (registro manual do pagamento ao parceiro, auditado). Nota cancelada/volta a pendente: FORECAST é removida,
DUE/PAID viram REVERSED (estorno a compensar quando já paga). O recálculo roda após alteração manual, lote, conflito resolvido, exclusão,
sincronização (por entidade) e no cron diário. O Financeiro continua sendo a única fonte dos valores.

## 6e. Licitações (Fase 5)

Tabelas `tenders` (única por `organizationId + officialId`, o número de controle do PNCP), `tender_deadlines`, `tender_competitors`,
`tender_checklist_items` (opcionalmente ligados a `certificates`/`documents`) e `tender_events`; `documents.tenderId` (tipo `TENDER`),
`contracts.tenderId` e `financial_tasks.tenderId`. Permissões `tenders.read` e `tenders.write` (papel COMERCIAL recebe ambas).
Situações: IDENTIFIED → ANALYZING → PREPARING → SUBMITTED → IN_SESSION → WON/LOST → HOMOLOGATED (ou CANCELLED/DESERTED/NOT_PARTICIPATING).

Regras (`services/tenders.ts`): ao criar, prazos padrão (proposta e sessão) e checklist padrão (certidões ativas da empresa + itens fixos);
o status de cada certidão do checklist é calculado na data da sessão (válida / vence em breve / vencida / sem validade) e bloqueia a
habilitação quando vencida. Mudar a situação reflete na oportunidade ligada (ganha/perdida). Formalizar (WON/HOMOLOGATED) cria o contrato
em RASCUNHO com `tenderId` (ativação continua manual, na ficha do contrato); uma licitação gera no máximo um contrato. Exclusão é lógica
e libera o identificador oficial. Importações (PNCP por UF/período/modalidade — consulta pública somente leitura — e planilha) são
idempotentes pelo identificador oficial e, no PNCP, o órgão vira entidade LEAD quando não existe. Cron diário: alertas `TENDER_DEADLINE`
N dias antes (`tenders.alertDays`, padrão 3) e para vencidos, um por prazo por dia. Datas/horas de prazos são interpretadas no horário de Brasília.

A extensão de tenant passou a **mesclar** filtros já informados na relação com o pai (ex.: `tender: { deletedAt: null }`) em vez de
substituí-los — correção que vale para todos os modelos filhos.

## 6f. Atendimento (Fase 6)

Tabelas `tickets` (número sequencial único por organização), `ticket_interactions`, `campaigns`, `campaign_recipients`; `documents.ticketId`
(tipo `TICKET`), `outbound_messages.ticketId` e FK de `financial_tasks.ticketId` (tarefas de acompanhamento na agenda única, módulo
ATENDIMENTO). Permissões `tickets.read`, `tickets.write`, `tickets.manage` (campanhas, exclusão); papel ATENDIMENTO; COMERCIAL recebe
leitura/escrita de chamados. Situações: OPEN → IN_PROGRESS ⇄ WAITING_CLIENT/WAITING_INTERNAL → RESOLVED → CLOSED (ou CANCELLED).

Regras (`services/tickets.ts`): SLA em horas corridas por prioridade (`tickets.sla`, padrão urgente 2h/8h, alta 4h/24h, média 8h/72h,
baixa 24h/120h) calculado na abertura e recalculado ao mudar a prioridade; a primeira interação de saída (resposta, envio por
WhatsApp/e-mail) marca a 1ª resposta; estados de SLA OK / em risco (últimas 2h ou metade do prazo) / estourado / cumprido. Interações
registram notas internas, respostas, ligações, visitas (duração, local) e reuniões (ata, participantes); resposta com `sendVia` usa o
serviço de mensagens existente (provedor ou link manual) e grava `outbound_messages.ticketId`. Atribuir tira de OPEN; interação de saída
tira de "aguardando interno"; interação recebida tira de "aguardando cliente". Resolver gera um token público de avaliação
(`/avaliacao/<token>`, nota 1–5 uma única vez). Cron diário: notificações `TICKET_SLA` por chamado/dia (estourado ou em risco), para o
responsável ou a equipe. Exclusão é lógica.

Campanhas (`services/campaigns.ts`): público resolvido no momento da criação (tipo/UF/ciclo de vida derivado/contrato ativo/contato
principal ou financeiro, ou lista de entidades) em destinatários pendentes; o envio processa até 50 pendentes por chamada, reutilizando
modelos/variáveis e o provedor configurado; sem provedor, cada destinatário fica "envio manual" com link wa.me/mailto. Repetir o envio
é idempotente (só pendentes). Ficha 360º: aba "Atendimento" e eventos ATENDIMENTO na linha do tempo.

## 6g. Relatórios e BI (Fase 7)

Sem tabelas novas: Relatórios só consultam. `services/bi.ts#executive` monta o painel executivo (carteira por ciclo de vida derivado,
receita prevista × faturada × recebida por competência, contratos a vencer e renovações, funil/conversão/metas, licitações e taxa de
vitória, atendimento/SLA/satisfação, comissões e parceiros, saúde da carteira, resultados por município/UF) com filtros de período, UF,
município, entidade, responsável e parceiro. `services/reports-bi.ts` adiciona 15 relatórios ao catálogo existente (carteira, região,
saúde, oportunidades, conversão, funil, receita prevista × real, renovações, licitações, taxa de vitória, metas, comissões, parceiros,
chamados, SLA) reaproveitando os exportadores PDF/XLSX/CSV e a auditoria de exportação. Cada relatório declara `group` (módulo) e
`nature`: CONFIRMED (fatos: notas, recebimentos, contratos), PROJECTION (receita prevista, funil), CALCULATED (taxas, médias) ou MIXED;
a natureza aparece na central de relatórios, no rodapé do PDF e no painel. Menu "Dashboard" → `/dashboard` (Executivo) com atalhos para
Comercial (`/comercial`) e Financeiro (`/financeiro`). Gráfico de receita em SVG próprio (sem biblioteca), paleta validada para daltonismo
e contraste nos dois temas, com legenda, tooltip e alternância para tabela.

## 6h. Integrações externas (Fase 8)

Tabelas `integrations` (uma por organização e chave: WHATSAPP, EMAIL, SIGNATURE, CNPJ, IBGE, PNCP, COMPRASGOV; `config` não sensível,
`secrets` cifrados com AES-256-GCM pela chave `INTEGRATION_SECRET_KEY` ou derivada de `JWT_ACCESS_SECRET`, estado, último teste,
falhas consecutivas e circuito), `integration_logs` (cada chamada externa com ação, tentativa, duração, requisição/resposta sem segredos,
erro e referência), `webhooks` (assinaturas de saída com segredo cifrado e eventos) e `webhook_deliveries` (uma entrega por webhook e
evento, idempotente). `services/integrations.ts#resolve` devolve a configuração efetiva: banco → variáveis de ambiente → padrão público;
adaptadores (`messaging/adapters.ts`, `integrations/clicksign.ts`, provedores CNPJ/IBGE/PNCP/Compras.gov em `@siow/integrations`) só
consomem essa configuração. `call()` cronometra, registra e contabiliza falhas: 5 seguidas abrem o circuito por 15 minutos e o fluxo cai
para o modo manual (wa.me/mailto, upload da OS assinada). Teste de conexão por integração sem efeitos colaterais.

Webhooks de saída (`services/webhooks.ts`): `emit(evento, payload)` nos serviços (chamado aberto/resolvido, oportunidade ganha/perdida,
contrato ativado, nota paga, situação da licitação, campanha concluída) enfileira entregas e tenta na hora; o cron
`/api/cron/integracoes` reenvia pendentes (1, 5, 15, 60, 180 min) e consulta assinaturas em aberto. Cabeçalhos `X-Siow-Event`,
`X-Siow-Delivery`, `X-Siow-Timestamp` e `X-Siow-Signature` (HMAC-SHA256 de `timestamp.body`). Entrada: `/api/webhooks/whatsapp`
(verificação por verify token, assinatura `X-Hub-Signature-256` quando há app secret, status de entrega → mensagens enviadas, mensagens
recebidas → notificação e chamado no Atendimento, idempotente por id da mensagem) e `/api/webhooks/signature/clicksign` (HMAC opcional →
status da solicitação; SIGNED baixa o documento e conclui a OS). Assinatura eletrônica: `sendForSignature` envia a OS ao provedor e cria
`SignatureRequest` SENT; nunca marca assinada sem confirmação. Consulta de CNPJ (BrasilAPI) e municípios do IBGE preenchem o cadastro;
Compras.gov.br (dados abertos, Lei 14.133) é fonte alternativa ao PNCP no importador de licitações (modalidades mapeadas: 4→3, 6→5, 8→6, 9→7).

## 6i. Central de atendimento WhatsApp (Fase 6b)

Tabelas `wa_conversations` (uma por número e organização: contato/entidade/chamado ligados, atendente, não lidas, última entrada/saída,
janela de 24h derivada de `lastInboundAt`) e `wa_messages` (direção, tipo, corpo, mídia baixada como documento, status de entrega,
id do provedor único — idempotência). `services/whatsapp.ts`: ingestão do webhook (mensagem → conversa, chamado do Atendimento — um por
conversa aberta, reabertura cria outro —, interação, notificação, download de mídia pela Graph API), distribuição automática entre
usuários com `tickets.write` (menos conversas abertas primeiro; `whatsapp.autoAssign` e `whatsapp.maxPerAgent`), envio de texto só com
a janela aberta, modelos aprovados lidos da conta (`wabaId` na integração) e enviados com parâmetros fora da janela, status de entrega
(sent/delivered/read/failed) aplicados às mensagens e às `outbound_messages`, encerrar (resolve o chamado), reabrir, vincular número
desconhecido a um contato, iniciar conversa com contato cadastrado. Tudo passa pelo adapter com log e circuito; mensagem só fica SENT
com confirmação da Meta. Interface `/atendimento/whatsapp`: caixa de entrada com filtros (todas, minhas, sem atendente, não lidas,
encerradas), atualização automática a cada 5 s, conversa em balões com status, compositor de texto ou modelo, atribuição e encerramento.

## 6j. SaaS e white-label (Fase 9)

**Isolamento das configurações** — `Setting` passou a ser por organização (chave composta `organizationId + key`); o seed cria o conjunto padrão em cada organização nova e as leituras usam o filtro de tenant (`findFirst`). A organização padrão (Siow, Edição Própria) manteve todas as chaves existentes.

**Plataforma** — `PlatformAdmin` (superadmin Siow) com login próprio (`/plataforma/login` → `POST /api/platform/auth/login`, JWT tipo `platform` em cookie HttpOnly `siow_platform`, 8 h). As rotas `/api/platform/*` usam `platformRoute()` (`server/platform-auth.ts`) e rodam em modo plataforma (sem tenant), auditadas com `organizationId` da organização afetada e `justification = plataforma:<e-mail>`. Console em `/plataforma`: visão geral (MRR, faturas vencidas), organizações (onboarding em 3 passos: empresa → plano → administrador; dados/limites/módulos/situação; assinatura; faturas; uso e exportação), planos, faturas e configurações (autocadastro, senha).

**Planos e licenciamento** — `Plan` (chave, mensalidade, `maxUsers`, `maxEntities`, `modules`, dias de teste, público). Módulos: `MODULES` em `@siow/shared` (núcleo sempre liberado: CADASTRO, FINANCEIRO, CONTRATOS). `server/access.ts` resolve o acesso efetivo de uma organização (plano ∩ restrições da organização, limites da organização sobrescrevem o plano, `readOnly`) com cache de 30 s; `route()` em `http.ts` bloqueia o módulo não licenciado por prefixo de rota (403) e qualquer mutação em organização em somente leitura (423, exceto `/api/auth`). `/api/auth/me` devolve `access` (módulos, limites, situação) e o menu esconde os módulos não licenciados; `users.create` e `entities.create` aplicam os limites. Planos semeados: PROPRIA (isento, sem limites), SAAS_BASICO, SAAS_PRO.

**Assinaturas e cobrança** — `Subscription` por organização (TRIAL → ACTIVE → PAST_DUE → BLOCKED → ACTIVE; EXEMPT para a Siow/planos gratuitos; CANCELLED) e `SubscriptionInvoice` (uma por período `AAAA-MM`, vencimento no `billingDay`). Rotina `runBilling()` (cron `GET /api/cron/platform`, diário 09:30 UTC, ou botão "Executar cobrança"): encerra testes vencidos, gera a fatura do mês (idempotente), marca vencidas (PAST_DUE) e, após a carência (`graceDays`), aplica o **bloqueio suave** (BLOCKED → organização READONLY, com motivo exibido em faixa; leitura liberada). Registrar o pagamento (manual, pela plataforma) reativa a organização quando não restam faturas vencidas. A organização padrão nunca é bloqueada nem removida. Nada é apagado: remoção de organização é lógica e só sem dados de negócio.

**White-label** — `Organization.branding` (`productName`, `tagline`, `logoUrl`, `accent`, `accent2`, `supportEmail`) e `Organization.domain`. `GET /api/public/branding?host=` resolve a marca pelo domínio (login/cadastro); após o login a marca da organização do usuário prevalece (`lib/branding.tsx` aplica as variáveis CSS do tema e o título). Aba **Marca e plano** em Administração: logotipo por upload (Vercel Blob), cores, textos, situação do plano e exportação LGPD.

**Chaves de API** — `ApiKey` por organização (`sk_<prefixo>_<segredo>`; só o SHA-256 é guardado; permissões ⊆ do criador e recalculadas a cada uso). `route()` aceita `Authorization: Bearer sk_…` como usuário sintético da organização (CSRF não se aplica a bearer). Gerência na aba **Chaves de API** (`/api/settings/api-keys`).

**Onboarding e autocadastro** — `POST /api/public/signup` + página `/cadastro`, habilitado pela configuração de plataforma `platform.selfSignup` (plano padrão `platform.defaultPlan`, só planos públicos); cria a organização em teste gratuito pelo prazo do plano.

**LGPD / portabilidade** — `GET /api/settings/export` (organização, exige `settings.manage` + `audit.read`, auditado como EXPORT) e `GET /api/platform/organizations/[id]/export` devolvem JSON completo (`siow-export/v1`) da organização: usuários (sem hashes), entidades, contratos, notas, cobranças, OS, certidões, oportunidades, licitações, chamados, campanhas, parceiros, tarefas, configurações, documentos (metadados) e WhatsApp.

## 6k. Homologação e proteção de rotas públicas (Fase 10)

`server/rate-limit.ts` aplica limite por chave (IP e/ou e-mail) nas rotas públicas: login, refresh, login da plataforma, autocadastro e avaliação pública (429 com `Retry-After`; janela deslizante em memória por instância). Logins da plataforma são auditados (`PLATFORM_LOGIN`/`PLATFORM_LOGIN_FAILED`). Testes unitários em `apps/web/src/server/*.test.ts` (vitest) cobrem o limite e o licenciamento por rota. O roteiro `scripts/homologacao.sh` e o checklist de go-live estão em `docs/HOMOLOGACAO.md`; manuais em `docs/MANUAL-USUARIO.md` e `docs/MANUAL-ADMINISTRADOR.md`.

## 6l. Pós-homologação (Fase 11): 2FA, limite compartilhado, retenção e e-mails da plataforma

- **2FA (TOTP)** — `server/totp.ts` (RFC 6238, sem dependências) e `services/mfa.ts`: segredo cifrado em `User.totpSecret`/`PlatformAdmin.totpSecret`, ativado com um código válido (`totpEnabledAt`). Login com 2FA ativo devolve `{ mfaRequired, mfaToken }` (JWT tipo `mfa`, 5 min, sem sessão) e `POST /api/auth/mfa` (ou `/api/platform/auth/mfa`) conclui com o código. Gerência em "Senha" (usuário) e Configurações da plataforma; administrador pode redefinir o 2FA de um usuário (`POST /api/users/[id]/mfa-reset`, auditado).
- **Limite de requisições compartilhado** — tabela `rate_limits` (janela fixa por chave, upsert atômico) usada por todas as instâncias; cai para memória se o banco falhar. Limpeza diária no cron.
- **Retenção** — `services/retention.ts` no cron diário: remove `sync_runs` concluídos com mais de `sync.retentionDays` (180, mantendo a última execução de cada fonte e todas as falhas), sessões encerradas há 30 dias e notificações lidas há 90 dias.
- **E-mails da plataforma** — `services/platform-mail.ts`: boas-vindas, fatura emitida, fatura vencida, bloqueio e reativação, enviados pelo provedor de e-mail da organização Siow aos administradores da organização; melhor esforço, nunca simulado.

## 6m. Assistente virtual (Fase 12)

- **O que é** — página `/assistente` (menu "Assistente", qualquer usuário autenticado) com um chat em que o usuário pede em linguagem natural ("cadastre a Prefeitura de X", "crie um contrato para a Câmara de Y", "abra uma oportunidade…") e o agente executa no sistema. Rota `POST /api/assistente` (`maxDuration` 300 s, limite de 60 turnos/hora por usuário) e `GET /api/assistente` (configurado? modelo?).
- **Como executa** — `services/assistant.ts` roda um agente Claude (`@anthropic-ai/sdk`, tool runner, modelo `claude-opus-5-5` por padrão, `ASSISTANT_MODEL` para trocar) com UMA ferramenta: `chamar_api` (método, caminho relativo a `/api`, query, corpo, motivo). Toda ação vira uma chamada HTTP à própria API, na mesma origem, com os cookies do usuário — portanto valem exatamente as mesmas regras de sempre: autenticação, permissões, isolamento por organização (`runWithOrg` + `assertTenantRefs`), licenciamento de módulos, modo somente leitura e trilha de auditoria. O assistente não acessa o banco diretamente e nunca invoca rotas de autenticação, plataforma, cron, webhooks, upload nem a si mesmo (`BLOCKED`).
- **Confirmação de ações sensíveis** — exclusões, alterações de notas fiscais, envio de mensagens/campanhas/assinatura, sincronização geral, fechamento/formalização de oportunidades e licitações, pagamento de comissões, administração (usuários, perfis, configurações, integrações) e importações em lote (`SENSITIVE`). A ferramenta não executa: devolve `AGUARDANDO_CONFIRMACAO` e a rota entrega ao front uma ação pendente com token HMAC‑SHA256 (`JWT_ACCESS_SECRET`, usuário + método + caminho + corpo canônico). O usuário clica "Confirmar e executar"; o servidor recomputa o token, executa a ação **sem passar pelo modelo** (`executeApproved`) e informa o resultado ao agente na mensagem seguinte. O modelo não consegue forjar nem alterar a ação confirmada.
- **Auditoria** — cada chamada mutante executada pelo agente gera `assistant.call` (ou `assistant.confirmed`) em `audit_logs`, além da auditoria normal da rota chamada.
- **Contexto do modelo** — prompt de sistema em pt-BR com data, usuário, organização, módulos e permissões, regras (consultar antes de agir, não duplicar, não inventar dados, Financeiro é a fonte oficial) e o catálogo resumido da API (`API_CATALOG`), com cache de prompt. Resultados grandes são cortados por itens mantendo JSON válido. Histórico: o front envia só os textos das mensagens (até 40 turnos); resultados de ferramentas não são reenviados.
- **Configuração** — `ANTHROPIC_API_KEY` (obrigatória para ativar; sem ela a tela avisa "não configurado" e a rota responde 503) e `ASSISTANT_MODEL` (opcional). Testes: `src/server/assistant.test.ts` (classificação de ações sensíveis, token, catálogo).

## 6n. Assistente por voz e histórico de conversas (Fase 13)

- **Ditado por voz** — `components/assistant/voice-input.tsx`. Dois modos, escolhidos automaticamente: (1) **provedor no servidor** quando a integração `SPEECH` está configurada: grava com `MediaRecorder` (webm/opus, mp4 no Safari), envia a `POST /api/assistente/transcrever` (multipart `audio`, ≤15 MB, 120/h por usuário) e o texto volta para a caixa de mensagem para conferência antes do envio; (2) **reconhecimento do navegador** (Web Speech API, pt-BR, Chrome/Edge) sem custo quando não há provedor. Sem nenhum dos dois, o botão não aparece e a tela orienta.
- **Integração `SPEECH`** (`services/integrations.ts`, provedor `whisper`): qualquer API compatível com Whisper (OpenAI `https://api.openai.com/v1`, Groq `https://api.groq.com/openai/v1`…), campos `apiUrl`, `apiKey` (cifrado), `model`. `services/speech.ts` faz a chamada (`/audio/transcriptions`, `language=pt`, `verbose_json`) com log, circuit breaker e teste de conexão (`GET /models`). Falha do provedor → 502 com a mensagem dele.
- **Áudios do WhatsApp** — em `whatsapp.ts#ingestInbound`, mensagens `audio` são transcritas quando a integração está ativa; o texto (prefixo 🎙️) vai para a mensagem, a interação do chamado, a prévia da conversa e a notificação. O anexo original continua guardado como documento.
- **Leitura em voz alta** — opcional ("Ler respostas"), com a síntese de voz do navegador (pt-BR), sem provedor; preferência salva no navegador.
- **Histórico** — tabela `assistant_conversations` (tenant; `userId`, `title`, `messages` JSONB com turnos, passos e pendências, `messageCount`). `POST /api/assistente` recebe `conversationId` (opcional) e `inputMode` (`text|voice`) e salva o turno; `GET /api/assistente/conversas` lista as do usuário, `GET/DELETE /api/assistente/conversas/[id]` abre/exclui (exclusão lógica, auditada). Só o próprio usuário vê as suas conversas. Retenção no cron diário: excluídas há mais de 30 dias ou sem atividade há `sync.retentionDays`.

## 7. Mensageria e assinatura

- `MessageAdapter` (WhatsApp Cloud API, SMTP). Sem credenciais configuradas → mensagem fica `MANUAL_PENDING`
  com link `wa.me`/`mailto`, e só passa a "enviada" quando o usuário confirma. Nunca simula envio.
- `SignatureProvider` (interface): MVP = `MANUAL_UPLOAD` (OS assinada, signatários, checksum, auditoria).
  Provedores (Clicksign, DocuSign, gov.br) implementam `createRequest/getStatus/downloadSigned/parseWebhook`.

## 8. Como um novo módulo entra na plataforma

1. Modelos no `schema.prisma` (prefixo/área própria) + migration.
2. `apps/api/src/modules/<modulo>/` com um `<Modulo>Module` importado no `AppModule`; permissões novas no seed.
3. Rotas em `apps/web/src/app/(app)/<modulo>/`; item no menu com a permissão correspondente.
4. Se precisar de background: fila nova em `@siow/queue` e worker em `apps/worker`.

## 9. Decisões e trade-offs

- **Runtime TS via SWC** (`@swc-node/register`) na API e worker: decorators do NestJS exigem `emitDecoratorMetadata`,
  que o `tsx`/esbuild não suporta. Um passo de bundling (tsup/nest build) pode ser adicionado para produção.
- **Agregações do dashboard em memória** sobre a seleção filtrada de notas (poucas dezenas de milhares de linhas):
  simples e correto; se crescer, migrar para views materializadas.
- **Certidões são da empresa** (a mesma lista aparece em todas as entidades): modeladas com `entityId = null`;
  o modelo permite certidões específicas por entidade no futuro.
