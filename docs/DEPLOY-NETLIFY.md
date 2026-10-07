# Publicando na Netlify (banco Neon) — o que já está pronto e o que falta

## Já feito (pelo assistente, via conexões Neon e Netlify)

- **Neon** — projeto `siowsystem` (`dark-sound-41190359`, região us-east-2): as 33 tabelas, índices, chaves estrangeiras e a trava de auditoria foram criadas; permissões (30), papéis (4), modelos de mensagem (3), configurações (6) e o usuário **admin@siowsystem.com.br** já estão gravados (senha provisória entregue no chat; troca obrigatória no 1º acesso).
- **Netlify** — projeto `siow-system` no time *Siow System* → https://siow-system.netlify.app (painel: https://app.netlify.com/projects/siow-system). Variáveis de ambiente já definidas: `DATABASE_URL`, `DIRECT_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`, `COOKIE_SECURE`, `SYNC_BUDGET_MS=8000`, `SYNC_CONCURRENCY=2`, `APP_URL`. Acesso público liberado (sem login do time Netlify).
- **Código** — `apps/web/netlify.toml` (plugin Next.js, Node 22), `apps/web/netlify/functions/scheduled-sync.mts` (sincroniza a cada 20 min) e `scheduled-daily.mts` (alertas diários), arquivos em **Netlify Blobs** (privados, servidos pela rota autenticada).

## O que falta (3 passos no navegador)

1. **Código no GitHub**: no repositório `stuckyxx/siow-system` (ou outro privado), envie a pasta inteira do projeto. Sem Git instalado: na página do repositório → **Add file → Upload files**, arraste **o conteúdo** da pasta `siow-system` (todas as subpastas), escreva uma mensagem e **Commit**. Repita se o GitHub reclamar do limite de 100 arquivos por vez (arraste pasta por pasta: `apps`, `packages`, `docs`, `infra`, arquivos da raiz).
2. **Ligar a Netlify ao repositório**: https://app.netlify.com/projects/siow-system → **Project configuration → Build & deploy → Continuous deployment → Link repository** → GitHub → escolha o repositório → em **Base directory** digite `apps/web` → Save. A Netlify lê o `netlify.toml` e começa o primeiro build (5–8 min).
3. **Acompanhar o build** em **Deploys**. Se falhar, clique em **Why did it fail?** e me envie o texto — corrijo e você sobe de novo (ou eu te mando o arquivo alterado).

Depois do primeiro deploy bem-sucedido:

- Abra https://siow-system.netlify.app → entre com `admin@siowsystem.com.br` + senha provisória → troque a senha.
- Administração → Usuários: cadastre a equipe. Entidades → Importar: `docs/samples/entidades-exemplo.csv` (41 entidades). Clique **Sincronizar** em uma entidade para testar; a sincronização automática roda a cada 20 min (≈2 entidades por vez — limite de 10 s por função no plano Free; em 24 h todas ficam atualizadas).
- Domínio próprio: **Domain management → Add a domain**.

## Limites do plano Free da Netlify que afetam o sistema

- Funções têm **10 s** por execução: "Sincronizar todas" processa algumas entidades por clique e informa quantas restam; relatórios muito grandes em PDF podem precisar de filtro por entidade.
- 125 mil execuções de função/mês e 100 GB de banda — folgado para 41 entidades.

## Atualizar o sistema

Qualquer alteração enviada ao GitHub gera um novo deploy automaticamente. Para mudar segredos: **Environment variables** no painel do projeto.
