# Prompt de continuidade — Claude Code

Cole o texto abaixo como primeira mensagem no Claude Code, aberto na pasta `siow-system`
(a mais recente, descompactada do zip entregue no Cowork). Tudo o que ele precisa saber está
no repositório; este prompt só aponta onde.

---

Você está assumindo o projeto **Siow System — módulo Financeiro** no ponto em que ele parou.
Nada deve ser refeito do zero: o sistema já está construído e documentado neste repositório.
Antes de qualquer ação, leia nesta ordem:

1. `docs/PROMPT-MESTRE-v2.md` — a especificação completa e todas as decisões já validadas (regras de negócio, portal Assesi, modelo de dados, permissões, telas). É a fonte da verdade.
2. `docs/DEPLOY-VERCEL.md` — hospedagem atual (Vercel) e a migração a partir da Netlify; `docs/DEPLOY-NETLIFY.md` é histórico.
3. `docs/ARCHITECTURE.md` e `README.md` — estrutura do monorepo.
4. `docs/prototipo-siow-financeiro.html` — o protótipo aprovado pelo cliente (abra no navegador se quiser ver o comportamento esperado da interface; login `admin@siowsystem.com.br` / `Admin@12345` só no protótipo).

## Situação atual (não repetir o que já foi feito)

- **Código:** monorepo pnpm. O sistema de produção roda inteiro em `apps/web` (Next.js 15): a API NestJS (`apps/api`) e o worker (`apps/worker`) foram **portados** para Route Handlers em `apps/web/src/app/api/**` e serviços em `apps/web/src/server/**`. `apps/api` e `apps/worker` ficam no repositório apenas para a opção Docker/VPS; **não** os use para o deploy na Netlify.
- **Banco (Neon):** já criado e populado — projeto `siowsystem` (id `dark-sound-41190359`), 33 tabelas, trigger de auditoria, 30 permissões, 4 papéis, modelos de mensagem, configurações e o usuário admin. `packages/db/prisma/schema.sql` é o espelho do que está lá. **Não rode `prisma migrate`, `db push` nem seed** — apenas `prisma generate` (já incluído no `pnpm build` do web).
- **Netlify:** projeto `siow-system` (site id `0ae957d4-ff21-47c2-a755-17b1d2dcaae7`, URL https://siow-system.netlify.app) com todas as variáveis de ambiente definidas (DATABASE_URL, DIRECT_URL, JWT_*, CRON_SECRET, COOKIE_SECURE, SYNC_BUDGET_MS, SYNC_CONCURRENCY, APP_URL). Configuração em `apps/web/netlify.toml` (base directory `apps/web`), funções agendadas em `apps/web/netlify/functions/`, arquivos em Netlify Blobs (`apps/web/src/server/storage.ts`).
- **Senhas:** scrypt via `packages/db/src/password.ts` (não argon2).
- **Ainda não feito:** `pnpm install` nunca rodou (sem `pnpm-lock.yaml`); o código portado **nunca foi compilado**; o repositório ainda não foi enviado ao GitHub; o deploy ainda não aconteceu.

## O que fazer agora, nesta ordem

1. `corepack enable` e `pnpm install` na raiz. Commitar o `pnpm-lock.yaml` gerado.
2. `pnpm --filter @siow/web typecheck` e depois `pnpm --filter @siow/web build`. Corrija **todos** os erros de tipo/import/compilação em `apps/web` (e em `packages/*` se forem causa). Regras: manter o comportamento descrito no PROMPT-MESTRE; não trocar bibliotecas; não remover funcionalidades para "fazer passar"; se um ajuste exigir decisão de negócio, pergunte antes. Os pontos de atenção prováveis estão listados no fim de `docs/DEPLOY-VERCEL.md` (seção "O que ainda pode falhar") e valem também para a Netlify.
3. Rodar `pnpm test` (parser do portal e utilitários) e corrigir o que falhar.
4. `git add -A && git commit` e `git push -u origin main` para `https://github.com/stuckyxx/siow-system.git` (o remoto já está configurado; se o repositório remoto estiver vazio, faça o push normal; se tiver histórico diferente, pergunte antes de forçar).
5. Deploy na Netlify pela CLI, a partir de `apps/web`: `npx netlify-cli login`, `npx netlify-cli link --id 0ae957d4-ff21-47c2-a755-17b1d2dcaae7`, `npx netlify-cli deploy --build --prod`. Adicione `.netlify` ao `.gitignore` se ainda não estiver. Se o build na Netlify falhar, leia o log, corrija, commite e refaça.
6. Validar no ar: `GET https://siow-system.netlify.app/api/health` deve responder `ok`; login com `admin@siowsystem.com.br` (senha provisória que o cliente tem; o sistema obriga a troca); em **Entidades → Importar** subir `docs/samples/entidades-exemplo.csv` (41 entidades); clicar **Sincronizar** em CM Bom Lugar e conferir os critérios de aceite da seção 9 do PROMPT-MESTRE (20 notas, 7 pendentes de R$ 1.320,00, débito R$ 9.240,00).
7. Ao final, atualizar `docs/DEPLOY-NETLIFY.md` com o que mudou e listar o que ficou pendente.

Trabalhe de forma incremental, mostrando cada erro e a correção aplicada. Em português.
