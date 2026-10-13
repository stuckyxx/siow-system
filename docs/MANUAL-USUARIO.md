# Manual do usuário — Siow System

## Acesso
- Entre em `/login` com e-mail e senha. No primeiro acesso (ou após redefinição) o sistema pede uma nova senha: mínimo 10 caracteres com letras, números e símbolo.
- Após 5 senhas erradas a conta fica bloqueada por 15 minutos. "Esqueci minha senha": peça ao administrador uma redefinição.
- O menu mostra só os módulos que o seu papel e o plano da sua empresa permitem. O botão "Claro/Escuro" alterna o tema.

## Dashboard
Visão executiva com recebíveis, inadimplência, contratos, funil comercial, licitações e atendimento. Filtros por período, UF, município, entidade e responsável. Os números do Financeiro são a fonte oficial.

## Entidades
Cadastro de prefeituras, câmaras e demais órgãos. Use "Buscar CNPJ" para preencher pela Receita e "IBGE" para o município. Cada entidade tem abas: resumo, contratos, notas, cobranças, documentos, certidões, agentes, atendimento e linha do tempo. Não há exclusão física: inativar mantém o histórico.

## Contratos
Vigência, valores, aditivos, renovações e documentos. Alertas de vencimento aparecem nas notificações (sino) e no painel de alarmes. Renovações geram oportunidade e tarefa automaticamente.

## Financeiro
- **Central**: cartões de recebíveis, pendências, notas por situação.
- **Notas**: lista com filtros; a baixa (pagamento) é uma ação explícita e auditada. Alterações em lote exigem justificativa.
- **Cobranças**: réguas de cobrança por nota; envio de mensagens por e-mail/WhatsApp com modelos.
- **Ordens de serviço**: emissão, envio para assinatura eletrônica e acompanhamento.
- **Certidões e alarmes**: validade das certidões e prazos de emissão.
- **Agenda**: tarefas do dia, por responsável.
- **Sincronização**: importa notas do Portal do Cliente; nunca apaga nem altera dados manuais; conflitos ficam para decisão.

## Comercial
Quadro (kanban) de oportunidades por etapa, propostas com itens do catálogo, metas, motivos de perda. Ganhar uma oportunidade pode formalizar o contrato sem duplicar.

## Licitações
Busca no PNCP/Compras.gov, importação de planilha, prazos no calendário, documentos e formalização do contrato ao vencer.

## Atendimento
- **Chamados**: abertura por entidade/contato, prioridade com SLA, interações (nota interna, e-mail, WhatsApp), anexos, tarefas, encerramento com link de avaliação para o cliente.
- **Campanhas**: envio em massa com modelos e acompanhamento.
- **WhatsApp**: central com conversas atribuídas automaticamente; respostas livres dentro de 24 h da última mensagem do contato, modelos aprovados fora da janela.

## Parceiros
Cadastro de parceiros, regras de comissão, apuração e pagamento. Usuários com o papel PARCEIRO acessam só o "Meu portal".

## Relatórios
Catálogo agrupado por área, com indicação de natureza (oficial/gerencial). Exportação em PDF, XLSX e CSV (requer permissão e é registrada).

## Assistente virtual
No menu **Assistente**, escreva o que precisa em linguagem natural e o assistente faz por você: cadastrar entidade ("cadastre a Prefeitura Municipal de Tuntum (MA)"), contrato ("crie o contrato 012/2026 de R$ 4.500 mensais para a Câmara de Bom Lugar até 31/12/2026"), oportunidade ("abra um lead para a Prefeitura de Bacabal de R$ 3.000/mês"), tarefa, chamado, licitação, além de consultas ("quais notas estão pendentes este mês?"). Ele consulta antes de agir, reaproveita cadastros existentes em vez de duplicar e preenche o código IBGE automaticamente. Pedidos encadeados funcionam ("cadastre X e crie um contrato…").
- Ele usa **as suas permissões**: o que você não pode fazer pela tela, ele também não faz.
- **Ações sensíveis** (excluir, dar baixa em notas, enviar mensagens, fechar oportunidades, sincronizar tudo, administrar usuários) só acontecem depois que você clica em **Confirmar e executar** no cartão amarelo mostrado no chat.
- "Ações executadas" em cada resposta mostra o que foi feito; tudo fica registrado na auditoria.
- Anexar arquivos (PDF de contrato, documentos) continua sendo feito pelas telas; o assistente orienta o caminho.
- **Falar em vez de digitar**: toque no microfone, fale o pedido e toque em parar. O texto aparece na caixa para você conferir e enviar. Com a transcrição configurada em Integrações funciona em qualquer navegador (inclusive no celular); sem ela, usa o reconhecimento de voz do Chrome/Edge.
- **Ler respostas**: ligue para ouvir as respostas em voz alta.
- **Histórico**: suas conversas ficam salvas (só você as vê). Abra uma conversa anterior para continuar de onde parou ou exclua-a.
- **Áudios do WhatsApp**: com a transcrição configurada, os áudios recebidos na Central de atendimento aparecem já transcritos (🎙️), além do anexo.
- Se aparecer "não configurado", peça ao administrador para ativar a chave do assistente.

## Notificações e busca
Sino no topo lista alertas (certidões, contratos, tarefas, SLA). A busca global encontra entidade, município, nota ou contrato; a "Busca rápida" (canto inferior) aceita atalhos.

## Senha e 2FA
"Senha" no topo abre a troca de senha (as demais sessões são encerradas) e a **autenticação em dois fatores**: "Configurar 2FA" mostra uma chave para cadastrar no aplicativo autenticador (Google/Microsoft Authenticator, Authy…); confirme com o código de 6 dígitos. A partir daí o login pede o código após a senha. Perdeu o celular? O administrador pode redefinir o 2FA em Administração → Usuários.
