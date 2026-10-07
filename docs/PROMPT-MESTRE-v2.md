# PROMPT MESTRE v2 — Siow System · Módulo Financeiro

> Cole este prompt inteiro em uma IA de desenvolvimento (Claude, ChatGPT, Cursor, Copilot etc.). Ele descreve o sistema completo, com todas as decisões já validadas no protótipo. Onde houver dúvida, siga o que está escrito aqui; não invente comportamento.

---

## 0. Papel e regras para a IA

Você é um engenheiro(a) sênior full-stack. Vai construir (ou evoluir) o **Siow System**, plataforma modular da **Siow System Tecnologia**, empresa que fornece software e serviços para órgãos públicos brasileiros (Prefeituras, Câmaras Municipais, Institutos de Previdência etc.). O primeiro módulo é o **Financeiro**: gestão de contratos e recebíveis das entidades clientes.

Regras invioláveis:

1. **Nunca inventar dado financeiro.** Tudo sobre notas fiscais vem do Portal do Cliente (fonte). O sistema nunca "assume" que uma nota foi paga; só muda status quando a fonte mostrar ou quando um usuário alterar manualmente com justificativa.
2. **Nunca apagar histórico.** Notas que sumirem da fonte são marcadas como "a verificar", não excluídas. Auditoria é append-only.
3. **Nunca simular envio.** Mensagem (WhatsApp/e-mail) só é marcada como enviada se um adaptador real confirmar; sem integração, o fluxo é "copiar mensagem e registrar envio manual".
4. **Produção de verdade:** TypeScript estrito, validação em todas as entradas, permissões checadas no backend (a interface só esconde), testes para as partes críticas (parser, aplicação de snapshot, permissões), logs estruturados, LGPD (dados mínimos, acesso controlado, auditoria).
5. Idioma do produto: **português do Brasil**. Datas `dd/mm/aaaa`, moeda `R$ 1.234,56`, fuso `America/Sao_Paulo`.
6. Entregue código completo e funcional, não pseudocódigo. Quando algo não puder ser feito (ex.: provedor de assinatura digital não contratado), implemente a abstração + fallback manual e deixe claro no README.

---

## 1. Stack (decidida — não trocar)

- **Monorepo** pnpm workspaces: `apps/api`, `apps/worker`, `apps/web`, `packages/{db,shared,integrations,sync-core,queue,storage}`.
- **Backend:** Node 22 LTS, **NestJS 11** (Express 5), **Prisma 6**, **PostgreSQL 16**, **Redis 7 + BullMQ** (filas e agendamentos), **MinIO/S3** (documentos, bucket privado, URLs pré-assinadas, dedupe por checksum SHA-256).
- **Frontend:** **Next.js 15 (App Router)**, Tailwind CSS 4, componentes estilo shadcn/ui (Radix), Lucide icons, TanStack Query, Zod compartilhado entre API e web.
- **Auth:** senha com **Argon2id**; JWT de acesso (15 min) em cookie `HttpOnly` + refresh rotativo (7 dias) em cookie; CSRF (header `X-Requested-With` + checagem de `Origin`); rate limit (Redis); bloqueio após 5 tentativas; senha forte (10+ caracteres com letra, número e símbolo); troca obrigatória no primeiro acesso.
- **Build/execução:** SWC; Dockerfiles multi-stage para api/worker/web; `docker-compose.prod.yml` com Caddy (HTTPS automático), Postgres/Redis/MinIO sem portas publicadas; CI (GitHub Actions) com install, prisma generate, typecheck, test, build.
- **Testes:** Vitest.

---

## 2. Fonte de dados: Portal do Cliente (Assesi)

Cada entidade tem uma URL própria do portal, no formato:
`https://www.assesi.com.br/adm_faturas/index.php?e=<código>&t=1` (Araioses usa `https://assesi.com.br/...`, sem `www`).

### 2.1 Como ler o portal (já validado com 41 entidades reais)

- A página `index.php` mostra **apenas notas pendentes**, os cards do topo e os contratos. Nela existem inputs ocultos `tipoEntidade` (ex.: `1`) e `codEntidade` (código interno, ex.: `12422`), diferentes do `e=` da URL.
- A **listagem completa** (pendentes + pagas, todos os contratos) vem de um POST same-origin para `ajax/Faturas.ajax.php` com corpo `application/x-www-form-urlencoded`:
  `p_tipoEntidade=<tipoEntidade>&p_codEntidade=<codEntidade>&p_tipo=0&p_mes=&p_ano=&p_ordem=DESC&p_busca=`
  O retorno é HTML.
- Estrutura: blocos de contrato com cabeçalho `CONTRATO: <número e aditivo> - dd/mm/aaaa à dd/mm/aaaa`, um botão `id="dropdownMenuButtonContrato<códigoContrato>"` e `data-target="#ModalAditivo<códigoContrato>"`. Abaixo, cards `.invoice-card` com `Nota: <número>`, competência `MMM/AAAA` (ex.: `SET/2026`), valor `R$ 1.320,00`, data de emissão, e badge `.invoice-badge.paid` (texto = **data do pagamento**) ou `.invoice-badge.pending` ("Pendente").
- Cards do topo: "Total de Débitos / Pendentes: N Notas / Último Pagamento" ou, quando em dia, "Total Pago / Em Dia: N Notas Pagas". Use-os para **conferir** a soma das notas pendentes lidas (se divergir, marcar a execução como PARCIAL com aviso).
- `ver_nota.php` (POST) **incrementa um contador de visualização** no portal: só buscar o PDF da nota sob demanda, nunca em massa.
- Certidões da empresa (14 itens: Falência e concordata, Cartão ISS, TCU consolidada, Junta Comercial específica/simplificada, débitos Estaduais/Municipais/Trabalhistas, Cartão CNPJ, FGTS, CRP Contador, Dívida Ativa da União, Alvará, Licença Sanitária) são **da empresa** (não por entidade), com data de validade; sincronizar uma vez por execução, não por entidade.
- Formatos reais de cabeçalho de contrato que o parser **precisa** aceitar (regex de aditivo `(\d+)\s*[ºo°]?\s*(ADTV|ADT|ADIT|ADITIVO|AD|TA)\b\.?`, mais prefixo `^(\d+)AD\s+<número>`):
  `00120230821 6º ADT`, `070201001/2025 1º Ad`, `003/2025 1º Adtv`, `01/DP/012/2025 1ºAdt`, `20250008 - 1º ADT`, `004/2025 - 1ºADT`, `005/2023 - 1º Adtv.`, `2023130301/2023 1ºad`, `4AD 2022000504` (→ número `2022000504`, 4º aditivo), `00103262025 – CMSQMA`, `009 / 2024`, `S/N`.
- Robustez: timeout, 2 retentativas com backoff, circuit breaker após 3 falhas seguidas por fonte, decodificar charset do `Content-Type`, aceitar competência com mês de 1 ou 2 dígitos, badge "vencida/atrasada" = PENDENTE, valor sem centavos (`R$ 1.320` = 1320).

### 2.2 Regras de aplicação do snapshot (sync-core)

Para cada execução por entidade:

1. Nota nova na fonte → criar com status da fonte e evento `CREATED`.
2. Nota existente com mudança (status, data de pagamento, valor) → atualizar e registrar `InvoiceEvent` com de/para. PENDENTE→PAGA registra a data do pagamento lida do badge.
3. Nota com **alteração manual** no sistema e valor diferente na fonte → **não sobrescrever**; criar `SyncConflict` e marcar "a verificar"; o usuário decide (aceitar fonte / manter manual) com justificativa.
4. PAGA→PENDENTE (regressão) → aplicar, mas sinalizar como divergência para revisão.
5. Nota que **sumiu** da fonte → `missingSince` + `needsReconciliation`; **nunca** marcar paga nem excluir.
6. **Proteção contra "sumiço em massa"**: se a fonte retornou 0 notas e o banco tem notas da entidade, ou se o HTML contém erro (`SQLSTATE`, página de login), a execução é FALHA/PARCIAL e a detecção de ausência é pulada.
7. Contratos: um registro por código do portal; manter a **maior vigência** vista; número + aditivo extraídos do cabeçalho; status ATIVO/ENCERRADO recalculado pela data fim a cada execução.
8. Cada execução gera `SyncRun` com estatísticas (lidas, novas, atualizadas, mudanças de status, conflitos, ausentes) e avisos.
9. Lock por fonte (jobId por fonte ou lock Redis) para não rodar a mesma entidade em paralelo; execução travada em RUNNING por mais de X minutos é considerada obsoleta.

### 2.3 Entidades iniciais (41) — carregar via CSV `tipo;entidade;municipio;uf;url;nome_completo`

| Tipo | Nome completo | Município/UF | URL |
|---|---|---|---|
| CM | CÂMARA MUNICIPAL DE ARAIOSES | Araioses/MA | https://assesi.com.br/adm_faturas/index.php?e=545110&t=1 |
| CM | CÂMARA MUNICIPAL DE BOM LUGAR | Bom Lugar/MA | https://www.assesi.com.br/adm_faturas/index.php?e=504673&t=1 |
| CM | CÂMARA MUNICIPAL DE BURITICUPU | Buriticupu/MA | https://www.assesi.com.br/adm_faturas/index.php?e=506959&t=1 |
| CM | CÂMARA MUNICIPAL DE CAMPESTRE DO MARANHÃO | Campestre/MA | https://www.assesi.com.br/adm_faturas/index.php?e=509825&t=1 |
| CM | CÂMARA MUNICIPAL DE CANTANHEDE | Cantanhede/MA | https://www.assesi.com.br/adm_faturas/index.php?e=532216&t=1 |
| CM | CÂMARA MUNICIPAL DE GOVERNADOR NUNES FREIRE | Governador Nunes Freire/MA | https://www.assesi.com.br/adm_faturas/index.php?e=506912&t=1 |
| CM | CÂMARA MUNICIPAL DE LAGO DA PEDRA | Lago da Pedra/MA | https://www.assesi.com.br/adm_faturas/index.php?e=523743&t=1 |
| CM | CÂMARA MUNICIPAL DE LIMA CAMPOS | Lima Campos/MA | https://www.assesi.com.br/adm_faturas/index.php?e=519273&t=1 |
| CM | CÂMARA MUNICIPAL DE MATINHA | Matinha/MA | https://www.assesi.com.br/adm_faturas/index.php?e=511173&t=1 |
| CM | CÂMARA MUNICIPAL DE MATÕES DO NORTE | Matões do Norte/MA | https://www.assesi.com.br/adm_faturas/index.php?e=509379&t=1 |
| CM | CÂMARA MUNICIPAL DE MIRANDA DO NORTE | Miranda do Norte/MA | https://www.assesi.com.br/adm_faturas/index.php?e=517647&t=1 |
| CM | CÂMARA MUNICIPAL DE PEDREIRAS | Pedreiras/MA | https://www.assesi.com.br/adm_faturas/index.php?e=514931&t=1 |
| CM | CÂMARA MUNICIPAL DE SANTA QUITÉRIA DO MARANHÃO | Santa Quitéria do Maranhão/MA | https://www.assesi.com.br/adm_faturas/index.php?e=515169&t=1 |
| CM | CÂMARA MUNICIPAL DE SÃO LUÍS GONZAGA DO MARANHÃO | São Luís Gonzaga do Maranhão/MA | https://www.assesi.com.br/adm_faturas/index.php?e=527507&t=1 |
| CM | CÂMARA MUNICIPAL DE SÃO MATEUS DO MARANHÃO | São Mateus/MA | https://www.assesi.com.br/adm_faturas/index.php?e=509466&t=1 |
| CM | CÂMARA MUNICIPAL DE SANTA LUZIA | Santa Luzia/MA | https://www.assesi.com.br/adm_faturas/index.php?e=520881&t=1 |
| CM | CÂMARA MUNICIPAL DE TRIZIDELA DO VALE | Trizidela do Vale/MA | https://www.assesi.com.br/adm_faturas/index.php?e=506831&t=1 |
| CM | CÂMARA MUNICIPAL DE OEIRAS | Oeiras/PI | https://www.assesi.com.br/adm_faturas/index.php?e=522238&t=1 |
| PM | PREFEITURA MUNICIPAL DE ANAJATUBA | Anajatuba/MA | https://www.assesi.com.br/adm_faturas/index.php?e=505479&t=1 |
| PM | PREFEITURA MUNICIPAL DE ARAME | Arame/MA | https://www.assesi.com.br/adm_faturas/index.php?e=513591&t=1 |
| PM | PREFEITURA MUNICIPAL DE BOM LUGAR | Bom Lugar/MA | https://www.assesi.com.br/adm_faturas/index.php?e=500190&t=1 |
| PM | PREFEITURA MUNICIPAL DE BURITICUPU | Buriticupu/MA | https://www.assesi.com.br/adm_faturas/index.php?e=504250&t=1 |
| PM | PREFEITURA MUNICIPAL DE CANTANHEDE | Cantanhede/MA | https://www.assesi.com.br/adm_faturas/index.php?e=509267&t=1 |
| PM | PREFEITURA MUNICIPAL DE CAROLINA | Carolina/MA | https://www.assesi.com.br/adm_faturas/index.php?e=511469&t=1 |
| PM | PREFEITURA MUNICIPAL DE ESPERANTINÓPOLIS | Esperantinópolis/MA | https://www.assesi.com.br/adm_faturas/index.php?e=522484&t=1 |
| PM | PREFEITURA MUNICIPAL DE ITAPECURU MIRIM | Itapecuru Mirim/MA | https://www.assesi.com.br/adm_faturas/index.php?e=521592&t=1 |
| PM | PREFEITURA MUNICIPAL DE LAGO DA PEDRA | Lago da Pedra/MA | https://www.assesi.com.br/adm_faturas/index.php?e=504170&t=1 |
| PM | PREFEITURA MUNICIPAL DE LAGOA GRANDE DO MARANHÃO | Lagoa Grande do Maranhão/MA | https://www.assesi.com.br/adm_faturas/index.php?e=504161&t=1 |
| PM | PREFEITURA MUNICIPAL DE LIMA CAMPOS | Lima Campos/MA | https://www.assesi.com.br/adm_faturas/index.php?e=519539&t=1 |
| PM | PREFEITURA MUNICIPAL DE MARACAÇUMÉ | Maracaçumé/MA | https://www.assesi.com.br/adm_faturas/index.php?e=506552&t=1 |
| PM | PREFEITURA MUNICIPAL DE MATÕES DO NORTE | Matões do Norte/MA | https://www.assesi.com.br/adm_faturas/index.php?e=507221&t=1 |
| PM | PREFEITURA MUNICIPAL DE PEDREIRAS | Pedreiras/MA | https://www.assesi.com.br/adm_faturas/index.php?e=514578&t=1 |
| PM | PREFEITURA MUNICIPAL DE PINDARÉ MIRIM | Pindaré Mirim/MA | https://www.assesi.com.br/adm_faturas/index.php?e=518442&t=1 |
| PM | PREFEITURA MUNICIPAL DE POÇÃO DE PEDRAS | Poção de Pedras/MA | https://www.assesi.com.br/adm_faturas/index.php?e=510502&t=1 |
| PM | PREFEITURA MUNICIPAL DE SANTA LUZIA DO PARUÁ | Santa Luzia do Paruá/MA | https://www.assesi.com.br/adm_faturas/index.php?e=507388&t=1 |
| PM | PREFEITURA MUNICIPAL DE SÃO MATEUS DO MARANHÃO | São Mateus/MA | https://www.assesi.com.br/adm_faturas/index.php?e=511830&t=1 |
| PM | PREFEITURA MUNICIPAL DE SÃO RAIMUNDO DO DOCA BEZERRA | São Raimundo do Doca Bezerra/MA | https://www.assesi.com.br/adm_faturas/index.php?e=508343&t=1 |
| PM | PREFEITURA MUNICIPAL DE TRIZIDELA DO VALE | Trizidela do Vale/MA | https://www.assesi.com.br/adm_faturas/index.php?e=507724&t=1 |
| PM | PREFEITURA MUNICIPAL DE VARGEM GRANDE | Vargem Grande/MA | https://www.assesi.com.br/adm_faturas/index.php?e=520885&t=1 |
| INSTITUTO | INSTITUTO DE PREVIDÊNCIA DE BURITICUPU | Buriticupu/MA | https://www.assesi.com.br/adm_faturas/index.php?e=519665&t=1 |
| PM | PREFEITURA MUNICIPAL DE AXIXÁ DO TOCANTINS | Axixá do Tocantins/TO | https://www.assesi.com.br/adm_faturas/index.php?e=513495&t=1 |

Referência de volume real (set/2026): 41 entidades, 159 períodos de contrato no portal, 2.261 notas, 113 pendentes somando R$ 231.804,50. Dois exemplos para teste: CM Araioses (37 notas, todas pagas, contrato `00120230821` 6º ADT 21/08/2023–20/08/2027, R$ 750/mês) e CM Bom Lugar (20 notas, 7 pendentes MAR–SET/2026 de R$ 1.320, contrato `070201001/2025` 1º Ad 07/02/2025–31/12/2026).

---

## 3. Modelo de dados (Prisma)

Modelos obrigatórios (nomes e campos principais):

- **User** (nome, e-mail único, passwordHash Argon2id, isActive, mustChangePassword, lastLoginAt), **Role**, **Permission**, **UserRole**, **RolePermission**, **UserPermission** (ajustes individuais: concedidas/removidas além do papel), **Session** (refresh rotativo, revogação).
- **Entity** (type: PM | CM | AUTARQUIA | FUNDO | INSTITUTO | CONSORCIO | OUTRO; name; shortName; municipality; uf; cnpj opcional; notes; responsibleUserId; soft delete) — unicidade `(type, name, uf)`.
- **DataSource** (entityId, provider ASSESI_PORTAL, url única, label, syncEnabled, lastSyncAt, lastSyncStatus, failureCount, circuitOpenUntil).
- **SyncRun** (dataSourceId, trigger SCHEDULED|MANUAL, status QUEUED|RUNNING|SUCCESS|PARTIAL|FAILED, startedAt, finishedAt, stats JSON, warnings, error).
- **Contract** (entityId, externalCode, number, origin SYNC|MANUAL, status ACTIVE|EXPIRED|ENDED, startDate, endDate, monthlyValue, object, rawHeader) e **ContractAmendment** (contractId, sequence, label, kind PRAZO|VALOR|PRAZO_VALOR|OBJETO|OUTRO, signedAt, effectiveFrom, newEndDate, newMonthlyValue, newObject, description, documentId, origin).
- **ContractDocument** (PDF do contrato; um contrato pode ter vários arquivos).
- **Invoice** (entityId, contractId, number único por entidade, competenceMonth, competenceYear, amount Decimal, issuedAt, status PENDING|PAID|CANCELLED|UNKNOWN, paidAt, sourceStatus, sourcePaidAt, manualOverride, overrideJustification, overrideByUserId, missingSince, needsReconciliation, description), **InvoiceEvent** (append-only: CREATED, STATUS_CHANGED, MANUAL_OVERRIDE, CONFLICT_DETECTED, CONFLICT_RESOLVED, RECONCILED, NOTE), **SyncConflict**.
- **DocumentBlob** (sha256 único, size, mime, storageKey) + **Document** (ligação com entidade/nota/contrato/OS, tipo, nome, uploader).
- **Certificate** + **CertificateVersion** (slug, nome, validade, capturadas em; manter histórico de versões; unicidade por slug quando entityId é nulo).
- **Contact** (entidade, nome, cargo, setor, WhatsApp, e-mail, principal, financeiro).
- **FinancialTask** (entidade opcional, tipo, título, descrição, vencimento, responsável = usuário, prioridade LOW|MEDIUM|HIGH|URGENT, status PENDING|IN_PROGRESS|DONE|CANCELLED, origem automática/manual) + **TaskEvent**.
- **CollectionCase** por nota (status NOT_CHARGED|SCHEDULED|SENT|CLIENT_REPLIED|PAYMENT_PROMISED|AWAITING_PAYMENT|SETTLED) + **CollectionAttempt** (canal WhatsApp|E-mail|Telefone, contato, usuário, mensagem, resposta, próxima ação).
- **MessageTemplate** (chave, nome, corpo com `{{variavel}}` e seções `{{#x}}…{{/x}}`) + **OutboundMessage** (canal, destinatário, status DRAFT|MANUAL|SENT|FAILED, providerMessageId).
- **ServiceOrder** (entidade, contrato, competência, número, status NOT_REQUESTED|REQUESTED|AWAITING_ISSUE|ISSUED|AWAITING_SIGNATURE|SIGNED|CANCELLED, datas, documento principal e assinado) + **ServiceOrderSignatory**, **ServiceOrderEvent**, **SignatureRequest** (provider MANUAL por padrão; abstração para D4Sign/Clicksign/ZapSign).
- **AuditLog** append-only (userId, action, resource, resourceId, before/after JSON, ip, userAgent) com triggers no banco proibindo UPDATE/DELETE.
- **Notification** (usuário ou broadcast, dedupeKey, lida por usuário).
- **Setting** (chave/valor: `certificates.expiringDays`=30, `contracts.expiringDays`=60, `invoices.overdueAfterDays`=30, `sync.cron`, `sync.fetchInvoiceDocuments`=false, `company.name`).

IDs: UUID como **texto** (não usar cast `::uuid` em SQL cru). Colunas em camelCase entre aspas no SQL cru. Dinheiro em `Decimal(14,2)`.

---

## 4. Permissões (RBAC granular)

Catálogo (chave → rótulo em português):

`dashboard.read` Ver dashboard · `entities.read` Ver entidades · `entities.write` Cadastrar/editar entidades · `contacts.read` · `contacts.write` · `contracts.read` · `contracts.write` Cadastrar/editar/excluir contratos e aditivos · `invoices.read` · `invoices.override` Alterar status de nota manualmente · `invoices.reconcile` Resolver conflitos de sincronização · `payments.read` · `documents.read` · `documents.write` Anexar documentos · `certificates.read` · `certificates.manage` · `tasks.read` · `tasks.manage` · `collections.read` · `collections.manage` Realizar cobranças · `service_orders.read` · `service_orders.manage` · `reports.read` · `reports.export` · `sync.read` · `sync.run` · `integrations.manage` · `templates.manage` · `users.manage` Gerenciar usuários e permissões · `audit.read` · `settings.manage`.

Papéis padrão: **Administrador** (todas), **Financeiro** (todas menos users/integrations/settings), **Gestor** (todas `.read` + `reports.export` + `tasks.manage`), **Consulta** (só `.read`). Papéis são editáveis; cada usuário pode ter permissões **adicionadas ou removidas individualmente** além do papel (permissão efetiva = papel + extras − removidas).

Regras: backend valida em cada rota (`@RequirePermission`); usuário não pode inativar a si mesmo nem remover a própria `users.manage`; papel Administrador sempre mantém `users.manage`; tudo auditado (LOGIN, LOGIN_FAILED, LOGOUT, USER_CREATED/UPDATED/ACTIVATED/DEACTIVATED, PASSWORD_RESET/CHANGED, ROLE_PERM_GRANTED/REVOKED, PERMISSION_DENIED).

---

## 5. Interface (decisões validadas no protótipo)

### 5.1 Visual
- Tema escuro "futurista": fundo azul-marinho profundo com grade sutil, cartões translúcidos com borda fina, gradiente ciano→violeta em botões primários e no item de menu ativo, fonte display para títulos, mono para números. Logo da Siow System no topo esquerdo (clicável → Dashboard) com "MÓDULO FINANCEIRO" embaixo; logo também no cabeçalho dos relatórios/PDF.
- Topo: logo · busca global (entidade, município, nº de nota, nº de contrato) · indicador "Sincronização automática · a cada N min · última hh:mm" · usuário logado (nome + papel) com botões **Senha** e **Sair**.
- **Menu horizontal centralizado** com apenas: **Dashboard · Entidades · Certidões · Relatórios · Sincronização · Administração** (cada item só aparece se o usuário tiver a permissão correspondente).
- Todo botão/tela interna tem um **← Voltar** (pilha de navegação).
- Sem gráficos no dashboard (foram removidos a pedido). Nada de poluição visual: poucos cartões, tabelas limpas.

### 5.2 Login
Tela com logo, e-mail e senha; mensagens de erro claras; "Esqueci minha senha" envia link por e-mail (30 min); senha provisória obriga troca; 5 erros bloqueiam por 15 min. Sessão expira por inatividade; refresh silencioso.

### 5.3 Dashboard ("Central financeira")
- Filtros globais: entidade, exercício, situação (pendentes/pagas/todas), + "Mais filtros": tipo (PM/CM/Instituto), mês, responsável. Filtros valem para todos os indicadores e para Relatórios.
- Linha de 6 cartões: **Total pendente** (soma e nº de notas pendentes) · **Total recebido** · **Receita prevista mensal** · **Receita prevista anual** (clicável → detalhamento) · **Entidades com pendências** (x de N cadastradas) · **Contratos ativos**.
- **Regra da receita prevista** (importante): para cada contrato ativo, a mensalidade = **valor da nota mais recente emitida no portal** para aquele contrato (primeira da lista em ordem decrescente); mensal = soma; anual = mensal × 12. O detalhamento lista entidade, contrato, nota-base (número, competência, emissão), mensal e anual, com "Ver como relatório".
- Alertas em chips: contratos vencendo em 120 dias, certidões vencendo em 30 dias, OS pendentes, notas a verificar.
- Tabela **Entidades com maiores débitos** (largura total): entidade, município/UF, nº notas, débito, nota mais antiga (dias). Sem coluna "tempo de atraso".

### 5.4 Entidades
- Lista simples: **Entidade** (nome curto + nome completo · município/UF) · **Situação** (Em dia / Com pendências / N a verificar / Contrato encerrado) · ações em botões horizontais nesta ordem: **NOTAS FISCAIS · CONTRATOS · AGENDA · ORDEM DE SERVIÇO · SINCRONIZAR**. Busca e filtros funcionais (texto, tipo, "somente com débito"), checkbox "Mostrar encerradas". Botões "Sincronizar todas", "Importar CSV/XLSX", "Nova entidade".
- Entidade fica em "encerradas" quando não tem contrato ativo (data fim passada ou marcado como encerrado).

### 5.5 Ficha da entidade
- Cabeçalho: tipo · município/UF, nome, status/hora da última sincronização; botões Ver pendentes · Nova tarefa · Cobrar · Sincronizar agora.
- Cartões: Contrato atual (nº, vigência) · Aditivos (qtd, último) · Total em débito · Notas pendentes · Último pagamento (data, valor) · Última cobrança · OS pendentes · A verificar.
- **Abas centralizadas, somente estas:** Visão geral · Notas fiscais · Contratos · Agenda · Ordens de serviço · Contatos. (Cobranças, Certidões, Documentos e Histórico **não** são abas; cobrança fica dentro da nota e no botão "Cobrar"; certidões no menu principal; histórico dentro de cada registro.)
- **Notas fiscais:** abas Pendentes/Pagas/Todas; colunas nota, competência, emissão, valor, situação, pagamento, dias em aberto, cobrança. Clique abre a nota com abas Ações (alteração manual com justificativa ≥10 caracteres e data; resolver conflito aceitando fonte ou mantendo manual) · Cobrança (contato, canal, mensagem pré-preenchida pelo modelo, resultado, próxima ação; nunca envia sozinho) · Documentos (baixar PDF sob demanda) · Histórico (eventos).
- **Contratos:** mostra **apenas contratos cadastrados manualmente** (os períodos lidos do portal são usados internamente para notas e receita prevista, mas não aparecem aqui). Botões: Novo contrato, Editar, **+ Aditivo**, **Anexar PDF** (vários arquivos por contrato, listados abaixo com nome/tamanho/data, abrir e remover), **Excluir** (confirmação; leva os aditivos junto; auditado). Editar contrato com data fim passada/encerrado tira a entidade da lista de ativas. Sem botão "Conta corrente" na aba (a conta corrente esperado × faturado × pago fica em Relatórios).
- **Aditivos:** sempre vinculados a um contrato; lista com nº, tipo, assinado em, nova vigência, novo valor, descrição, origem, PDF, Excluir. Formulário **muda conforme o tipo**: Prazo → nova vigência (fim); Valor → novo valor mensal; Prazo e valor → ambos; Objeto → novo objeto; Outro → só descrição. Ao salvar, o contrato assume nova vigência/valor/objeto; ao excluir, volta ao aditivo anterior (ou ao original). Campos obrigatórios validados por tipo.
- **Agenda:** tarefas por responsável (usuários normais, ex.: "Hélida"), tipo, prioridade, vencimento, status; criar, **editar e excluir**; concluir; vencidas em destaque.
- **Ordens de serviço:** por competência; fluxo Não solicitada → Solicitada → Aguardando emissão → Emitida → Aguardando assinatura → Assinada; aviso ao cliente via modelo de mensagem; anexar OS assinada (provedor MANUAL) com checksum.
- **Contatos:** nome, cargo, setor, WhatsApp, e-mail, principal, financeiro.

### 5.6 Certidões (menu)
Tabela com nome, validade, dias restantes, situação (válida/vencendo/vencida), capturada em, versões; renovação gera tarefa.

### 5.7 Relatórios
Seleção do relatório + filtros globais + **pré-visualização em página ("papel")** com cabeçalho (logo, título, empresa, período, recorte, gerado em/por), KPIs e tabela; botões Exportar PDF · XLSX · CSV (exportação real via StreamableFile; proteção contra injeção de fórmula). Relatórios: Financeiro geral, Notas fiscais, Inadimplentes, Recebimentos, Tempo médio para recebimento, **Receita prevista (mensal e anual)**, Contratos, Conta corrente do contrato, Certidões, Ordens de serviço, Agenda, Cobranças, Auditoria.

### 5.8 Sincronização
Painel com última execução por entidade, status, duração, estatísticas, avisos; "Sincronizar agora" por entidade e "Sincronizar todas"; histórico de execuções; sincronização automática em segundo plano com intervalo configurável (padrão produção: a cada 6 horas; mostrar no topo). Não usar intervalos de segundos em produção (o portal é de terceiros).

### 5.9 Administração (abas por permissão)
**Usuários** (tabela: nome, e-mail, papel, nº de permissões efetivas com +extras/−removidas, último acesso, situação; Novo usuário com senha inicial gerada; Editar com ajuste individual de permissões; Inativar/Ativar; Redefinir senha) · **Papéis e permissões** (grade de checkboxes por papel, com rótulos em português) · **Configurações** (chaves da tabela Setting) · **Modelos de mensagem** (edição com variáveis) · **Auditoria** (append-only, filtros).

### 5.10 Assistente virtual
Botão flutuante "Assistente" (oculto na tela de login). Chat em português que executa comandos no sistema via ferramentas: abrir entidade, listar pendências, abrir cobrança da nota mais antiga (pré-preenche, usuário confirma), criar tarefa, gerar relatório, aplicar filtros, abrir nota, resumo da entidade. Respeita permissões do usuário; nunca envia mensagens nem altera status sem confirmação explícita. Backend: endpoint `/assistant` que chama o modelo com tool-use; fallback por regras simples se a IA estiver indisponível.

---

## 6. Mensagens e cobrança
- Modelos iniciais: `SERVICE_ORDER_ISSUE_REMINDER` (avisar cliente para emitir OS), `INVOICE_COLLECTION` (cobrança), `INVOICE_COLLECTION_FOLLOWUP`.
- Adaptadores: WhatsApp (Meta Cloud API ou provedor configurável) e e-mail (SMTP). Sem configuração → modo manual: o sistema mostra a mensagem para copiar e registra "enviado manualmente" com usuário/data.
- Cobrança é **separada** do status da nota: a nota só vira paga pela fonte ou por alteração manual justificada. Quando a fonte marcar paga, o caso de cobrança vai para "Quitada".

---

## 7. Segurança, LGPD e operação
- Permissões no backend; cookies HttpOnly/Secure/SameSite=Lax; CSRF; rate limit por IP e por usuário (Redis); CSP e HSTS; CORS restrito ao domínio do web.
- URL de fonte de dados só aceita `https` nos hosts `assesi.com.br` / `www.assesi.com.br` (anti-SSRF). Upload: validar tipo real (magic bytes), limite de tamanho, armazenar com checksum.
- Seed em produção **exige** `SEED_ADMIN_PASSWORD` forte e cria o admin com troca obrigatória; nunca senha padrão.
- Logs estruturados (pino) com request-id; healthchecks de API (DB, Redis, S3) e heartbeat do worker; backups diários do Postgres (pg_dump/PITR) e versionamento do bucket.
- LGPD: dados pessoais mínimos (contatos e usuários), acesso por permissão, auditoria de acesso, exclusão lógica, política de retenção documentada.

---

## 8. Entregáveis esperados
1. Monorepo completo com README (instalação local: `.env` na raiz, `pnpm install`, `pnpm infra:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`) e `docs/ARCHITECTURE.md`, `docs/DEPLOY.md`.
2. Migrations do Prisma commitadas e `pnpm-lock.yaml` commitado.
3. Testes: parser do portal com os cabeçalhos reais da seção 2.1, `parseBRL`, aplicação de snapshot (criação, mudança de status, conflito manual, ausência, proteção contra sumiço em massa), permissões efetivas (papel + extras − removidas), autenticação.
4. CSV das 41 entidades em `docs/samples/entidades-exemplo.csv` e importação funcionando.
5. Dockerfiles, `docker-compose.prod.yml` com HTTPS, CI verde (install, generate, typecheck, test, build).

## 9. Critérios de aceite (verificar ao final)
- Sincronizar CM Bom Lugar resulta em 20 notas, 7 pendentes de R$ 1.320,00 (MAR–SET/2026), débito R$ 9.240,00, contrato `070201001/2025` com 1º aditivo até 31/12/2026 — exatamente como o portal.
- Sincronizar CM Araioses resulta em 37 notas pagas, última paga em 28/09/2026, contrato `00120230821` 6º ADT até 20/08/2027.
- Dashboard com as 41 entidades mostra receita prevista mensal = soma das últimas notas dos contratos ativos (referência set/2026: R$ 92.803,00 com 45 contratos ativos; anual R$ 1.113.636,00).
- Usuário "Consulta" não vê Administração nem botões de ação; tentativa direta na API retorna 403 e é auditada.
- Alterar manualmente uma nota para PAGA e depois sincronizar (fonte ainda pendente) gera conflito, sem sobrescrever.
- Exportar PDF/XLSX/CSV gera arquivos válidos que abrem corretamente.
- Nenhuma ação envia WhatsApp/e-mail sem adaptador configurado e confirmação do usuário.
