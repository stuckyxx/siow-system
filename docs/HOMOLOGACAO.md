# Homologação geral e go-live (Fase 10)

Documento de referência para homologar uma versão do Siow System antes de liberar para clientes. Executado pela primeira vez em 13/10/2026 (ver resultados ao final).

## 1. Roteiro automatizado

`scripts/homologacao.sh <url>` percorre todos os módulos com um usuário real (somente leitura + login/logout) e verifica as proteções básicas. Variáveis: `SIOW_EMAIL`, `SIOW_PASSWORD` e, opcionalmente, `SIOW_PLATFORM_EMAIL`/`SIOW_PLATFORM_PASSWORD` para o console da plataforma.

```bash
SIOW_EMAIL=admin@empresa.com.br SIOW_PASSWORD='...' scripts/homologacao.sh https://app.exemplo.com.br
```

Cada linha mostra OK/FALHA, o status HTTP esperado e obtido e o tempo de resposta (marca "(lento)" acima de 3 s). Código de saída 1 se houver falha. Rode antes de cada publicação e após cada migração.

Verificações cobertas: disponibilidade (`/api/health`), autenticação (401 sem sessão, senha errada), anti-CSRF (403 sem cabeçalho), crons e bootstrap sem bearer (401), plataforma sem sessão (401), chave de API inválida (401), e as listas/painéis de Cadastro, Financeiro, Contratos, Comercial, Licitações, Atendimento (chamados, campanhas, WhatsApp), Parceiros, Relatórios/BI, Integrações, Administração (usuários, papéis, permissões, configurações, marca, chaves) e Plataforma (visão geral, organizações, planos, faturas, marca e planos públicos). Módulos não licenciados ou sem permissão são pulados.

## 2. Roteiro manual por módulo (ponta a ponta)

Executar com um usuário administrador em organização de teste (criada pelo console da plataforma) e remover a organização ao final.

| Módulo | Fluxo a executar | Resultado esperado |
|---|---|---|
| Acesso | Login, troca de senha obrigatória, logout, 5 senhas erradas | Bloqueio por 15 min após 5 tentativas; 429 após 20 tentativas por IP |
| Cadastro | Criar entidade (CNPJ via BrasilAPI, município via IBGE), editar, contatos, inativar | Sem duplicidade (tipo + município + UF); auditoria registra |
| Contratos | Criar contrato, aditivo, renovação, anexar PDF, vencimento | Alerta de vencimento conforme `contracts.expiringDays` |
| Financeiro | Nota manual, baixa, cobrança, mensagem (modelo), OS com assinatura, certidão | Financeiro é a fonte oficial; status só muda por ação explícita e auditada |
| Sincronização | Sincronizar uma fonte, ver histórico, conflito | Nunca apaga; conflitos ficam para decisão |
| Comercial | Oportunidade → etapas → proposta → ganho/perda, metas, catálogo | Ganho pode formalizar contrato (sem duplicar) |
| Licitações | Buscar PNCP/Compras.gov, importar, prazos, calendário, formalizar | Duplicidade bloqueada por entidade + número/ano/modalidade |
| Atendimento | Chamado (SLA), interação por e-mail/WhatsApp, avaliação pública, campanha | SLA e notificações de risco; link de avaliação único |
| WhatsApp | Simular webhook de entrada, atribuir, responder (janela 24 h), encerrar | Conversa abre chamado; mensagens deduplicadas |
| Parceiros | Parceiro, regra de comissão, recomputar, pagar, portal do parceiro | Parceiro só vê o que é seu |
| Relatórios/BI | Dashboard executivo com filtros; exportar PDF/XLSX/CSV | Exportação exige `reports.export` e é auditada |
| Integrações | Configurar WhatsApp/E-mail/Clicksign (teste), webhook com entrega e reentrega | Circuito abre após 5 falhas; HMAC válido |
| Administração | Usuário, papel, permissão extra/revogada, configuração, modelo, marca, chave de API, exportação LGPD | Limites do plano respeitados |
| Plataforma | Criar organização, mudar plano/limites/módulos, fatura, bloqueio suave, pagamento, remoção lógica | Organização padrão nunca bloqueada/removida |

## 3. Segurança (revisado em 13/10/2026)

- Cabeçalhos: CSP (`default-src 'self'`), HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy. Sem `poweredByHeader`.
- Sessões: JWT de acesso 15 min + refresh rotativo 7 dias em cookies HttpOnly/SameSite=Lax; revogação em troca de senha e redefinição.
- CSRF: mutações exigem `X-Requested-With` e origem igual ao host. Chaves de API (bearer) não usam cookie.
- Força bruta: bloqueio da conta após 5 falhas (15 min) + limite por IP (login 20/15 min, plataforma 10/15 min por IP e por e-mail, autocadastro 5/h, refresh 60/15 min, avaliação pública 30/15 min) com `Retry-After`. Logins da plataforma (sucesso/falha) auditados.
- Isolamento: filtro de organização injetado no Prisma para todos os modelos de negócio (teste unitário cobre leitura, escrita e filtros aninhados); licenciamento por módulo e somente leitura aplicados no `route()`.
- Segredos: credenciais de integrações cifradas (AES-256-GCM); chaves de API e refresh tokens só em hash; senhas em scrypt.
- Auditoria append-only (trigger no banco) com `organizationId`, usuário, IP e justificativa.
- Pendências recomendadas: limite de requisições compartilhado entre instâncias (hoje por instância serverless), 2FA para administradores, rotação periódica de `CRON_SECRET`/segredos JWT.

## 4. Permissões

Todas as permissões exigidas pelas rotas existem no seed. `payments.read` está semeada e não é exigida por nenhuma rota (mantida por compatibilidade com papéis existentes). Papéis padrão: ADMINISTRADOR, FINANCEIRO, COMERCIAL, ATENDIMENTO, LEITURA, PARCEIRO (ver `packages/db/src/seed-core.ts`).

## 5. Performance e banco

Base de produção em 13/10/2026: ~50 MB; maiores tabelas `invoices` (2.425 linhas, 6 MB), `sync_runs` (2.166, 3,7 MB), `audit_logs` (451). Todas as consultas de listagem usam índices por organização/status/data. Tempo de resposta na homologação em produção: nenhuma rota acima de 3 s. Recomendações: limpar `sync_runs` com mais de 180 dias (job futuro) e instalar `pg_stat_statements` no Neon para acompanhar consultas lentas.

## 6. Backups e recuperação

- Antes de cada migração: ramo Neon `pre-faseN-backup-<data>` (hoje existem ramos das fases 1 a 9; o Neon mantém também o histórico de 24 h para restauração pontual).
- Recomendado: agendar snapshots diários no Neon (Project → Branches → Snapshots) e remover ramos de backup com mais de 30 dias.
- Documentos (PDF/imagens) ficam no Vercel Blob; o banco guarda só a referência. Exportação completa por organização em JSON (`/api/settings/export`).
- Restauração: criar ramo a partir do backup, apontar `DATABASE_URL` da Vercel para ele, ou copiar tabelas específicas.

## 7. Checklist de go-live (primeiro cliente SaaS)

1. Plano definido no console (módulos, limites, mensalidade, dias de teste).
2. Organização criada pelo onboarding (empresa → plano → administrador) com senha provisória; marca (logo/cores) configurada em Administração → Marca e plano.
3. Domínio próprio (opcional): cliente aponta CNAME para o endereço do sistema; domínio adicionado ao projeto na Vercel e informado em Plataforma → Organização → Domínio próprio.
4. Integrações do cliente (WhatsApp, e-mail SMTP, assinatura) configuradas e testadas em Administração → Integrações.
5. Usuários e papéis criados; permissões revisadas; limites do plano confirmados.
6. `scripts/homologacao.sh` executado com um usuário do cliente: 0 falhas.
7. Crons ativos: GitHub Actions (`sync-cron.yml`: sincronização 20 min, integrações, diário, plataforma) com `APP_URL` e `CRON_SECRET`; Vercel Cron como reserva.
8. Backup (ramo Neon) criado antes da liberação; snapshot diário agendado.
9. Treinamento com o manual do usuário (`docs/MANUAL-USUARIO.md`) e do administrador (`docs/MANUAL-ADMINISTRADOR.md`).
10. Fatura do primeiro período gerada após o teste; forma de pagamento combinada (registro manual no console).

## 8. Resultado da primeira execução (13/10/2026)

- Local: 66 verificações, 0 falhas, 0 lentas. Limite de tentativas confirmado (21ª tentativa de login → 429; 11ª na plataforma → 429 com `Retry-After`).
- Produção: ver seção "Executado na Fase 10" em `docs/CRM-FASE0-DIAGNOSTICO.md`.
