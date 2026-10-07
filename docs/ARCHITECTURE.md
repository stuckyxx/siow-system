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
