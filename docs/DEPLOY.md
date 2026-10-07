# Deploy em produção — Siow System

Este guia descreve o deploy da plataforma em um servidor único (VPS) usando
Docker Compose, com TLS automático via Caddy. Todos os comandos são executados
na **raiz do repositório** no servidor.

## 1. Pré-requisitos

- VPS Linux (Ubuntu 22.04/24.04 recomendado) com **2 vCPU / 4 GB RAM** no mínimo
  e disco suficiente para banco + documentos (PDFs de notas e certidões).
- **Docker Engine ≥ 24** e **Docker Compose v2** (`docker compose version`).
- Um **domínio** (ex.: `financeiro.suaempresa.com.br`) com registro DNS `A`/`AAAA`
  apontando para o IP do servidor. As portas **80 e 443** devem estar liberadas
  no firewall (o Caddy emite e renova o certificado Let's Encrypt automaticamente).
- Git instalado no servidor.
- No repositório devem estar commitados:
  - `pnpm-lock.yaml` (as imagens usam `pnpm install --frozen-lockfile`);
  - `packages/db/prisma/migrations/` (gerado com `pnpm db:migrate` em desenvolvimento;
    em produção só roda `prisma migrate deploy`).

## 2. Primeira instalação

```bash
# 1) Código
git clone <url-do-repositorio> siow-system
cd siow-system

# 2) Variáveis de ambiente (arquivo único, na raiz)
cp .env.production.example .env
nano .env
```

Preencha **todos** os campos marcados com `TROQUE-...`. Gere segredos fortes com:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD, S3_SECRET_KEY
openssl rand -base64 24   # S3_ACCESS_KEY
```

Campos essenciais:

| Variável | Valor |
| --- | --- |
| `DOMAIN` | domínio público (sem `https://`) |
| `POSTGRES_*`, `REDIS_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | segredos gerados |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | segredos gerados (≥ 32 caracteres) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | primeiro administrador (senha com **≥ 12 caracteres** — o seed recusa senha fraca/ausente em produção) |
| `COOKIE_SECURE` | `true` |

`DATABASE_URL`, `REDIS_URL` e `S3_ENDPOINT` são montados automaticamente pelo
compose apontando para os serviços internos (`postgres`, `redis`, `minio`), que
**não publicam portas** no host.

```bash
# 3) Build das imagens e subida de tudo
docker compose -f infra/docker-compose.prod.yml build
docker compose -f infra/docker-compose.prod.yml up -d

# 4) Acompanhar
docker compose -f infra/docker-compose.prod.yml ps
docker compose -f infra/docker-compose.prod.yml logs -f migrate api worker
```

Ordem de subida: `postgres`/`redis`/`minio` → `migrate` (one-shot: `prisma migrate deploy`
+ seed idempotente) → `api` e `worker` → `web` → `caddy`. O `api` tem healthcheck em
`/api/health`; o `web` só sobe depois do `api` saudável.

### Primeiro acesso

1. Abra `https://SEU_DOMINIO` e entre com `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
2. O administrador é criado com **troca de senha obrigatória** (`mustChangePassword`).
   Vá em *Conta → Alterar senha* imediatamente; a troca invalida as demais sessões.
3. Remova `SEED_ADMIN_PASSWORD` do `.env` após o primeiro acesso (o seed nunca
   altera um usuário que já existe).
4. Cadastre as entidades e fontes de dados (ou importe o CSV/XLSX) e dispare
   uma sincronização em *Sincronização → Sincronizar tudo*.

## 3. Backups

### Banco de dados (diário, `pg_dump`)

Crie `/opt/siow/backup-db.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /caminho/para/siow-system
set -a; source .env; set +a
DEST=/var/backups/siow
mkdir -p "$DEST"
STAMP=$(date +%F_%H%M)
docker compose -f infra/docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DEST/siow_$STAMP.dump"
# mantém 30 dias
find "$DEST" -name 'siow_*.dump' -mtime +30 -delete
```

```bash
chmod +x /opt/siow/backup-db.sh
# cron: todo dia às 02:30
( crontab -l 2>/dev/null; echo "30 2 * * * /opt/siow/backup-db.sh >> /var/log/siow-backup.log 2>&1" ) | crontab -
```

Copie os dumps para fora do servidor (rclone/S3/outro host). Restauração:

```bash
docker compose -f infra/docker-compose.prod.yml stop api worker
docker compose -f infra/docker-compose.prod.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < /var/backups/siow/siow_XXXX.dump
docker compose -f infra/docker-compose.prod.yml start api worker
```

### Documentos (MinIO)

O serviço `minio-init` ativa o **versionamento** do bucket (`mc version enable`), então
um objeto sobrescrito ou apagado pode ser recuperado. Além disso, faça cópia periódica
do volume `minio-data` (ou espelhe o bucket com `mc mirror` para outro destino):

```bash
docker run --rm -v siow-system-prod_minio-data:/data -v /var/backups/siow:/backup alpine \
  tar czf /backup/minio_$(date +%F).tgz -C /data .
```

### Redis

Redis guarda apenas filas (jobs de sincronização/documentos), com `appendonly`
ativado no volume `redis-data`. Perder o Redis não perde dados de negócio — as
sincronizações são reagendadas.

## 4. Atualizações

```bash
cd /caminho/para/siow-system
git pull
docker compose -f infra/docker-compose.prod.yml build
docker compose -f infra/docker-compose.prod.yml up -d
docker compose -f infra/docker-compose.prod.yml logs -f migrate
```

O serviço `migrate` aplica as migrations novas (`prisma migrate deploy`) e roda o
seed (idempotente: cria permissões/papéis novos, nunca altera usuários existentes).
`api`/`worker`/`web` só reiniciam depois que `migrate` termina com sucesso.

Recomendação: **faça um backup do banco antes** (`/opt/siow/backup-db.sh`) sempre
que a atualização incluir migrations.

Para limpar imagens antigas: `docker image prune -f`.

## 5. Rollback

1. Volte o código para a versão anterior (tag ou commit):
   ```bash
   git checkout <tag-ou-commit-anterior>
   docker compose -f infra/docker-compose.prod.yml build
   docker compose -f infra/docker-compose.prod.yml up -d
   ```
2. Se a versão nova incluiu **migrations** que a versão antiga não conhece, restaure o
   dump feito antes da atualização (seção 3) — o Prisma não desfaz migrations
   automaticamente.
3. Verifique `docker compose -f infra/docker-compose.prod.yml ps` e
   `https://SEU_DOMINIO/api/health`.

## 6. Operação do dia a dia

```bash
# status e logs
docker compose -f infra/docker-compose.prod.yml ps
docker compose -f infra/docker-compose.prod.yml logs -f --tail=200 api worker

# reiniciar um serviço
docker compose -f infra/docker-compose.prod.yml restart worker

# abrir o psql
docker compose -f infra/docker-compose.prod.yml exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

# parar tudo (dados ficam nos volumes)
docker compose -f infra/docker-compose.prod.yml down
```

Checklist de segurança:

- `.env` com permissão `600` e fora do controle de versão (já está no `.gitignore`).
- Apenas 22/80/443 abertas no firewall; Postgres, Redis e MinIO não têm portas publicadas.
- Segredos rotacionados quando alguém deixa a equipe (`JWT_*` invalida todas as sessões).
- Backups testados (restaure em um ambiente de teste periodicamente).
