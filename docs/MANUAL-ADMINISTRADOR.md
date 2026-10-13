# Manual do administrador — Siow System

## Administração (menu → Administração)

### Usuários
Criar usuário (nome, e-mail, senha provisória, papel). Troca de senha obrigatória no primeiro acesso. "Redefinir senha" gera senha provisória e encerra as sessões. Desativar mantém o histórico. "Redefinir 2FA" desliga a autenticação em dois fatores de quem perdeu o autenticador (auditado). O limite de usuários ativos é o do plano.

### Papéis e permissões
Papéis padrão (ADMINISTRADOR, FINANCEIRO, COMERCIAL, ATENDIMENTO, LEITURA, PARCEIRO) e permissões por código (`entities.read`, `invoices.write`, ...). É possível conceder/revogar permissões individuais a um usuário (aparecem como +N/−N).

### Configurações
Parâmetros da organização: dias de alerta de certidão/contrato, cron de sincronização, nome da empresa, SLA por prioridade, distribuição automática do WhatsApp, motivos de perda. Toda alteração é auditada.

### Modelos de mensagem
Modelos de e-mail/WhatsApp com variáveis (entidade, nota, valor, vencimento...). Usados em cobranças, campanhas e chamados.

### Integrações
WhatsApp Cloud (token, número, conta), e-mail SMTP, assinatura eletrônica (Clicksign), consultas CNPJ/IBGE, PNCP/Compras.gov. Botão "Testar" valida as credenciais; após 5 falhas o circuito abre por 15 min. Webhooks de saída: URL, eventos, segredo HMAC (`X-Siow-Signature`), reentrega com recuo progressivo e histórico de entregas.

### Marca e plano
Logotipo (PNG/JPEG/SVG/WebP até 1 MB), nome do produto, subtítulo, cores, e-mail de suporte. Mostra o plano, limites e módulos licenciados. "Exportar dados da organização" gera JSON completo (LGPD/portabilidade), registrado na auditoria.

### Chaves de API
Para integrações externas: `Authorization: Bearer sk_...` nas rotas `/api`. A chave aparece uma única vez; as permissões nunca excedem as de quem criou. Revogar invalida imediatamente.

### Auditoria
Registro imutável de ações (quem, quando, IP, antes/depois, justificativa). Filtros por recurso, usuário e período.

## Console da plataforma (Siow) — `/plataforma`
Acesso exclusivo com credencial de superadmin (independente das organizações).
- **Visão geral**: organizações por situação, assinaturas, MRR, faturas vencidas.
- **Organizações**: onboarding em 3 passos (empresa → plano → administrador); por organização: dados, domínio próprio, limites, módulos, situação (ativa / somente leitura / suspensa), assinatura (plano, situação, mensalidade, dia de vencimento, carência, fim do teste), faturas (gerar, marcar paga, cancelar), uso e exportação LGPD, remoção lógica (só sem dados de negócio).
- **Planos**: chave, nome, mensalidade, limites, módulos, dias de teste, público (aparece no autocadastro).
- **Faturas**: todas as faturas de assinatura; "Executar cobrança" roda a rotina do cron agora.
- **Configurações**: autocadastro (`/cadastro`) ligado/desligado e plano padrão; troca da senha e 2FA do superadmin (recomendado).
- **E-mails automáticos**: boas-vindas, fatura emitida/vencida, bloqueio e reativação são enviados aos administradores da organização pelo provedor de e-mail configurado em Administração → Integrações da organização Siow.

### Ciclo de cobrança
Teste → Ativa → Em atraso (fatura vencida) → Bloqueada após a carência (organização em somente leitura: consulta liberada, alterações bloqueadas, faixa explicativa) → Ativa ao registrar o pagamento. Isenta não gera faturas. A organização padrão (Siow) nunca é bloqueada.

## Operação
- **Crons**: GitHub Actions `sync-cron.yml` (sincronização a cada 20 min + integrações; diário 09:00 UTC + cobrança da plataforma) usando `APP_URL` e `CRON_SECRET`; Vercel Cron diário como reserva (`apps/web/vercel.json`).
- **Variáveis na Vercel**: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`, `INTEGRATION_SECRET_KEY` (opcional), `APP_URL`, SMTP/WhatsApp (opcionais; o painel de Integrações substitui), `ANTHROPIC_API_KEY` (ativa o Assistente virtual; opcional `ASSISTANT_MODEL`, padrão `claude-opus-5-5`).
- **Migrações**: `packages/db/prisma/schema.sql` é idempotente; crie um ramo de backup no Neon antes de aplicar. Depois: `POST /api/admin/bootstrap` com bearer `CRON_SECRET` reaplica permissões/papéis.
- **Homologação**: `scripts/homologacao.sh <url>` (ver `docs/HOMOLOGACAO.md`).
- **Backups**: ramos Neon por fase + snapshots diários recomendados; documentos no Vercel Blob.
- **Domínio próprio do cliente**: cliente cria CNAME → domínio adicionado ao projeto na Vercel → informado na organização (Plataforma). O login e as cores passam a usar a marca do cliente nesse domínio.
