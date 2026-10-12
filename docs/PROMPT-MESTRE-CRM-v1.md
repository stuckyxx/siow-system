# PROMPT MESTRE v1 — Siow System · CRM Comercial de Contratos Públicos

> Cole este prompt inteiro em uma IA de desenvolvimento (Claude, ChatGPT, Cursor, Copilot etc.). Ele descreve o produto completo, módulo por módulo, com as integrações entre eles e as decisões já validadas no **Módulo Financeiro** em produção (`docs/PROMPT-MESTRE-v2.md`, que continua valendo e é a base deste). Onde houver dúvida, siga o que está escrito aqui; não invente comportamento.
>
> Este prompt tem **duas edições** do mesmo código: **Edição Própria** (uso interno da Siow System Tecnologia, uma única organização) e **Edição SaaS / White-label** (venda para outras empresas que vendem para o setor público). A diferença é configuração, não código paralelo: tudo é multi-organização desde o início; na Edição Própria existe uma organização só.

---

## 0. Papel e regras para a IA

Você é um engenheiro(a) sênior full-stack e também product designer. Vai **evoluir** o Siow System (repositório existente, monorepo pnpm) de um módulo financeiro para uma **plataforma CRM de contratos públicos**: prospecção, licitação, contratação, execução, faturamento, cobrança, relacionamento e renovação — o ciclo inteiro de quem vende software e serviços para Prefeituras, Câmaras Municipais, Institutos de Previdência, Autarquias, Consórcios e Defensorias.

Regras invioláveis (herdadas do Financeiro e estendidas):

1. **Nunca inventar dado.** Dado financeiro vem do Portal do Cliente (Assesi/Adois) ou de registro manual com justificativa. Dado de licitação vem do edital/portal oficial ou de registro manual com fonte. Nenhuma tela "estima" valor como se fosse fato; projeções são sempre rotuladas como projeção.
2. **Nunca apagar histórico.** Exclusão é lógica (`deletedAt`). Eventos (de nota, contrato, oportunidade, ticket) são append-only. Auditoria é append-only com trigger no banco.
3. **Nunca simular envio.** WhatsApp, e-mail e assinatura só mudam para "enviado/assinado" com confirmação do adaptador; sem integração, fluxo manual explícito ("copiar e registrar").
4. **Multi-organização desde o primeiro commit.** Toda tabela de negócio tem `organizationId`; toda consulta filtra por ele no backend (middleware do Prisma + checagem na rota); nunca confiar no cliente. Um usuário pertence a uma organização (um e-mail pode existir em várias organizações como usuários distintos).
5. **Permissões no backend** (`route([perms], handler)`); a interface só esconde. Papéis por organização; superadmin da plataforma é separado dos usuários das organizações.
6. **Produção de verdade:** TypeScript estrito, Zod em todas as entradas, testes para parser/snapshot/permissões/cálculos (funil, comissão, previsão), logs estruturados, LGPD.
7. Idioma do produto: **português do Brasil**; datas `dd/mm/aaaa`, moeda `R$ 1.234,56`, fuso `America/Sao_Paulo`.
8. **Não reescrever o que já funciona.** O Financeiro em produção (entidades, fontes, sincronização, notas, contratos sincronizados, cobrança, certidões, OS, alarmes de emissão, relatórios, importação por link/planilha, modo claro/escuro) é reaproveitado. Novos módulos se ligam a ele pelas chaves descritas na seção 3; não duplicar cadastro de entidade, contrato ou contato.
9. Entregue código completo e funcional, por fases (seção 10), cada fase com build verde, deploy e critérios de aceite verificados.

---

## 1. Stack (a que está em produção — não trocar)

- **Monorepo** pnpm: `apps/web` (Next.js 15 App Router; API em Route Handlers `src/app/api/**`; serviços em `src/server/**`), `packages/{shared,db,integrations,sync-core,storage,queue}`. `apps/api` e `apps/worker` (NestJS) ficam apenas para a opção Docker/VPS e precisam continuar compilando.
- **Banco:** PostgreSQL no **Neon**, **Prisma 6**; mudanças de esquema aplicadas por SQL idempotente (`packages/db/prisma/schema.sql` espelha `schema.prisma`); nunca `prisma migrate/db push` em produção pela IA.
- **Hospedagem:** **Vercel** (projeto `siow-system`, Root Directory `apps/web`), Vercel Blob para documentos, Vercel Cron 1x/dia + GitHub Actions a cada 20 min para sincronização. Funções com `maxDuration = 60` nas rotas pesadas.
- **Frontend:** Tailwind 4 + tema "aurora" em `globals.css` (escuro padrão, claro opcional, tokens CSS), componentes próprios em `components/ui.tsx`, TanStack Query, Zod compartilhado.
- **Auth:** scrypt, JWT em cookies HttpOnly, CSRF por header `X-Requested-With`, troca de senha obrigatória no primeiro acesso, "salvar e-mail neste dispositivo".
- **Integrações existentes:** `BillingProvider` (ASSESI_PORTAL, ADOIS_PORTAL com links de entidade e de parceiro, MANUAL), `sync-core` (snapshot nunca apaga, conflitos para alterações manuais, proteção contra sumiço em massa), exportadores PDF/XLSX/CSV com logo.
- **Testes:** Vitest.

---

## 2. Produto, edições e posicionamento

**Nome:** Siow System · CRM de Contratos Públicos. Módulos vendidos em conjunto ou separados (licenciamento por módulo).

| | Edição Própria | Edição SaaS / White-label |
|---|---|---|
| Organizações | 1 (Siow System Tecnologia) | N (cada cliente = 1 organização) |
| Marca | logo Siow | logo, cores, nome do produto e domínio do cliente (`crm.empresa.com.br`) |
| Cobrança | — | plano por módulo e por nº de entidades ativas; faturamento mensal; bloqueio suave ao vencer (somente leitura) |
| Onboarding | já feito | assistente: criar organização → admin → importar entidades (link web, planilha ou PNCP) → conectar portais → convidar equipe |
| Superadmin | — | painel da Siow: organizações, planos, uso, suporte, impersonar com auditoria |
| Dados | isolados por `organizationId` | idem; exportação completa (LGPD/portabilidade) e exclusão da organização sob pedido |

Público do SaaS: empresas de software de gestão pública, assessorias contábeis/jurídicas, provedores de sistemas de votação, transparência, diário oficial, portais, previdência — exatamente o perfil dos parceiros do relatório consolidado (ASSESI, MS RUYAM, GILMAR, VOTAÇÃO C2, ADTR, CEOSYSTEMS, ADOIS, EDUARDO MC MOREIRA, NEEMIAS, JHEMERSON).

---

## 3. Mapa dos módulos e integrações

```
┌──────────────┐   lead vira   ┌──────────────┐  proposta vira  ┌──────────────┐  contrato gera  ┌──────────────┐
│ 1 CADASTRO   │──────────────▶│ 2 COMERCIAL  │────────────────▶│ 4 CONTRATOS  │────────────────▶│ 5 FINANCEIRO │
│ entidades,   │   entidade    │ funil,       │  (direta ou via │ minuta, vig., │  notas, OS,     │ notas, cobr., │
│ contatos,    │               │ propostas,   │  3 LICITAÇÕES)  │ aditivos,     │  alarmes        │ certidões,    │
│ agentes      │               │ atividades   │                 │ renovação     │                 │ alarmes       │
└──────┬───────┘               └──────┬───────┘                 └──────┬────────┘                 └──────┬────────┘
       │ histórico 360º               │ metas, comissões               │ vencimentos                      │ inadimplência, saúde
       ▼                              ▼                                ▼                                  ▼
┌──────────────┐               ┌──────────────┐                 ┌──────────────┐                 ┌──────────────┐
│ 6 ATENDIMENTO│◀──────────────│ 7 PARCEIROS  │                 │ 8 RELATÓRIOS │◀────────────────│ 9 INTEGRAÇÕES│
│ tickets,     │               │ & COMISSÕES  │                 │ & BI         │                 │ portais, PNCP,│
│ visitas, NPS │               │              │                 │              │                 │ WhatsApp, e-mail│
└──────────────┘               └──────────────┘                 └──────────────┘                 └──────────────┘
                                    ┌──────────────────────────────────────────────────┐
                                    │ 0 NÚCLEO: organizações, usuários, RBAC, auditoria, │
                                    │ notificações, agenda, documentos, busca, tema      │
                                    └──────────────────────────────────────────────────┘
```

**Chaves de integração (uma só verdade por conceito):**

| Conceito | Tabela dona | Quem usa |
|---|---|---|
| Entidade (órgão público) | `entities` (Cadastro) | todos; o Comercial cria a entidade no momento em que um lead é qualificado |
| Contato / agente público | `contacts` (Cadastro) + `public_agents` | Comercial (decisor), Financeiro (cobrança), Atendimento |
| Oportunidade | `opportunities` (Comercial) | Licitações (vincula edital), Contratos (origem), Parceiros (comissão) |
| Licitação | `tenders` (Licitações) | Contratos (resultado gera contrato), Certidões do Financeiro (habilitação) |
| Contrato | `contracts` (já existe no Financeiro; ganha campos comerciais) | Financeiro (notas/OS), Alarmes, Renovação, Comissões |
| Nota fiscal / cobrança / alarme | Financeiro (já existe) | Relatórios, Saúde do cliente, Comissões (base de cálculo = nota paga) |
| Parceiro / representante | `partners` | Entidades (parceiro responsável), Contratos (comissão), Relatórios |
| Atividade / tarefa | `financial_tasks` (renomear exibição para "Agenda") | agenda única: Comercial, Financeiro, Atendimento |
| Documento | `documents` + `document_blobs` | todos |
| Notificação | `notifications` (dedupeKey) | todos |

Regra: **um módulo nunca grava na tabela dona de outro**; chama o serviço do módulo dono (ex.: Comercial chama `entities.create`, Licitações chama `contracts.createFromTender`).

---

## 4. Módulo 0 — Núcleo (já existe em parte; estender)

- **Organization** (name, slug, document CNPJ, plan, modules habilitados, branding {logo, cores, nome do produto, domínio}, locale, status ACTIVE|SUSPENDED|READONLY, createdAt). Todas as tabelas de negócio recebem `organizationId` (migração: criar a organização "Siow System Tecnologia" e preencher todas as linhas existentes).
- **User** ganha `organizationId`; **PlatformAdmin** separado (superadmin da Siow). Impersonação registra `AuditLog` com `impersonatedBy`.
- **RBAC** (manter): permissões efetivas = papel + extras − removidas. Novas permissões na seção 9.
- **Agenda única** (`financial_tasks` → rótulo "Agenda"): tarefas de qualquer módulo com `module`, `entityId`, `opportunityId`, `tenderId`, `contractId`, `ticketId`, responsável, vencimento, prioridade; visão "Minha agenda" e "Da equipe".
- **Notificações** (manter dedupeKey) + central no topo (sino com contagem) + preferências por usuário (e-mail diário de resumo opcional).
- **Busca global** amplia para oportunidades, licitações, tickets, parceiros. **Busca rápida** (regras, sem IA) ganha comandos: "funil", "licitações da semana", "renovações 60 dias".
- **Documentos**: já existe; adicionar pastas lógicas por módulo e tags.
- **Tema**: escuro padrão e claro (já existe); branding da organização sobrescreve logo e as duas cores de acento.
- **Configurações** por organização: `certificates.expiringDays`, `contracts.expiringDays`, `contracts.renewalWindowDays`=90, `invoices.overdueAfterDays`, `alarms.defaultLeadDays`=5, `pipeline.stages` (JSON), `commission.defaultPercent`, `company.name`.

---

## 5. Módulo 1 — Cadastro Público (entidades, contatos, agentes)

Base: tela de Entidades atual (cards, filtros sincronizadas/não sincronizadas, com/sem contratos, com/sem notas, com/sem link, Editar, Excluir sem notas, Importar entidade por link/planilha).

Estender:

- **Entity** ganha: `ibgeCode`, `population`, `region`, `partnerId` (parceiro responsável), `segment` (PM|CM|PREVIDÊNCIA|CONSÓRCIO|DEFENSORIA|OUTRO), `lifecycle` LEAD|PROSPECT|CLIENTE|EX-CLIENTE (derivado: tem contrato ativo → CLIENTE; já teve → EX-CLIENTE; tem oportunidade aberta → PROSPECT; senão LEAD), `healthScore` (seção 8).
- **PublicAgent** (agente público): entidade, nome, cargo (Prefeito, Presidente da Câmara, Secretário, Controlador, Contador, Procurador, Pregoeiro…), partido opcional, mandato início/fim, e-mail, WhatsApp, `isDecisionMaker`, `isActive`. Troca de gestão: ao encerrar mandato, o sistema cria tarefa "Atualizar contatos após eleição" e marca contatos antigos como "verificar".
- **Importação de municípios** (IBGE) para autocompletar município/UF/código; cadastro em lote de todas as Prefeituras e Câmaras de uma UF como LEADs (opcional, com filtro por população).
- **Visão 360º** na ficha da entidade: abas atuais (Visão geral, Notas fiscais, Alarme, Contratos, Agenda, Ordens de serviço, Contatos) + **Comercial** (oportunidades e propostas), **Licitações**, **Atendimento**, **Linha do tempo** (todos os eventos de todos os módulos em ordem cronológica).

Critérios: importar uma UF inteira do IBGE cria leads sem duplicar entidades existentes (chave `type + normalizeKey(municipality) + uf`); a ficha mostra a linha do tempo unificada.

---

## 6. Módulo 2 — Comercial (funil, propostas, atividades, metas)

- **Pipeline** configurável por organização; etapas padrão: Lead → Contato feito → Qualificado → Proposta enviada → Negociação → Aguardando processo (licitação/dispensa) → Ganho → Perdido. Cada etapa tem probabilidade (%) e SLA em dias (alerta quando parada além do SLA).
- **Opportunity**: entidade (ou lead ainda sem entidade: nome livre + município/UF; vira entidade ao qualificar), título, produtos/serviços (`catalog_items` com preço base mensal/anual/único), valor mensal e total estimado, prazo esperado (meses), etapa, probabilidade, origem (indicação, parceiro, licitação pública, inbound, visita, evento), parceiro responsável, responsável interno, data prevista de fechamento, motivo de perda (concorrente, preço, sem orçamento, mudança de gestão, sem processo), concorrente, `tenderId` opcional, `contractId` quando ganha.
- **Proposal**: versões (v1, v2…), itens com quantidade/valor/periodicidade, desconto, validade, condições, modelo em PDF com logo (reaproveitar exportador), status RASCUNHO|ENVIADA|ACEITA|RECUSADA|EXPIRADA, envio por e-mail/WhatsApp com registro (manual se sem adaptador), aceite registra data e quem aceitou.
- **Atividades**: ligação, visita, reunião, e-mail, WhatsApp, demonstração; com resultado e próxima ação (gera tarefa na Agenda). Kanban + lista + calendário.
- **Metas**: por usuário/parceiro/mês: novas oportunidades, propostas enviadas, valor ganho; painel de atingimento.
- **Catálogo**: produtos e serviços da organização (Siow: aSiteGov, portal da transparência, diário oficial, site institucional, votação, protocolo, e-mail, hospedagem…), com preço de tabela e módulos.
- **Conversão em contrato**: ao marcar Ganho, abre assistente que cria o **Contract** (origem MANUAL ou vinculado ao resultado da licitação) com número, vigência, valor mensal, objeto e itens, e cria **alarme de emissão** com o dia informado. Nada é criado sem confirmação.

Integra: Cadastro (entidade/contatos), Licitações (oportunidade "Aguardando processo" aponta para o edital), Contratos/Financeiro (Ganho → contrato), Parceiros (comissão prevista), Relatórios (funil, previsão ponderada = Σ valor × probabilidade).

Critérios: mover card entre etapas registra evento com usuário/data; oportunidade parada > SLA aparece no Dashboard; "Ganho" sem contrato criado fica em pendência "Formalizar contrato".

---

## 7. Módulo 3 — Licitações e Contratações Públicas

- **Tender** (processo): entidade, modalidade (Pregão eletrônico/presencial, Concorrência, Dispensa, Inexigibilidade, Credenciamento, Adesão a ata, Registro de preços), número/ano, objeto, valor estimado, portal (PNCP, Compras.gov, BLL, Licitanet, Portal de Compras Públicas, próprio), link do edital, datas (publicação, impugnação, esclarecimentos, abertura/sessão, resultado, homologação, assinatura), status (Prospectando → Edital publicado → Em preparação → Proposta enviada → Em sessão → Vencedor/Perdedor/Deserta/Revogada → Homologado → Contratado), responsável, concorrentes e seus lances, documentos (edital, anexos, proposta, recursos), resultado (valor homologado).
- **Checklist de habilitação** gerado da lista de **Certidões** do Financeiro (CND federal/estadual/municipal, FGTS, trabalhista, falência, Junta Comercial, CNPJ, ISS, alvará, balanço, atestados de capacidade técnica): para cada item mostra validade atual, "vence antes da sessão" em vermelho e botão para anexar. Atestados de capacidade técnica são documentos reutilizáveis ligados a contratos executados.
- **Calendário de licitações**: prazos de todos os processos; alarmes 5 e 1 dia antes (notificação, dedupeKey `TENDER_DEADLINE:<id>:<campo>`).
- **Importação do PNCP** (API pública) por UF/município/objeto/palavras-chave → cria `Tender` em "Prospectando" e sugere entidade pelo CNPJ/nome; sem credencial, importação por planilha com modelo (mesmo padrão do "Importar entidade").
- **Resultado → Contrato**: ao homologar, assistente cria o contrato (vinculando edital, valor homologado, vigência) e, se existir oportunidade, marca Ganho.

Integra: Certidões (habilitação), Comercial (oportunidade), Contratos (resultado), Agenda (prazos), Documentos.

Critérios: certidão vencendo antes da sessão gera alerta; homologação sem contrato criado fica em pendência; PNCP importado não duplica (chave portal + número/ano + CNPJ do órgão).

---

## 8. Módulo 4 — Contratos (ciclo de vida) e Módulo 5 — Financeiro (existente)

**Contratos** (estende `contracts` e `contract_amendments` do Financeiro, mantendo origem SYNC/MANUAL e a regra "aba Contratos mostra só manuais; sincronizados ficam na Visão geral"):

- Campos novos: `opportunityId`, `tenderId`, `partnerId`, `commissionPercent`, `renewalType` (AUTO|ADITIVO|NOVO_PROCESSO), `renewalStatus` (NÃO_INICIADA|EM_NEGOCIAÇÃO|RENOVADO|PERDIDO), `signatureStatus`, `objectItems` (itens do catálogo), `indexation` (IPCA/IGP-M/none) e `readjustmentMonth`.
- **Minuta e assinatura**: gerar PDF a partir de modelo com variáveis; `SignatureRequest` (já existe, provider MANUAL por padrão; adaptador D4Sign/Clicksign/ZapSign).
- **Renovação**: janela `contracts.renewalWindowDays` (90) antes do fim → cria oportunidade de renovação automaticamente no funil (etapa "Negociação", valor = mensal atual × 12), tarefa para o responsável, alerta no Dashboard. Ao renovar: aditivo de prazo (e valor, se reajuste) com documento.
- **Reajuste**: no mês de reajuste, tarefa "Aplicar reajuste" com cálculo sugerido pelo índice informado manualmente (nunca buscar índice sem fonte configurada).
- **Encerramento**: status ENDED com motivo; entidade vira EX-CLIENTE se não houver outro contrato ativo; abre tarefa de "recuperação" no Comercial após 60 dias.

**Financeiro** (já em produção, não mexer no comportamento): notas sincronizadas dos portais, "+ Nova nota" manual, situação clicável uma a uma ou em lote, cobrança, certidões, OS, **alarmes de emissão** (dia do mês, aviso 5 dias antes, painel de prazos), importação por link e planilha, relatórios com logo, dashboard financeiro.

Novo que o Financeiro passa a fornecer aos outros módulos:

- **Saúde do cliente** (`healthScore` 0–100 por entidade, recalculado no cron diário): notas em atraso e dias de atraso, cobranças sem resposta, contrato a vencer sem renovação iniciada, tickets abertos, última interação. Faixas: Saudável / Atenção / Risco. Mostrado no card da entidade, no funil de renovação e no Dashboard.
- **Base de comissão**: notas PAGAS por contrato/competência (Parceiros).
- **Receita realizada × prevista** por contrato (Relatórios).

Critérios: contrato a 90 dias do fim gera oportunidade de renovação uma única vez (dedupe por contrato + vigência); renovar cria aditivo e não altera notas; `healthScore` cai quando nota atrasa e sobe quando é paga.

---

## 9. Módulo 6 — Atendimento, Módulo 7 — Parceiros e Comissões, Módulo 8 — Relatórios, Módulo 9 — Integrações

**Atendimento (relacionamento):**
- **Ticket**: entidade, contato, canal (WhatsApp, e-mail, telefone, visita, portal), categoria (suporte, financeiro, comercial, jurídico, OS), prioridade, SLA, status Aberto→Em andamento→Aguardando cliente→Resolvido→Fechado, responsável, histórico de interações, satisfação (NPS 0–10 opcional ao fechar).
- **Visitas e reuniões** com ata, participantes (agentes públicos), compromissos → tarefas.
- **Campanhas de relacionamento**: aniversário do município, posse, datas de prestação de contas; modelo de mensagem; envio manual ou via adaptador, nunca automático sem confirmação.
- Integra: Cadastro (contatos), Financeiro (ticket de cobrança abre a partir da nota), Saúde do cliente.

**Parceiros e comissões:**
- **Partner**: nome, CNPJ/CPF, tipo (representante, revenda, indicador, consórcio), contatos, % padrão, regras (sobre nota paga / sobre contrato / sobre primeira mensalidade), status.
- **Commission**: gerada automaticamente quando uma nota vinculada a contrato com `partnerId` vira PAGA (evento do Financeiro): base, %, valor, competência, status A_PAGAR|PAGA|CANCELADA; extrato por parceiro e por período; exportação PDF/XLSX.
- Portal do parceiro (opcional, fase 3): login com papel "Parceiro" que vê só suas entidades, oportunidades e comissões.
- Integra: Entidades (parceiro responsável, como no relatório consolidado de parceiros), Contratos, Financeiro (nota paga dispara comissão), Relatórios.

**Relatórios e BI** (reaproveitar exportadores e filtros globais):
- Funil comercial (por etapa, origem, parceiro, responsável), previsão ponderada, ciclo médio de venda, taxa de conversão, motivos de perda.
- Carteira: receita prevista mensal/anual (já existe), por parceiro, por UF/região, concentração (top 10 entidades).
- Renovações: contratos a vencer em 30/60/90/120 dias, status da renovação, churn (contratos encerrados no período) e recuperação.
- Licitações: pipeline por modalidade, taxa de vitória, valor homologado, prazos da semana.
- Inadimplência e cobrança (já existe) + saúde do cliente por faixa.
- Mapa por município (UF/microrregião) com clientes, prospects e leads.
- Todos exportáveis em PDF/XLSX/CSV com logo da organização e filtros aplicados no cabeçalho.

**Integrações** (abstrações com fallback manual, como no Financeiro):
- Portais de faturamento: ASSESI_PORTAL, ADOIS_PORTAL (já existem) + interface para novos.
- PNCP / Compras.gov (consulta pública de editais e contratos) — leitura.
- Receita Federal (CNPJ) e IBGE (municípios) — leitura, cache local.
- WhatsApp (Meta Cloud API) e e-mail (SMTP) — já abstraídos.
- Assinatura digital (D4Sign/Clicksign/ZapSign) — já abstraída.
- Webhooks de saída (contrato criado, nota paga, ticket aberto) para o cliente SaaS integrar ERP próprio; chaves de API por organização com escopos.

---

## 10. Modelo de dados (novas tabelas, resumo)

Todas com `id` UUID texto, `organizationId`, `createdAt`, `updatedAt`, `deletedAt`, índices por `organizationId` + chave natural.

- `organizations`, `platform_admins`, `organization_settings`, `api_keys`, `webhooks`.
- `public_agents`, `catalog_items`, `pipelines` + `pipeline_stages`, `opportunities` + `opportunity_items` + `opportunity_events`, `proposals` + `proposal_items`, `activities`, `goals`.
- `tenders` + `tender_deadlines` + `tender_competitors` + `tender_checklist_items`.
- `contracts` (colunas novas), `contract_renewals`, `signature_requests` (já existe).
- `tickets` + `ticket_messages`, `visits`, `campaigns` + `campaign_recipients`.
- `partners`, `commissions`.
- `entity_health_snapshots` (histórico diário do `healthScore`).
- `timeline_events` (visão materializada ou tabela alimentada por eventos de todos os módulos: `module`, `kind`, `entityId`, `referenceId`, `title`, `occurredAt`, `userId`).

Dinheiro `Decimal(14,2)`; datas de negócio como `DATE`; horários em UTC convertidos na interface.

---

## 11. Permissões (acrescentar ao catálogo do Financeiro)

`crm.read` · `crm.write` (oportunidades, propostas, atividades) · `crm.pipeline.manage` (editar etapas) · `catalog.manage` · `goals.manage` · `tenders.read` · `tenders.write` · `tenders.import` · `contracts.renew` · `tickets.read` · `tickets.write` · `campaigns.manage` · `partners.read` · `partners.manage` · `commissions.read` · `commissions.manage` · `organization.manage` (branding, plano, API keys) · `platform.admin` (superadmin, fora das organizações).

Papéis padrão por organização: **Administrador** (todas), **Comercial** (crm.*, tenders.*, tickets.*, partners.read, catalog.manage, `.read` do Financeiro), **Financeiro** (como hoje + commissions.*, contracts.renew), **Gestor** (todas `.read` + reports.export + goals.manage), **Parceiro** (somente suas entidades: crm.read, commissions.read), **Consulta** (`.read`).

---

## 12. Interface (manter o visual aprovado)

- Mesmo tema (escuro padrão, claro opcional), logo no topo esquerdo (da organização, no SaaS), **menu horizontal centralizado**: **Dashboard · Comercial · Licitações · Entidades · Contratos · Financeiro · Atendimento · Parceiros · Relatórios · Administração** (itens filtrados por permissão e por módulos habilitados no plano). "Financeiro" agrupa Notas, Cobranças, Certidões, Sincronização, Prazos de emissão. "← Voltar" em toda tela interna.
- **Dashboard** ganha abas: **Visão executiva** (receita prevista, carteira, funil ponderado, renovações 90 dias, inadimplência, saúde dos clientes, licitações da semana, pendências), **Financeiro** (o atual) e **Comercial** (funil, metas, atividades do dia).
- **Comercial**: Kanban por etapa com cards (entidade, valor, dias na etapa, responsável, parceiro, alerta de SLA), lista com filtros, calendário de atividades, catálogo, metas.
- **Licitações**: lista + calendário + ficha com checklist de habilitação, documentos, concorrentes, linha do tempo.
- **Contratos**: lista com filtros (vencendo em N dias, renovação status, parceiro, origem), ficha com ciclo de vida, aditivos, assinatura, renovação, alarme de emissão.
- **Atendimento**: fila de tickets por status/SLA, ficha com interações, visitas.
- **Parceiros**: lista, ficha com entidades/contratos/comissões, extrato.
- **Administração** (SaaS): Organização (branding, domínio, módulos, plano, uso), Usuários e permissões, API/webhooks, Modelos, Configurações, Auditoria. Superadmin: `/plataforma` (organizações, planos, saúde, impersonar).
- Responsivo (regras mobile já existentes: cards empilhados, menus roláveis, diálogos centralizados).

---

## 13. Fases de entrega

1. **Fase 1 — Núcleo multi-organização + Cadastro 360º** (2–3 semanas): `organizationId` em tudo com migração dos dados atuais, Organization/branding, agentes públicos, linha do tempo, lifecycle/healthScore, IBGE.
2. **Fase 2 — Comercial** (3 semanas): pipeline, oportunidades, propostas PDF, atividades, catálogo, metas, conversão em contrato + alarme, Dashboard comercial.
3. **Fase 3 — Contratos (ciclo de vida) + Parceiros/Comissões** (2–3 semanas): renovação automática no funil, reajuste, assinatura, comissão por nota paga, extratos.
4. **Fase 4 — Licitações** (3 semanas): processos, checklist de habilitação por certidões, calendário/alarmes, importação PNCP/planilha, resultado → contrato.
5. **Fase 5 — Atendimento + Relatórios/BI** (2–3 semanas): tickets, visitas, campanhas, NPS, relatórios consolidados e mapa.
6. **Fase 6 — SaaS** (2–3 semanas): onboarding, planos/bloqueio, superadmin, API keys/webhooks, domínio próprio, exportação/exclusão de organização, documentação comercial e termos (LGPD, DPA).

Cada fase: `pnpm typecheck`, `pnpm --filter @siow/web build`, testes, SQL idempotente aplicado no Neon e espelhado em `schema.sql`, deploy na Vercel, critérios de aceite verificados ao vivo, docs atualizadas (`docs/ARCHITECTURE.md`, `docs/DEPLOY-VERCEL.md`, este prompt).

---

## 14. Critérios de aceite gerais (verificar ao final de cada fase)

- Nenhuma consulta retorna dado de outra organização (teste automatizado com duas organizações e o mesmo e-mail de usuário).
- O Financeiro continua passando nos critérios do PROMPT-MESTRE v2 (CM Bom Lugar 20 notas/7 pendentes/R$ 9.240; CM Araioses 37 pagas; receita prevista do Dashboard; conflito ao sincronizar nota alterada manualmente; nada enviado sem adaptador).
- Lead → Qualificado cria a entidade uma única vez; Ganho → contrato → alarme de emissão → nota sincronizada → nota paga → comissão gerada: fluxo completo auditável de ponta a ponta.
- Contrato a 90 dias do fim aparece em "Renovações", gera oportunidade e tarefa; renovado vira aditivo com documento.
- Licitação com certidão vencendo antes da sessão exibe alerta e bloqueia "Proposta enviada" até anexar certidão válida ou justificar.
- Usuário "Parceiro" só enxerga suas entidades, oportunidades e comissões; tentativa direta na API retorna 403 e é auditada.
- Branding da organização (logo e cores) aparece no topo, no login e nos PDFs; modo claro/escuro continua funcionando.
- Exportações PDF/XLSX/CSV válidas em todos os relatórios; superadmin consegue impersonar com registro de auditoria e sair da impersonação.
