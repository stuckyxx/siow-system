# Publicando na Netlify (banco Neon) — estado atual e o que falta

_Atualizado em 07/10/2026._

## Já feito

- **Neon** — projeto `siowsystem` (`dark-sound-41190359`, região us-east-2): 33 tabelas, índices, chaves estrangeiras e trava de auditoria; permissões (30), papéis (4), modelos de mensagem (3), configurações (6) e o usuário **admin@siowsystem.com.br** (senha provisória entregue no chat; troca obrigatória no 1º acesso). Conferido em 07/10: 33 tabelas, 1 usuário, 30 permissões, 0 entidades.
- **Código no GitHub** — `stuckyxx/siow-system`, branch `main`, com `pnpm-lock.yaml` commitado.
- **Compilação** — `pnpm install`, `pnpm typecheck` (monorepo inteiro), `pnpm test` (12 testes do parser) e `pnpm --filter @siow/web build` passam.
- **Netlify** — projeto `siow-system` (`0ae957d4-ff21-47c2-a755-17b1d2dcaae7`) → https://siow-system.netlify.app. O build do Next.js roda e publica (deploy enviado pela integração Netlify, sem repositório ligado).

## Correções aplicadas para compilar e publicar

| Problema | Correção |
|---|---|
| `json()`/`parseQuery()` (web) e `ZodPipe` (api) tipavam entrada = saída do Zod → 16 erros em schemas com `.default()`/`.transform()` | tipar pelo `output<S>` do schema |
| Next 15.5 recusa handler com 2º argumento opcional (`rp?: RouteParams`) | argumento obrigatório em `route()` |
| `noUncheckedIndexedAccess` no `COUNT(*)` cru de entidades | `countRows[0]?.count ?? 0` |
| cheerio 1.2 não exporta mais o tipo `AnyNode` | importado de `domhandler` (dependência declarada em `@siow/integrations`) |
| `@vercel/blob` `put` não aceita `Uint8Array` | conversão para `Buffer` |
| `ioredis` default import sob NodeNext (`packages/queue`) | `import { Redis } from 'ioredis'` |
| relatório `forecast` sem rótulo no `apps/api` | rótulo adicionado (a API Docker não implementa o relatório; cai no caso padrão vazio) |
| lint do build: imports não usados / `import type` | corrigidos |
| CI fixava pnpm 10.28 em conflito com `packageManager` 9.15.4 | CI usa a versão do `packageManager` |
| Netlify ignorava `apps/web/netlify.toml` (site sem *base directory*) → o 1º deploy publicou o repositório como arquivos estáticos | `netlify.toml` na raiz com `base = "apps/web"` (já substituído por deploy correto) |
| Prisma sem engine para o runtime das funções (Amazon Linux) | `binaryTargets = ["native", "rhel-openssl-3.0.x"]` |

## Interface refeita conforme o protótipo aprovado (07/10/2026)

Referências: `docs/prototipo-siow-financeiro.html` e `apps/web/public/logo.png`.

- **Tema "aurora"** (escuro, grade sutil, cartões translúcidos, gradiente ciano→violeta) em `apps/web/src/app/globals.css`; fontes Sora/Manrope/JetBrains Mono via `next/font` (servidas pelo próprio site, compatível com a CSP). As primitivas de `components/ui.tsx` usam o mesmo visual, então todas as telas herdam o tema.
- **Topo**: logo clicável → Dashboard com "MÓDULO FINANCEIRO", busca global (entidade, município, nota, contrato), indicador "Sincronização automática · a cada 20 min · última hh:mm", usuário + **Senha** e **Sair**.
- **Menu horizontal centralizado** só com Dashboard · Entidades · Certidões · Relatórios · Sincronização · Administração (filtrado por permissão). **← Voltar** em toda tela interna.
- **Login** com a logo. "Esqueci minha senha" orienta a pedir redefinição ao administrador (o envio de link por e-mail ainda não existe no backend).
- **Dashboard**: 6 cartões (Total pendente, Total recebido, Receita prevista mensal, Receita prevista anual — clicável, com detalhamento e "Ver como relatório" —, Entidades com pendências x de N, Contratos ativos), chips de alerta, tabela "Entidades com maiores débitos" em largura total, sem gráficos. Filtros globais (entidade, exercício, situação + Mais filtros: tipo, mês, responsável) compartilhados com Relatórios.
- **Entidades**: busca, tipo, "Somente com débito", "Mostrar encerradas"; situação Em dia / Com pendências / N a verificar / Contrato encerrado; botões NOTAS FISCAIS · CONTRATOS · AGENDA · ORDEM DE SERVIÇO · SINCRONIZAR.
- **Ficha da entidade**: Ver pendentes · Nova tarefa · Cobrar · Sincronizar agora; 8 cartões; abas centralizadas Visão geral · Notas fiscais · Contratos · Agenda · Ordens de serviço · Contatos.
- **Contratos (ficha)**: só os cadastrados manualmente; Editar, **+ Aditivo** (campos mudam pelo tipo: Prazo / Valor / Prazo e valor / Objeto / Outro, com validação), **Anexar PDF** (vários arquivos, abrir/remover), **Excluir** (com aditivos, auditado). Aditivo de prazo com nova vigência futura reativa contrato vencido.
- **Relatórios**: pré-visualização em "papel" com logo no cabeçalho; o **PDF exportado** também traz a faixa com a logo.
- **Busca rápida** (botão flutuante): interpreta o texto por regras (sem IA) e abre a tela/filtro certo; nunca envia mensagem nem altera status.

## Variáveis de ambiente (configuradas em 07/10/2026)

`DATABASE_URL` (pooler, com `pgbouncer=true&connect_timeout=15`, sem `channel_binding`), `DIRECT_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` e `CRON_SECRET` estão gravadas como **secretas no contexto Production**. Atenção: a Netlify não aceita valor secreto no contexto "All" (inclui o ambiente local de desenvolvimento) — gravado assim, a variável não é salva e a função não a enxerga. Depois de mudar qualquer variável, é preciso **novo deploy**.

`/api/health` respondeu `{"ok":true,"db":"ok"}` e o login dos administradores funcionou em produção.

Recomendação de segurança: a senha do banco foi colada no chat durante a configuração — gere uma nova no Neon (Roles → neondb_owner → Reset password) e atualize `DATABASE_URL` e `DIRECT_URL` na Netlify, seguido de novo deploy.

## Portal da Adois (08/10/2026)

Além do portal da Assesi, o sistema lê o **Portal do Cliente da Adois** (`adoissolucoes.com/adm_faturas`). O provider é escolhido pelo host da URL.

- **Link de entidade** (`…index.php?e=…&t=1`): uma prefeitura/câmara. Cadastre como qualquer entidade (Nova entidade com a URL, ou CSV). Lê nome, pendentes/pagas (data do pagamento = paga), descrição e número do contrato ("conforme contrato nº 184/2025"), Total pendente/pago para conferência.
- **Link de parceiro** (`…&t=2`): notas de uma empresa parceira para vários municípios. Em **Entidades → Importar → Link de parceiro (Adois)** o sistema lê o link, identifica cada prefeitura/câmara pela descrição das notas ("… para Prefeitura de Bom Jardim - MA"), agrupa por contrato (NContrato) e cadastra uma entidade + uma fonte por município (mesma URL, `config.entityKey`). Idempotente: pode ser repetido quando o parceiro ganhar novos municípios. As certidões desse portal são da Adois e não são sincronizadas.
- Banco: enum `DataSourceProvider` ganhou `ADOIS_PORTAL`; a unicidade de fontes passou a ser `(provider, url, entityId)` — ambos aplicados no Neon por SQL (espelho em `packages/db/prisma/schema.sql`).
- Cadastrados em 08/10: PM TUNTUM (16 notas, 1 pendente de R$ 2.500,00) e, pelo link do parceiro A M C MOREIRA, PM BOM JARDIM, PM ICATÚ e CM ICATÚ (71 notas, 27 pendentes somando R$ 34.920,00 — igual ao total do portal).

## Pendente — validação (após o banco conectar)

1. `GET https://siow-system.netlify.app/api/health` → `{"ok":true,…,"db":"ok"}`.
2. Login `admin@siowsystem.com.br` + senha provisória → troca de senha.
3. Entidades → Importar → `docs/samples/entidades-exemplo.csv` (41 entidades).
4. Sincronizar CM Bom Lugar → 20 notas, 7 pendentes de R$ 1.320,00 (MAR–SET/2026), débito R$ 9.240,00, contrato `070201001/2025` 1º aditivo até 31/12/2026 (seção 9 do PROMPT-MESTRE).

## Outras pendências conhecidas

- Testes de `sync-core` (aplicação de snapshot), permissões efetivas e autenticação exigidos pela seção 8 do PROMPT-MESTRE ainda não existem (só o parser tem testes).
- "Esqueci minha senha" por e-mail (link de 30 min, spec §5.2) ainda não tem rota no backend.
- Telas secundárias (Certidões, Sincronização, Administração, Agenda, OS, Contatos) herdaram o tema, mas não foram redesenhadas peça a peça como no protótipo.
- O workflow `.github/workflows/sync-cron.yml` (cron via GitHub Actions, pensado para a Vercel) é redundante com as funções agendadas da Netlify; sem os segredos `APP_URL`/`CRON_SECRET` no GitHub ele falha a cada execução — desative-o ou configure os segredos.

## Limites do plano Free da Netlify que afetam o sistema

- Funções têm **10 s** por execução: "Sincronizar todas" processa algumas entidades por clique e informa quantas restam; relatórios muito grandes em PDF podem precisar de filtro por entidade.
- 125 mil execuções de função/mês e 100 GB de banda — folgado para 41 entidades.

## Atualizar o sistema

Com o repositório ligado, qualquer push na `main` gera deploy. Para mudar segredos: **Environment variables** no painel do projeto (e refazer o deploy).
