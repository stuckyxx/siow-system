# Siow System

Plataforma modular da **Siow System Tecnologia**. Este repositório contém a plataforma
(autenticação, RBAC, auditoria, documentos, notificações, filas) e o primeiro módulo:

**Financeiro** — gestão de contratos e recebimentos de órgãos públicos (PM, CM, …):
sincronização automática com o Portal do Cliente, histórico financeiro, dashboard,
notas fiscais, contratos e conta corrente, certidões, agenda financeira, cobranças,
mensagens ao cliente, ordens de serviço, relatórios (PDF/XLSX/CSV) e auditoria.

Documentação da arquitetura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Stack

TypeScript estrito · Node 22/24 LTS · NestJS 11 · Prisma 6 · PostgreSQL 16 · Redis 7 + BullMQ ·
MinIO/S3 · Next.js 15 (App Router) · Tailwind CSS 4 · TanStack Query · Zod · pnpm workspaces.

## Rodando localmente

Pré-requisitos: Node ≥ 22, pnpm ≥ 9, Docker.

```bash
cp .env.example .env            # único .env, na RAIZ do repo (lido por api, worker e prisma)
pnpm install                    # também roda `prisma generate` (postinstall do @siow/db)
pnpm infra:up                   # Postgres, Redis, MinIO (+ bucket)
pnpm db:generate
pnpm db:migrate                 # cria o schema (prisma migrate dev --name init)
SEED_SAMPLE_ENTITIES=true pnpm db:seed   # papéis, permissões, admin, templates, configs (+2 entidades de teste)
pnpm dev                        # api :3001, web :3000, worker
```

Acesse http://localhost:3000 — usuário inicial `admin@empresa.com.br` / `Admin@12345`
(definidos em `SEED_ADMIN_*` no `.env`). Troque a senha no primeiro acesso.

Comandos úteis:

| Comando | Descrição |
|---|---|
| `pnpm dev:api` / `dev:web` / `dev:worker` | subir apenas um app |
| `pnpm typecheck` | `tsc --noEmit` em todos os pacotes |
| `pnpm test` | testes (parser do portal, utilidades) |
| `pnpm db:studio` | Prisma Studio |
| `pnpm infra:down` | derrubar a infraestrutura |

## Fluxo básico de uso

1. **Entidades → Nova entidade** (ou *Importar CSV/XLSX* com colunas `tipo, entidade, municipio, uf, url, nome_completo`).
2. **Sincronizar agora** na entidade (ou *Sincronizar todas* em Sincronização). O worker lê o portal,
   grava contratos, notas (com histórico), certidões, e aponta divergências para verificação.
3. Acompanhe no **Dashboard** (filtros globais), na **ficha da entidade** (abas), nas **Notas fiscais**
   (pendentes/pagas/todas, cobrança, alteração manual com justificativa), na **Agenda** e nos **Relatórios**.

## Estrutura

```
apps/api        NestJS — modules/platform/* e modules/financeiro/*
apps/worker     BullMQ — sync, documentos, verificações diárias, agendamentos
apps/web        Next.js — app/(app)/financeiro/*, admin, notificações
packages/db     Prisma schema + seed
packages/shared enums/rótulos, schemas Zod, tipos, utilidades
packages/integrations  BillingProvider + AssesiPortalProvider (HTTP + parser)
packages/sync-core     aplicação de snapshot com histórico/reconciliação/conflitos
packages/queue  filas e payloads
packages/storage S3 + DocumentStore (dedupe por checksum, URLs pré-assinadas)
infra/          docker-compose (Postgres, Redis, MinIO)
```

## Produção

Há duas formas de publicar. Para a maioria dos casos, a **opção 1** é a mais simples
(sem servidor, sem Docker, sem instalar nada):

### Opção 1 — Vercel + Neon + Vercel Blob (serverless)

Guia passo a passo para não desenvolvedores em **[docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md)**.

- A API e o worker rodam como Route Handlers do Next.js em `apps/web/src/app/api/**`
  (serviços em `apps/web/src/server/**`); não há NestJS, Redis nem BullMQ nesse modo.
- Banco: **Neon** (Postgres). Arquivos: **Vercel Blob**. Agendamentos: Vercel Cron
  (`apps/web/vercel.json`) e/ou GitHub Actions (`.github/workflows/sync-cron.yml`).
- Root Directory na Vercel: `apps/web`. Variáveis necessárias: `apps/web/.env.example`.
- Tabelas: `packages/db/prisma/schema.sql` no SQL Editor do Neon (ou `pnpm --filter @siow/web db:push`).
- Dados iniciais (papéis, permissões, admin): `POST /api/admin/bootstrap` com
  `Authorization: Bearer <CRON_SECRET>` — idempotente.

### Opção 2 — VPS com Docker Compose

Guia completo em **[docs/DEPLOY.md](docs/DEPLOY.md)** (Docker Compose, Caddy com TLS automático,
backups, atualização e rollback).

- Antes do primeiro deploy: gere as migrations com `pnpm db:migrate` (cria `packages/db/prisma/migrations`)
  e **commite a pasta de migrations e o `pnpm-lock.yaml`** — o CI e as imagens Docker usam
  `pnpm install --frozen-lockfile` e `prisma migrate deploy`.
- `NODE_ENV=production`, `COOKIE_SECURE=true`, TLS no proxy reverso, segredos fortes (`openssl rand -base64 48`).
- O seed em produção exige `SEED_ADMIN_PASSWORD` (≥ 12 caracteres) e cria o admin com troca de senha obrigatória.
- Imagens: `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile`; orquestração em
  `infra/docker-compose.prod.yml` (inclui serviço `migrate` one-shot: `prisma migrate deploy` + seed).
- Redis e Postgres com backup; bucket S3 privado (nunca público).

Em ambas: configure `WHATSAPP_*` / `SMTP_*` para envio automático — sem eles, as mensagens
ficam em modo de envio manual. Senhas usam **scrypt** (`packages/db/src/password.ts`), sem dependência nativa.
