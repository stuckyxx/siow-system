# Auditoria final — Siow System CRM (13/10/2026)

Auditoria técnica completa executada após a Fase 11, com correções aplicadas, retestadas e regressão geral. Ambiente auditado: monorepo `stuckyxx/siow-system` (Next.js 15 em `apps/web`, Prisma 6, Postgres Neon, Vercel). Observação de escopo: o sistema **não usa Supabase nem RLS no banco**; o isolamento multi-tenant é feito na camada de aplicação (extensão do Prisma + validação na borda da API), conforme documentado em `docs/ARCHITECTURE.md`.

## 1. Resumo dos testes

| Grupo | Executados | Aprovados | Reprovados | Observação |
|---|---|---|---|---|
| Lint (3 pacotes) + validação de tipos (todos os pacotes) | 2 | 2 | 0 | 0 erros |
| Testes unitários (vitest) | 42 | 42 | 0 | shared 2, db 11, integrations 22, web 7 (1 teste corrigido: `Setting` passou a ser tenant na Fase 9) |
| Build de produção (`next build`, modo Vercel) | 1 | 1 | 0 | 34 páginas |
| Schema: Prisma × banco local × produção (71 tabelas) | 71 | 71 | 0 | md5 das colunas idêntico; `migrate diff` só com diferenças cosméticas (defaults/índices extras) |
| Integridade de dados em produção (SQL) | 14 | 14 | 0 | sem órfãos, sem notas de organização divergente da entidade, sem duplicidade, totais = dashboard |
| Auditoria dinâmica local (`scratchpad/audit-test.sh`): CRUD, isolamento, permissões, erros | 98 | 98 | 0 | ver §3; 3 falhas reais encontradas e corrigidas antes da rodada final |
| Regressão por módulo (10 roteiros das fases 2–11 em banco recém-semeado) | 10 roteiros | 10 | 0 | 0 erros 500; todas as recusas 4xx são regras de negócio esperadas; 4 passos dependem de serviços externos (upload Blob, mídia/contato WhatsApp) |
| Responsividade (12 páginas × celular 390 / tablet 820 / desktop 1400) | 36 | 36 | 0 | 2 páginas corrigidas (rolagem horizontal) |
| Homologação em produção (`scripts/homologacao.sh`) | 66 | 65 | 1* | *`/api/bi/executive` sem resposta em 30 s em uma execução; 4 repetições imediatas responderam 200 em 0,8–1,5 s (queda de conexão do ambiente de teste, não do sistema) |
| Crons em produção (sync, daily, integracoes, platform) | 4 | 4 | 0 | |
| Segurança (cabeçalhos, cookies, CSRF, bearer, rate limit, 2FA, webhooks) | 12 | 12 | 0 | |
| Auditoria de dependências (`pnpm audit --prod`) | 1 | — | — | 36 avisos → 1 (ver §4) |
| **Não executados** | — | — | — | logs de runtime e variáveis de ambiente da Vercel (API devolveu 403 para este token); envio real de e-mail/WhatsApp/Clicksign (sem credenciais reais); teste de carga; QA visual humano |

## 2. Falhas encontradas, causas e correções

| # | Gravidade | Falha | Causa | Correção |
|---|---|---|---|---|
| 1 | **Crítica** | Usuário da organização B conseguia criar contrato e tarefa apontando para `entityId` de uma entidade da organização A (registro ficava na org B com referência cruzada). Chamados já validavam a entidade; contratos, tarefas e outros não. | A extensão de tenant injeta `organizationId` nas escritas, mas não validava a posse dos ids referenciados. | Validação na borda da API (`assertTenantRefs` em `json()`): todo id de registro tenant vindo do cliente (`entityId`, `contractId`, `invoiceId`, `contactId`, `partnerId`, `assigneeUserId`, `roleIds`, itens aninhados…) precisa existir na organização atual; caso contrário 404 sem revelar existência. Testes unitários da extração; 3 cenários de invasão no roteiro dinâmico passam. |
| 2 | Média | Linha do tempo de entidade de outra organização devolvia 200 com lista vazia. | Consulta filtrada sem verificar a entidade. | 404 quando a entidade não é da organização. |
| 3 | Média | Nota manual aceitava valor negativo (`amount: -5`). | `decimalString` permitia sinal negativo. | Valores monetários (notas, contratos, licitações, comissões, propostas) não aceitam negativos. |
| 4 | Baixa | Rolagem horizontal em celular (Licitações) e tablet (Comercial). | Filtros em linha com largura mínima expandiam o viewport. | CSS: em telas ≤ 600 px nada expande o viewport; itens de filtro encolhem. 36/36 páginas sem rolagem. |
| 5 | Baixa | Auditoria gravava `userId` sintético (`apikey:…`) em ações feitas por chave de API sem criador. | — | `userId` nulo nesses casos (a chave fica identificada em `after`/`resource`). |
| 6 | Baixa | Teste unitário de isolamento desatualizado (`Setting` virou modelo tenant na Fase 9). | — | Teste ajustado; novo teste cobre `Setting` com organização. |
| 7 | Média | 36 avisos de dependências (12 altos): `undici`/`@fastify/busboy` via `@vercel/blob 0.27`, `nodemailer 6`, `postcss 8.4.31` via Next, `uuid 8` via exceljs, `deepmerge-ts` via Prisma. | Versões antigas. | `@vercel/blob` 2.8, `nodemailer` 10.1, overrides `postcss ^8.5.30`, `undici ^6.27`, `@fastify/busboy ^3.2.1`, `uuid ^11.1.1`. Restou 1 aviso (`deepmerge-ts`, usado só pelo CLI do Prisma em build, não em runtime). Build e testes verdes após a atualização. |

Durante a auditoria também foi testada (e descartada) uma validação dentro da extensão do Prisma: ela gerava falso positivo em transações que criam e referenciam registros no mesmo passo (renovação de contratos pelo cron). A validação ficou na borda da API, onde os ids vêm do cliente.

## 3. Evidências (resumo)

- **Isolamento**: GET/PATCH/DELETE de entidade, contrato, nota, tarefa, oportunidade, licitação, chamado, parceiro, webhook, ledger e linha do tempo da org A pela org B → 404 (15 casos); criar contrato/tarefa/chamado na entidade da org A pela org B → 404 (3 casos); busca, auditoria e dashboard da org B sem dados de A; chave de API da org A só enxerga A e não muta sem permissão; configurações isoladas.
- **Permissões**: papel CONSULTA lê entidades e notas (200) e recebe 403 em criar entidade, editar contrato, baixa de nota, lote de status, criar usuário, configurações, chaves de API, exportar relatório, excluir chamado, pagar comissão; console da plataforma 401 para usuário comum; administrador da org A não alcança usuário da org B (404).
- **Regras financeiras**: baixa e nota manual exigem justificativa (400 sem ela); nota duplicada 409; valor negativo e mês inválido 400; entidade com contrato ativo não é excluída (400); resumo da entidade reflete a baixa (`paidInvoices` = 1).
- **Erros**: JSON inválido 400, id inexistente 404, id malformado 404, `pageSize` acima do máximo 400, UF inválida 400, relatório inexistente 400, datas inválidas 400, método não permitido 405, rota inexistente 404, corpo de 10 kB em campo de nome 400.
- **Cálculos**: dashboard de produção = SQL direto (R$ 161.396,00 pendentes em 94 notas; 2.331 pagas = R$ 3.971.329,10; 92 entidades; 31 com débito; 56 contratos ativos); situação financeira de contrato e extrato de comissões conferidos nos roteiros de regressão.
- **Segurança em produção**: CSP `default-src 'self'`, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy; cookies `Secure; HttpOnly; SameSite=Lax` (refresh restrito a `/api/auth`); mutação sem cabeçalho anti-CSRF 403; crons e bootstrap sem bearer 401; chave de API inválida 401; 2FA de usuário e superadmin ponta a ponta; logins e ações sensíveis auditados.
- **Infra**: deployment de produção `READY` (commit `cb63e42`), aliases ativos, 4 crons respondendo; schema de produção idêntico ao local/Prisma.
- Arquivos: `scratchpad/audit-results.txt` (98 linhas OK), `scratchpad/regress-all.txt` (1.3 mil linhas dos roteiros), capturas em `scratchpad/shots/resp-*.png`.

## 4. Riscos de segurança remanescentes

1. **Sem RLS no banco**: o isolamento depende da aplicação (extensão do Prisma + validação na borda). Mitigação: testes automatizados de isolamento no roteiro dinâmico; recomendação futura: RLS por `organizationId` com `SET app.org` por conexão.
2. **Webhooks de entrada sem segredo configurado** (WhatsApp `appSecret`, Clicksign): a assinatura só é verificada quando o segredo existe. Configure os segredos nas Integrações antes de ativar os webhooks em produção.
3. **Limite por IP** contado no banco; atacante com muitos IPs contorna o limite por IP, mas o bloqueio de conta após 5 falhas e o limite por e-mail no login da plataforma permanecem.
4. **Dependência `deepmerge-ts`** (alto, apenas CLI do Prisma durante o build; sem exposição em runtime). Atualizar com o Prisma 7 quando estável.
5. **Backups**: Neon no limite de 10 ramos (ramo de backup da Fase 11 não pôde ser criado) e sem snapshots agendados no plano atual. Ação recomendada: remover ramos antigos (fases 1–6) e/ou contratar snapshots.
6. **Logs/variáveis da Vercel** não puderam ser inspecionados por este token (403); recomenda-se revisão manual no painel (variáveis: `DATABASE_URL`, `JWT_*`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`, `INTEGRATION_SECRET_KEY`, `APP_URL`).
7. **Aplicativo legado `apps/api` (NestJS)** não é publicado; mantém dependências antigas e não recebe os ajustes de isolamento — não deve ser exposto.

## 5. Situação por módulo

| Módulo | Situação | Observações |
|---|---|---|
| Acesso (login, sessão, 2FA, senha) | OK | bloqueio por tentativas, rate limit, 2FA validados local e produção |
| Cadastro (entidades, contatos, agentes) | OK | CRUD, duplicidade, isolamento |
| Contratos (aditivos, renovações, reajuste, situação financeira) | OK | roteiro Fase 3 completo em banco limpo |
| Financeiro (notas, baixas, cobranças, OS, certidões, alarmes, tarefas, sincronização) | OK | justificativas obrigatórias; cálculos conferidos; sync em produção processando |
| Comercial (funil, propostas, metas, catálogo) | OK | regras de ganho/perda/formalização |
| Licitações (PNCP/Compras, prazos, checklist, formalização) | OK | busca externa depende da disponibilidade dos portais |
| Atendimento (chamados, SLA, campanhas, avaliação) | OK | anexo exige Blob (produção) |
| WhatsApp (central) | OK com ressalva | fluxo validado com webhooks simulados; envio real depende de credenciais Meta |
| Parceiros e comissões | OK | extrato e apuração conferidos |
| Relatórios e BI | OK | única leitura sem resposta foi reexecutada 4 vezes com sucesso (0,8–1,5 s) |
| Integrações e webhooks | OK | HMAC, reentrega, circuito; segredos de entrada a configurar |
| Administração (usuários, papéis, configurações, marca, chaves de API, LGPD) | OK | |
| Plataforma SaaS (organizações, planos, assinaturas, bloqueio suave, e-mails) | OK | e-mails dependem de SMTP configurado |

## 6. Prontidão para produção

**Classificação: APROVADO COM RESSALVAS.**

Justificativa: a falha crítica de isolamento (referências cruzadas entre organizações) foi corrigida e comprovada por testes; não há erros de servidor nos fluxos de todos os módulos; tipos, lint, testes unitários e build estão verdes; schema e dados de produção íntegros; proteções de segurança ativas. As ressalvas não bloqueiam o uso, mas devem ser tratadas: (a) **publicar a correção de isolamento** (commit `dd2086a`, já em `main`, build validado) — a publicação **não foi feita automaticamente** por determinação da auditoria e aguarda autorização; (b) configurar segredos dos webhooks de entrada antes de ativá-los; (c) organizar backups no Neon; (d) revisão manual das variáveis/logs na Vercel.

Até a publicação do commit `dd2086a`, a versão em produção (`cb63e42`) mantém a falha #1: um usuário autenticado de outra organização poderia vincular registros a entidades alheias. Hoje só existe uma organização ativa em produção (Siow), o que limita o impacto, mas a publicação deve preceder a entrada de qualquer cliente SaaS.
