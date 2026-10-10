# Publicando o Siow System na Vercel (com Neon e Vercel Blob)

## Migração da Netlify → Vercel (estado em 10/10/2026)

O sistema rodou na Netlify (https://siow-system.netlify.app) até a conta esgotar os créditos de build
do plano Free ("Skipped due to account credit usage exceeded"). A partir daqui a hospedagem é a Vercel.

**O que já está pronto no código** (branch `main`):

- `apps/web/vercel.json` com os crons de reserva (sync 03:00 UTC, diário 09:00 UTC); a Vercel envia o
  `CRON_SECRET` sozinha. `.github/workflows/sync-cron.yml` faz a sincronização a cada 20 min.
- Arquivos: `apps/web/src/server/storage.ts` usa o Vercel Blob quando `NETLIFY` não está definido.
- Removidos `netlify.toml` (raiz e `apps/web`) e as funções agendadas `apps/web/netlify/functions`.
- Script `apps/web/scripts/migrate-netlify-blobs.ts` copia os 15 PDFs que ficaram no Netlify Blobs
  (anexos de contrato e documentos capturados) para o Vercel Blob e atualiza `document_blobs.storageKey`.

**Nada muda no banco**: o Neon (projeto `dark-sound-41190359`) continua o mesmo; entidades, notas,
usuários, contratos e configurações já estão lá. Não rode `prisma migrate`/`db push`.

**Feito em 10/10/2026 pela sessão de migração** (conta Vercel `siowsystemtecnologia-5452`, plano Hobby):

- Projeto `siow-system` criado (`prj_LkMJb56K0fthq1RdzoQyHj1GI7I1`), Root Directory `apps/web`, Node 22, framework Next.js,
  *Include files outside root* ligado, Vercel Authentication desligada (senão o site exigiria login da Vercel).
- Blob store `siow-documentos` criado e conectado (`BLOB_READ_WRITE_TOKEN` automático).
- Variáveis cadastradas em Production/Preview: `DATABASE_URL`, `DIRECT_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `CRON_SECRET` (mesmos valores da Netlify), `COOKIE_SECURE`, `SYNC_BUDGET_MS`, `SYNC_CONCURRENCY`, `APP_URL`.
- Os 15 PDFs do Netlify Blobs foram copiados para o Vercel Blob e `document_blobs.storageKey` atualizado (0 restantes).
- **Pendente**: o deploy a partir do GitHub falhou com `git_info_fail` porque a conta Vercel **não tem o GitHub conectado**
  (repositório privado). Conecte em Vercel → Account Settings → Authentication → GitHub, instale o app Vercel no
  repositório `stuckyxx/siow-system` e, no projeto, Settings → Git → Connect. Depois o deploy sai de `main` automaticamente.
- URL de produção prevista: https://siow-system-siowsystemtecnologia-5452.vercel.app (`APP_URL` já aponta para ela).

**Passos da migração** (referência completa):

1. Passo 3 abaixo: importar `stuckyxx/siow-system` com Root Directory `apps/web` e
   "Include files outside of the Root Directory" ligado.
2. Passo 4: cadastrar as variáveis com os **mesmos valores** usados na Netlify: `DATABASE_URL`
   (pooler, com `pgbouncer=true&connect_timeout=15`, sem `channel_binding`), `DIRECT_URL`,
   `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`, `COOKIE_SECURE=true`,
   `SYNC_BUDGET_MS=45000`, `SYNC_CONCURRENCY=2`, `APP_URL=https://<novo endereço>`.
   Manter os segredos JWT iguais evita que todos precisem entrar de novo. Não precisa de
   `SEED_ADMIN_*` (os usuários já existem) nem de bootstrap (já foi feito).
3. Passo 6: criar o Blob store e conectar ao projeto (cria `BLOB_READ_WRITE_TOKEN`); Redeploy.
4. Migrar os arquivos, na raiz do repositório, enquanto o site da Netlify ainda responde:

   ```bash
   OLD_APP_URL=https://siow-system.netlify.app OLD_LOGIN_EMAIL=<admin> OLD_LOGIN_PASSWORD=<senha> \
   DATABASE_URL="<DATABASE_URL>" BLOB_READ_WRITE_TOKEN="<token do Blob>" pnpm --filter @siow/web migrate:blobs
   ```

   Pode repetir: só processa chaves que ainda começam com `netlify:`.
5. GitHub → Settings → Secrets and variables → Actions: `APP_URL` = novo endereço e `CRON_SECRET`
   (mesmo da Vercel); aba Actions → *Sync cron* → Enable workflow.
6. Validar: `GET <APP>/api/health` com `"db":"ok"`; login; Dashboard; CM Bom Lugar com 20 notas e
   7 pendentes (R$ 1.320); entidades Adois (PM Tuntum, PM Bom Jardim, PM/CM Icatú, CM Cururupu);
   Entidades → Importar entidade → "Baixar planilha do link"; aba Notas fiscais → "+ Nova nota".
7. Depois: apagar o site na Netlify (ou deixar parado) e, por segurança, trocar a senha do banco no
   Neon (ela foi colada em chat) atualizando `DATABASE_URL`/`DIRECT_URL` na Vercel + Redeploy.

Limites do Hobby que importam: funções de até 60 s (as rotas pesadas já declaram `maxDuration = 60`,
melhor que os 10 s da Netlify Free, que causavam timeouts) e cron 1x/dia (por isso o GitHub Actions).

---

Este guia é para quem **não é desenvolvedor** e quer colocar o sistema no ar sem
servidor próprio e sem instalar nada no computador. Tudo é feito pelo navegador.

O que vamos usar (todos têm plano gratuito para começar):

| Serviço | Para quê | Site |
|---|---|---|
| **GitHub** | guarda o código do sistema | https://github.com |
| **Neon** | banco de dados PostgreSQL | https://neon.tech |
| **Vercel** | hospeda o sistema (site + API) e roda as tarefas agendadas | https://vercel.com |
| **Vercel Blob** | guarda os arquivos (PDFs de notas, certidões, OS) | dentro da Vercel |

Tempo estimado: 30 a 40 minutos.

> Dica: abra um bloco de notas e vá colando nele os valores que você for copiando
> (connection strings, segredos). Você vai precisar deles no passo 4.

---

## 1. Código no GitHub

1. Crie uma conta no GitHub (se ainda não tem) e crie um repositório **privado**
   chamado, por exemplo, `siow-system`.
2. Envie o código do sistema para esse repositório (quem gerou o código pode fazer o
   `git push` por você). A partir daqui, **toda vez que o código for atualizado no
   GitHub, a Vercel publica a nova versão automaticamente** (ver passo 12).

## 2. Banco de dados no Neon

1. Entre em https://neon.tech e crie uma conta (pode usar a conta do GitHub).
2. Clique em **New Project**:
   - *Project name*: `siow-system`
   - *Postgres version*: a padrão (16 ou 17)
   - *Region*: **South America (São Paulo)** se aparecer; senão, **US East**.
3. Com o projeto criado, clique em **Connect** (ou no quadro *Connection string*).
4. Você vai copiar **duas** strings de conexão. Elas começam com `postgresql://`:
   - Marque a opção **Pooled connection** (ligada) e copie → esta é a `DATABASE_URL`.
     O endereço contém `-pooler` (ex.: `ep-xxxx-pooler.sa-east-1.aws.neon.tech`).
   - Desmarque **Pooled connection** e copie → esta é a `DIRECT_URL`.
     O endereço **não** tem `-pooler`.
5. Garanta que as duas terminam com `?sslmode=require`. Na `DATABASE_URL`, acrescente
   `&pgbouncer=true&connect_timeout=15` no final. Exemplo final:

   ```
   DATABASE_URL=postgresql://neondb_owner:SENHA@ep-xxxx-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=15
   DIRECT_URL=postgresql://neondb_owner:SENHA@ep-xxxx.sa-east-1.aws.neon.tech/neondb?sslmode=require
   ```

Guarde as duas no bloco de notas.

## 3. Projeto na Vercel

1. Entre em https://vercel.com e crie uma conta **com o GitHub**.
2. Clique em **Add New… → Project** e escolha o repositório `siow-system`
   (se não aparecer, clique em *Adjust GitHub App Permissions* e libere o repositório).
3. Na tela **Configure Project**:
   - **Framework Preset**: `Next.js` (detectado automaticamente).
   - **Root Directory**: clique em *Edit* e escolha **`apps/web`**.
   - Logo abaixo, marque **"Include files outside of the Root Directory in the Build Step"** (ligado).
     Isso é obrigatório: o código usa pacotes da pasta `packages/`.
   - **Build Command / Install Command**: deixe os padrões (a Vercel detecta o `pnpm`
     pelo campo `packageManager` do `package.json` da raiz).
4. **Ainda não clique em Deploy.** Abra a seção **Environment Variables** e siga o passo 4.

## 4. Variáveis de ambiente

Cada linha abaixo é uma variável: digite o **nome** no campo *Key* e o **valor** no
campo *Value* e clique em *Add*. A lista completa, com explicação, está em
[`apps/web/.env.example`](../apps/web/.env.example).

| Nome | Valor |
|---|---|
| `DATABASE_URL` | a string **pooled** do Neon (passo 2) |
| `DIRECT_URL` | a string **direta** do Neon (passo 2) |
| `JWT_ACCESS_SECRET` | um segredo aleatório com **pelo menos 32 caracteres** (veja abaixo como gerar) |
| `JWT_REFRESH_SECRET` | **outro** segredo aleatório (≥ 32 caracteres) |
| `CRON_SECRET` | outro segredo aleatório (≥ 16 caracteres). Protege os crons e o bootstrap |
| `COOKIE_SECURE` | `true` |
| `SYNC_BUDGET_MS` | `45000` |
| `SYNC_CONCURRENCY` | `2` |
| `SEED_ADMIN_EMAIL` | o e-mail do primeiro administrador (você) |
| `SEED_ADMIN_NAME` | o nome do administrador |
| `SEED_ADMIN_PASSWORD` | senha inicial com **pelo menos 12 caracteres** (será trocada no 1º login) |

Opcionais (só se for usar envio automático de mensagens): `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `WHATSAPP_API_URL`, `WHATSAPP_TOKEN`,
`WHATSAPP_PHONE_ID`. Sem eles, as mensagens ficam no modo "envio manual"
(o sistema prepara o texto e você envia pelo WhatsApp/e-mail).

**Como gerar segredos aleatórios sem instalar nada:** abra
https://generate-secret.vercel.app/48 — cada vez que a página recarrega, aparece um
valor novo. Use um valor diferente para cada segredo.

> `BLOB_READ_WRITE_TOKEN` será criado automaticamente no passo 6. Não precisa digitar.
> **Não** crie `NEXT_PUBLIC_API_URL`: a API roda no mesmo endereço do site.

Agora clique em **Deploy**. O primeiro build leva de 2 a 5 minutos.

## 5. Primeiro deploy

Quando terminar, a Vercel mostra **Congratulations** e o endereço do site, algo como
`https://siow-system.vercel.app`. Anote esse endereço — chamaremos de `<APP>` daqui em diante.

Abrir o site agora mostra a tela de login, mas o banco ainda está vazio. Continue.

Se o build **falhar**, abra o log (botão *View Build Logs*), copie as últimas linhas
em vermelho e peça ajuda com esse texto.

## 6. Armazenamento de arquivos (Vercel Blob)

1. No painel do projeto na Vercel, abra a aba **Storage**.
2. Clique em **Create Database** → escolha **Blob** → nome `siow-documentos` → *Create*.
3. Clique em **Connect Project**, escolha o projeto `siow-system` e todos os ambientes
   (Production, Preview, Development). Isso cria a variável `BLOB_READ_WRITE_TOKEN` sozinho.
4. Como a variável foi criada **depois** do deploy, é preciso publicar de novo:
   aba **Deployments** → nos três pontinhos do último deploy → **Redeploy** → confirme.

## 7. Criar as tabelas do banco

Você tem duas opções. A **opção A** não exige nada instalado.

### Opção A — SQL Editor do Neon (recomendada)

1. Abra o arquivo [`packages/db/prisma/schema.sql`](../packages/db/prisma/schema.sql)
   no GitHub, clique em **Raw**, selecione tudo (Ctrl+A) e copie (Ctrl+C).
2. No Neon, abra o projeto → menu **SQL Editor**.
3. Cole o conteúdo inteiro e clique em **Run**.
4. Deve aparecer uma mensagem de sucesso. O arquivo pode ser executado mais de uma vez
   sem problema (todos os comandos têm `IF NOT EXISTS`).
5. Para conferir: menu **Tables** — devem aparecer tabelas como `users`, `entities`,
   `invoices`, `contracts`, `audit_logs`.

### Opção B — `prisma db push` (para quem tem Node.js em alguma máquina)

```bash
pnpm install
cd apps/web
DATABASE_URL="<DIRECT_URL do Neon>" DIRECT_URL="<DIRECT_URL do Neon>" pnpm db:push
```

Use a string **direta** (sem `-pooler`) nas duas variáveis. Esta opção também serve
para aplicar alterações futuras do `schema.prisma`.

> O build na Vercel **nunca** altera o banco: ele só gera o cliente Prisma. Criar ou
> alterar tabelas é sempre uma ação sua, consciente, por uma das opções acima.

## 8. Inicializar o sistema (bootstrap)

Este passo cria as permissões, os 4 papéis (ADMINISTRADOR, FINANCEIRO, GESTOR,
CONSULTA), o seu usuário administrador, os modelos de mensagem e as configurações
padrão. É seguro repetir quantas vezes quiser.

É preciso fazer uma chamada `POST` ao endereço `<APP>/api/admin/bootstrap` enviando o
`CRON_SECRET`. Escolha **uma** das formas:

**Pelo navegador (sem instalar nada) — https://reqbin.com**

1. Abra https://reqbin.com.
2. Troque o método de `GET` para **POST**.
3. No campo de URL, digite `https://<APP>/api/admin/bootstrap`
   (ex.: `https://siow-system.vercel.app/api/admin/bootstrap`).
4. Clique na aba **Authorization** → tipo **Bearer Token** → cole o valor do seu `CRON_SECRET`.
   (Se preferir, aba **Headers**: nome `Authorization`, valor `Bearer SEU_CRON_SECRET`.)
5. Clique em **Send**. A resposta deve ser `"ok": true` com um resumo do que foi criado.

**No Windows (PowerShell)** — abra o menu Iniciar, digite *PowerShell*, cole e dê Enter:

```powershell
Invoke-WebRequest -Method POST -Uri "https://<APP>/api/admin/bootstrap" -Headers @{ Authorization = "Bearer SEU_CRON_SECRET" } | Select-Object -ExpandProperty Content
```

**No Mac/Linux (Terminal)**:

```bash
curl -X POST "https://<APP>/api/admin/bootstrap" -H "Authorization: Bearer SEU_CRON_SECRET"
```

Respostas possíveis:

| Resposta | O que significa |
|---|---|
| `"ok": true` | pronto; siga para o passo 9 |
| `401 Não autorizado` | o `CRON_SECRET` enviado é diferente do configurado na Vercel (ou a variável não existe — confira e faça *Redeploy*) |
| `"hint": "As tabelas ainda não existem…"` | volte ao passo 7 |
| `SEED_ADMIN_PASSWORD é obrigatório em produção` | defina `SEED_ADMIN_PASSWORD` com 12+ caracteres na Vercel, faça *Redeploy* e repita |

## 9. Primeiro acesso

1. Abra `https://<APP>` e entre com `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
2. O sistema vai pedir uma **nova senha** (mínimo 10 caracteres, com letra maiúscula,
   número e símbolo). Depois disso você cai no Dashboard.
3. Opcional: na Vercel, apague a variável `SEED_ADMIN_PASSWORD` (ela não é mais usada
   depois que o administrador existe).

## 10. Cadastrar a equipe e as entidades

- **Administração → Usuários → Novo usuário**: crie as pessoas da equipe escolhendo o papel.
  O botão **Redefinir senha** gera uma senha provisória (a pessoa troca no próximo login).
- **Administração → Configurações**: ajuste `company.name` (nome que aparece nas mensagens).
- **Entidades → Importar**: envie um CSV com as colunas
  `tipo;entidade;municipio;uf;url;nome_completo` (exemplo em
  [`docs/samples/entidades-exemplo.csv`](samples/entidades-exemplo.csv)). A coluna `url`
  é o link do Portal do Cliente de cada órgão. Também pode cadastrar uma a uma em **Nova entidade**.
- **Sincronização → Sincronizar todas as entidades** (ou *Sincronizar agora* dentro de uma
  entidade). Cada clique processa as fontes mais antigas dentro de ~45 segundos; com muitas
  entidades, clique mais de uma vez ou aguarde o cron.

## 11. Tarefas agendadas (crons)

O arquivo `apps/web/vercel.json` já agenda dois crons na Vercel, autenticados com o
`CRON_SECRET` automaticamente:

| Rota | Horário (UTC) | Função |
|---|---|---|
| `/api/cron/sync` | 03:00 (00:00 em Brasília) | sincroniza as fontes de dados |
| `/api/cron/daily` | 09:00 (06:00 em Brasília) | certidões/contratos vencendo, notas em atraso, tarefas do dia |

**Limitação do plano gratuito (Hobby):** crons rodam no máximo **1 vez por dia** — por
isso os horários acima. No plano **Pro** você pode trocar `0 3 * * *` por `0 */6 * * *`
(a cada 6 horas) no `vercel.json`.

**Alternativa gratuita para sincronizar a cada 6 horas — GitHub Actions:** o repositório
já inclui `.github/workflows/sync-cron.yml`. Para ativar:

1. No GitHub, abra o repositório → **Settings → Secrets and variables → Actions → New repository secret**.
2. Crie `APP_URL` com o valor `https://<APP>` (sem barra no final).
3. Crie `CRON_SECRET` com o **mesmo** valor configurado na Vercel.
4. Aba **Actions** → *Sync cron* → **Enable workflow** (se pedir). Você pode testar com **Run workflow**.

Você pode usar os dois (Vercel + GitHub Actions) ao mesmo tempo sem problema: a rota
sincroniza só o que estiver "vencido" e ignora o resto.

## 12. Domínio próprio (opcional)

Projeto na Vercel → **Settings → Domains → Add** → digite `financeiro.suaempresa.com.br`.
A Vercel mostra o registro DNS (`CNAME` apontando para `cname.vercel-dns.com`) para
criar no painel onde o domínio foi comprado. O certificado HTTPS é automático.
Se definiu `APP_URL`, atualize para o domínio novo e faça *Redeploy*.

## 13. Atualizando o sistema

- Toda alteração enviada ao GitHub (`git push` na branch principal) gera um novo deploy
  automaticamente em 2–5 minutos. Acompanhe em **Deployments**.
- Deu errado? Em **Deployments**, abra o deploy anterior que funcionava → *Promote to Production*
  (ou *Instant Rollback*).
- Se a atualização **mudou o banco** (`schema.prisma`), repita o passo 7 com o novo
  `schema.sql` (ou `pnpm db:push`) e depois o passo 8 (o bootstrap atualiza permissões novas).
- Variáveis de ambiente alteradas só valem depois de um *Redeploy*.

## 14. Problemas comuns

| Sintoma | Causa provável / solução |
|---|---|
| Login diz *Erro interno* | banco vazio ou `DATABASE_URL` errada → passos 7 e 8; confira `https://<APP>/api/health` (deve mostrar `"db": "ok"`) |
| *Variáveis de ambiente inválidas: JWT_ACCESS_SECRET…* | segredo com menos de 32 caracteres |
| Upload de documento falha com *BLOB_READ_WRITE_TOKEN não configurado* | passo 6 (conectar o Blob e fazer Redeploy) |
| Cron não roda | plano Hobby limita a 1x/dia; use o GitHub Actions (passo 11) |
| Sincronização "pulou" uma entidade (*SKIPPED*) | a fonte falhou várias vezes seguidas e está em pausa automática; abra a entidade e clique *Sincronizar agora* |
| Página em branco após login | limpe os cookies do site e entre de novo |

Para hospedar em servidor próprio (VPS com Docker), veja [`docs/DEPLOY.md`](DEPLOY.md).
