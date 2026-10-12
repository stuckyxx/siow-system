# PROMPT MESTRE v2 — SIOW SYSTEM · Plataforma Integrada de CRM, Gestão Comercial e Contratos Públicos

> Versão fornecida pela Siow System Tecnologia em 12/10/2026. Substitui `PROMPT-MESTRE-CRM-v1.md` como referência do CRM; o `PROMPT-MESTRE-v2.md` (Financeiro) continua valendo. O diagnóstico da Fase 0 está em `docs/CRM-FASE0-DIAGNOSTICO.md`.

## 1. Papel da IA e objetivo

Atue como arquiteto de software, engenheiro full-stack sênior, especialista em sistemas SaaS e product designer. Sua missão é evoluir o Siow System, atualmente com módulo Financeiro em produção, para uma plataforma completa de gestão comercial, contratos públicos, licitações, faturamento, relacionamento e inteligência de negócios. O sistema deverá conter 9 módulos operacionais + 1 núcleo administrativo, totalmente integrados.

Princípio fundamental: desenvolver uma plataforma única, modular, segura, intuitiva e escalável, sem reconstruir funcionalidades existentes ou comprometer os dados financeiros.

Duas modalidades com uma única base de código: **Edição Própria** (uso interno da Siow System Tecnologia) e **Edição SaaS/White-label** (comercialização para outras empresas, com organizações, usuários, permissões e marcas independentes).

## 2. Arquitetura existente — preservação obrigatória

Antes de qualquer implementação, examine o repositório e `docs/PROMPT-MESTRE-v2.md`. Preserve a stack atual: monorepo pnpm; Next.js 15 App Router e TypeScript; PostgreSQL Neon; Prisma 6; Vercel e Vercel Blob; Tailwind CSS 4; TanStack Query; Zod; Vitest; pacotes compartilhados; integrações ASSESI e ADOIS; autenticação, permissões e identidade visual existentes. Mantenha os projetos opcionais Docker/VPS compiláveis. Não substitua bibliotecas, serviços, banco, autenticação ou componentes sem justificativa técnica e aprovação.

Regras invioláveis: (1) nunca apagar ou sobrescrever dados reais sem autorização; (2) nunca duplicar entidades, contatos, contratos ou notas fiscais; (3) nunca inventar informações financeiras ou de licitações; (4) preservar histórico e auditoria; (5) aplicar permissões e isolamento de dados no backend; (6) usar operações idempotentes; (7) não simular integrações ou confirmações de envio; (8) não executar alterações em produção sem aprovação; (9) interface em português brasileiro; (10) entregar funcionalidades reais, testadas e integradas.

## 3. Estrutura dos 10 módulos

**Módulo 0 — Núcleo administrativo:** organizações e configurações; usuários, papéis e permissões; autenticação e sessões; auditoria; agenda e tarefas compartilhadas; notificações; documentos e anexos; busca global; configurações; identidade visual e temas; administração SaaS; planos, licenças e módulos habilitados. Toda informação de negócio pertence a uma organização, com isolamento verificado no backend e, quando apropriado, por restrições no banco.

**Módulo 1 — Cadastro Público:** prefeituras, câmaras, autarquias, institutos, consórcios e demais entidades; cadastro por CNPJ, município, UF e segmento; contatos e agentes públicos; gestores e responsáveis por setores; histórico de relacionamento; importação por planilha e links existentes; integração IBGE; identificação de clientes ativos, prospects e ex-clientes; responsável comercial e parceiro vinculado; ficha 360º. Regra: uma entidade possui cadastro único compartilhado entre os módulos.

**Módulo 2 — CRM Comercial:** leads e prospecção; funil configurável; oportunidades; propostas com versões e PDF; catálogo de produtos e serviços; visitas, ligações, reuniões e atividades; responsáveis; metas individuais e por equipe; histórico de negociações; motivos de perda; previsão de vendas; alertas de oportunidades paradas; conversão de oportunidade em contrato. Funil inicial: Lead → Contato realizado → Qualificado → Proposta → Negociação → Aguardando contratação → Ganho ou Perdido, personalizável por organização. Ao ganhar, iniciar a formalização contratual; a oportunidade não gera contrato ativo sem confirmação da contratação.

**Módulo 3 — Licitações e Contratações:** pregões, concorrências, dispensas, inexigibilidades, credenciamentos, registros de preços, adesões a atas; editais e anexos; prazos e sessões; propostas; concorrentes e resultados; homologações; checklist de habilitação; certidões e documentos; importação por PNCP e planilhas; calendário e alertas. Vincular a oportunidades, entidades e contratos; identificadores oficiais contra duplicidade.

**Módulo 4 — Gestão de Contratos:** cadastro e formalização; número, objeto e valor; vigência; itens e serviços; aditivos; reajustes; prorrogações; minutas e documentos; assinaturas; histórico; renovações; encerramentos; alertas de vencimento; vínculo com licitação e oportunidade; parceiros e comissões; situação financeira do contrato. Regra: reutilizar a tabela `contracts` e os serviços existentes. Renovações geram oportunidades e tarefas; nenhum aditivo é formalizado automaticamente sem confirmação.

**Módulo 5 — Financeiro (existente, preservação obrigatória):** notas fiscais; sincronização ASSESI/ADOIS; cadastro manual; contas e recebimentos; cobranças; certidões; ordens de serviço; alarmes de emissão; relatórios; importações; dashboard; conflitos de sincronização. Novas integrações: receita prevista por contrato, faturada e recebida; inadimplência por cliente; histórico financeiro no CRM; base para comissões; saúde financeira dos clientes. Regra: previsão, faturamento e recebimento são informações distintas. O Financeiro é a fonte oficial das informações financeiras.

**Módulo 6 — Atendimento e Relacionamento:** tickets e chamados; solicitações comerciais e financeiras; atendimento técnico; visitas; reuniões e atas; histórico de interações; responsáveis; prazos; prioridades e SLA; satisfação; campanhas; tarefas de acompanhamento. Tudo aparece na ficha 360º.

**Módulo 7 — Parceiros e Comissões:** parceiros, representantes e indicadores; empresas parceiras; entidades vinculadas; oportunidades originadas; contratos; percentuais e regras de remuneração; comissões previstas, realizadas, pagas e pendentes; extratos; portal do parceiro restrito. Regra: comissões seguem as condições contratuais; quando dependerem de recebimento, considerar só pagamentos confirmados, inclusive parciais, estornos e cancelamentos; impedir duplicidade.

**Módulo 8 — Relatórios e BI:** total de clientes, ativos e inativos; oportunidades; conversão; valor do funil; receita prevista, faturada e recebida; inadimplência; contratos ativos e a vencer; renovações; licitações em andamento; taxa de vitória; desempenho comercial; metas; comissões; resultados por parceiro, município e UF; saúde da carteira. Filtros por período, entidade, município, UF, responsável e parceiro; exportação PDF, Excel e CSV com os exportadores existentes; distinguir dados confirmados, projeções e indicadores calculados.

**Módulo 9 — Integrações:** ASSESI, ADOIS, PNCP, Compras.gov, IBGE, consulta de CNPJ por fonte autorizada, WhatsApp Business API, e-mail, assinatura eletrônica, webhooks, APIs externas, importação/exportação. Cada integração com adaptador independente, configuração por organização, controle de credenciais, logs, tratamento de falhas, tentativas controladas, proteção contra duplicidade, histórico e modo manual. Nunca apresentar ação como concluída sem confirmação real.

## 4. Integração entre módulos

Arquitetura modular com serviços de domínio e uma única fonte de verdade por conceito. Fluxo: Cadastro → CRM → Licitação (quando necessária) → Contrato → Financeiro → Recebimento → Comissão → Relatórios; Atendimento, Agenda, Documentos e Notificações acompanham todo o fluxo. Entidades pertencem ao Cadastro; oportunidades ao CRM; processos a Licitações; contratos à Gestão Contratual; notas e recebimentos ao Financeiro; comissões a Parceiros; Relatórios só consultam. Comunicação por serviços internos, transações e eventos persistentes quando necessário; sem microserviços desnecessários; identificadores compartilhados, validação de organização, integridade referencial e idempotência.

## 5. Banco de dados e segurança

Manter PostgreSQL Neon e Prisma 6; reutilizar tabelas; novas tabelas só com necessidade comprovada. Padrões: `organizationId`, UUID, `createdAt`/`updatedAt`/`deletedAt`, auditoria append-only, `Decimal`, datas padronizadas, índices, integridade, isolamento, Zod, permissões no servidor. Migrações SQL idempotentes e reversíveis quando possível; antes de migrar produção, apresentar plano de backup, validação, riscos e recuperação. LGPD: retenção, exportação e exclusão/anonimização.

## 6. Interface e experiência

Preservar o tema Aurora: escuro padrão, claro, responsivo, componentes, navegação simples, filtros consistentes, tabelas e cards padronizados, botão de retorno. Menu: Dashboard | Comercial | Licitações | Entidades | Contratos | Financeiro | Atendimento | Parceiros | Relatórios | Administração (Integrações dentro da Administração), respeitando permissões e módulos habilitados. Dashboard em Executivo, Comercial e Financeiro.

## 7. Automações inteligentes

Regras verificáveis: oportunidades sem movimentação; contratos próximos do vencimento; tarefas de renovação sem duplicidade; certidões vencendo; prazos de licitações; indicadores após recebimentos; comissões conforme regras aprovadas; clientes inadimplentes; histórico 360º; indicadores gerenciais. Fórmulas e pesos configuráveis para a saúde do cliente, distinguindo dados ausentes de situações negativas. Nenhuma automação realiza ação externa irreversível sem autorização.

## 8. Edição SaaS / White-label

Organizações independentes, isolamento, logo e cores, domínio próprio, planos, licenciamento por módulo, controle de usuários e de entidades ativas, cobrança de assinaturas, bloqueio suave, onboarding, administração da plataforma, exportação, auditoria, APIs e webhooks por organização. A Edição Própria usa a mesma arquitetura com uma organização; cobrança SaaS e administração de clientes externos ativadas só na fase correspondente.

## 9. Plano de desenvolvimento

Fase 0 — Diagnóstico e planejamento (sem modificar código). Fase 1 — Núcleo e Cadastro. Fase 2 — CRM Comercial. Fase 3 — Contratos e integração financeira. Fase 4 — Parceiros e Comissões. Fase 5 — Licitações. Fase 6 — Atendimento. Fase 7 — Relatórios e BI. Fase 8 — Integrações externas. Fase 9 — SaaS e White-label. Fase 10 — Homologação geral. Preservar e usar as integrações existentes desde as fases anteriores.

## 10. Critérios de qualidade e aceite

Por fase: TypeScript e build sem erros; testes relevantes; integrações preservadas; nenhuma perda de dados; nenhuma duplicidade; permissões no backend; isolamento testado; interface responsiva; logs e auditoria; documentação. Executar `pnpm typecheck`, `pnpm --filter @siow/web build`, Vitest, testes de integração e de regressão do Financeiro (CM Bom Lugar, CM Araioses, receita prevista, conflitos, notas). Testar o fluxo completo Lead → Oportunidade → Proposta → Licitação → Contrato → Alarme → Nota → Recebimento → Comissão → Relatório → Renovação. Nenhuma fase é concluída só porque o código foi gerado.

## 11. Padrão de execução da IA

Para cada fase: 1 Diagnóstico; 2 Planejamento (arquivos, tabelas, serviços, telas, integrações, testes, critérios); 3 Aprovação antes de alterações relevantes; 4 Implementação do escopo aprovado; 5 Validação; 6 Entrega com resumo, testes, limitações, pendências e próximos passos. Não afirmar conclusão sem confirmação verificável. Não aplicar SQL em produção nem publicar sem autorização.

## 12. Resultado final esperado

Siow System — Plataforma Integrada de Gestão Comercial e Contratos Públicos: Núcleo, Cadastro Público, CRM Comercial, Licitações, Gestão de Contratos, Financeiro integrado, Atendimento, Parceiros e Comissões, Relatórios e BI, Integrações; cadastros, permissões, histórico e informações compartilhados; jornada da prospecção ao recebimento e à renovação; funcionando para a Siow e preparada para SaaS/White-label.

## 13. Comando inicial

Iniciar exclusivamente pela Fase 0: ler o código e `docs/PROMPT-MESTRE-v2.md`; apresentar diagnóstico da arquitetura, inventário, mapa de integração dos dez módulos, reutilização, riscos para o Financeiro, plano de banco e migração, sequência técnica e critérios de aceite da Fase 1. Não escrever nem modificar código antes da aprovação do diagnóstico.
