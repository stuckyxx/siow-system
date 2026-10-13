#!/bin/bash
# Roteiro de homologação automatizado (somente leitura + login). Percorre todos os módulos e checagens de segurança.
# Uso: SIOW_EMAIL=... SIOW_PASSWORD=... [SIOW_PLATFORM_EMAIL=... SIOW_PLATFORM_PASSWORD=...] scripts/homologacao.sh <base-url>
# Saída: uma linha por verificação (OK/FALHA, status HTTP, tempo em ms) e um resumo. Código de saída 1 se houver falha.
set -u
B=${1:?informe a URL base, ex.: https://app.exemplo.com.br}
EMAIL=${SIOW_EMAIL:?SIOW_EMAIL}; PASS=${SIOW_PASSWORD:?SIOW_PASSWORD}
J=$(mktemp); PJ=$(mktemp); H='X-Requested-With: XMLHttpRequest'; CT='Content-Type: application/json'
ok=0; fail=0; slow=0
check(){ # check <nome> <esperado> <curl args...>
  local name=$1 exp=$2; shift 2
  local out; out=$(curl -s -o /tmp/homol.body -w '%{http_code} %{time_total}' --max-time 60 "$@")
  local code=${out% *}; local t=${out#* }; local ms=$(python3 -c "print(int(float('$t')*1000))")
  local mark=OK; if [ "$code" != "$exp" ]; then mark=FALHA; fail=$((fail+1)); else ok=$((ok+1)); fi
  [ "$ms" -gt 3000 ] && slow=$((slow+1)) && mark="$mark (lento)"
  printf '%-7s %-58s esperado %s obteve %s  %6d ms\n' "$mark" "$name" "$exp" "$code" "$ms"
}
echo "### Homologação Siow System — $B — $(date -u +%Y-%m-%dT%H:%MZ)"
echo "## 0. Disponibilidade e segurança básica"
check "health (público)" 200 "$B/api/health"
check "me sem sessão → 401" 401 -H "$H" "$B/api/auth/me"
check "POST sem cabeçalho anti-CSRF → 403" 403 -H "$CT" -X POST -d '{}' "$B/api/auth/login"
check "cron sem bearer → 401" 401 "$B/api/cron/sync"
check "cron plataforma sem bearer → 401" 401 "$B/api/cron/platform"
check "bootstrap sem bearer → 401" 401 -H "$H" -X POST "$B/api/admin/bootstrap"
check "plataforma sem sessão → 401" 401 -H "$H" "$B/api/platform/organizations"
check "chave de API inválida → 401" 401 -H "Authorization: Bearer sk_xxxx_invalida" "$B/api/financeiro/entities?page=1"
check "login senha errada → 401" 401 -c $J -H "$H" -H "$CT" -X POST -d "{\"email\":\"$EMAIL\",\"password\":\"senha-incorreta-123\"}" "$B/api/auth/login"
check "login" 200 -c $J -H "$H" -H "$CT" -X POST -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" "$B/api/auth/login"
check "me" 200 -b $J -H "$H" "$B/api/auth/me"
PERMS=$(python3 -c "import json; d=json.load(open('/tmp/homol.body')); print(' '.join(d['permissions']))" 2>/dev/null || echo "")
has(){ case " $PERMS " in *" $1 "*) return 0;; *) return 1;; esac; }
echo "## 1. Cadastro e Financeiro (núcleo)"
check "dashboard financeiro" 200 -b $J -H "$H" "$B/api/financeiro/dashboard"
check "entidades (lista)" 200 -b $J -H "$H" "$B/api/financeiro/entities?page=1&pageSize=5"
EID=$(python3 -c "import json; d=json.load(open('/tmp/homol.body')); print(d['items'][0]['id'] if d.get('items') else '')" 2>/dev/null)
[ -n "$EID" ] && check "entidade (detalhe)" 200 -b $J -H "$H" "$B/api/financeiro/entities/$EID"
[ -n "$EID" ] && check "entidade (saúde)" 200 -b $J -H "$H" "$B/api/financeiro/entities/$EID/health"
[ -n "$EID" ] && check "entidade (linha do tempo)" 200 -b $J -H "$H" "$B/api/financeiro/entities/$EID/timeline"
check "contratos" 200 -b $J -H "$H" "$B/api/financeiro/contracts?page=1&pageSize=5"
check "renovações" 200 -b $J -H "$H" "$B/api/financeiro/contracts/renewals"
check "notas pendentes" 200 -b $J -H "$H" "$B/api/financeiro/invoices?page=1&pageSize=5&status=PENDING"
check "cobranças" 200 -b $J -H "$H" "$B/api/financeiro/collections?page=1&pageSize=5"
check "ordens de serviço" 200 -b $J -H "$H" "$B/api/financeiro/service-orders?page=1&pageSize=5"
check "certidões" 200 -b $J -H "$H" "$B/api/financeiro/certificates?page=1&pageSize=5"
check "alarmes" 200 -b $J -H "$H" "$B/api/financeiro/alarms"
check "prazos (alarmes)" 200 -b $J -H "$H" "$B/api/financeiro/alarms/deadlines"
check "tarefas" 200 -b $J -H "$H" "$B/api/financeiro/tasks?page=1&pageSize=5"
FROM=$(date -u +%Y-%m-01); TO=$(date -u -d "+2 months" +%Y-%m-01 2>/dev/null || date -u -v+2m +%Y-%m-01)
check "agenda" 200 -b $J -H "$H" "$B/api/financeiro/tasks/calendar?from=$FROM&to=$TO"
check "sincronização (visão)" 200 -b $J -H "$H" "$B/api/financeiro/sync/overview"
check "notificações" 200 -b $J -H "$H" "$B/api/notifications"
echo "## 2. Comercial"
if has crm.read; then
check "dashboard comercial" 200 -b $J -H "$H" "$B/api/comercial/dashboard"
check "oportunidades" 200 -b $J -H "$H" "$B/api/comercial/opportunities?page=1&pageSize=5"
check "quadro (kanban)" 200 -b $J -H "$H" "$B/api/comercial/opportunities/board"
check "funis" 200 -b $J -H "$H" "$B/api/comercial/pipelines"
check "catálogo" 200 -b $J -H "$H" "$B/api/comercial/catalog"
else echo "pulado (sem crm.read ou módulo não licenciado)"; fi
echo "## 3. Licitações"
if has tenders.read; then
check "licitações" 200 -b $J -H "$H" "$B/api/licitacoes?page=1&pageSize=5"
check "calendário" 200 -b $J -H "$H" "$B/api/licitacoes/calendar?from=$FROM&to=$TO"
else echo "pulado"; fi
echo "## 4. Atendimento"
if has tickets.read; then
check "chamados" 200 -b $J -H "$H" "$B/api/atendimento/tickets?page=1&pageSize=5"
check "estatísticas de chamados" 200 -b $J -H "$H" "$B/api/atendimento/tickets/stats"
check "campanhas" 200 -b $J -H "$H" "$B/api/atendimento/campanhas"
check "WhatsApp conversas" 200 -b $J -H "$H" "$B/api/atendimento/whatsapp/conversations"
check "WhatsApp estatísticas" 200 -b $J -H "$H" "$B/api/atendimento/whatsapp/stats"
else echo "pulado"; fi
echo "## 5. Parceiros"
if has partners.read; then
check "parceiros" 200 -b $J -H "$H" "$B/api/parceiros"
check "comissões" 200 -b $J -H "$H" "$B/api/parceiros/commissions?page=1&pageSize=5"
check "comissões (resumo)" 200 -b $J -H "$H" "$B/api/parceiros/commissions/summary"
else echo "pulado"; fi
echo "## 6. Relatórios e BI"
if has reports.read; then
check "catálogo de relatórios" 200 -b $J -H "$H" "$B/api/financeiro/reports/catalog"
check "relatório recebíveis por entidade (json)" 200 -b $J -H "$H" "$B/api/financeiro/reports?report=receivables_by_entity&format=json"
check "dashboard executivo (BI)" 200 -b $J -H "$H" "$B/api/bi/executive"
else echo "pulado"; fi
echo "## 7. Integrações"
if has integrations.manage; then
check "integrações (catálogo)" 200 -b $J -H "$H" "$B/api/integracoes"
check "webhooks" 200 -b $J -H "$H" "$B/api/integracoes/webhooks"
check "logs de integração" 200 -b $J -H "$H" "$B/api/integracoes/logs"
check "consulta IBGE (municípios MA)" 200 -b $J -H "$H" "$B/api/integracoes/lookup/ibge/municipios?uf=MA"
else echo "pulado"; fi
echo "## 8. Administração"
if has users.manage; then
check "usuários" 200 -b $J -H "$H" "$B/api/users"
check "papéis" 200 -b $J -H "$H" "$B/api/users/roles"
check "permissões" 200 -b $J -H "$H" "$B/api/permissions"
fi
if has settings.manage; then
check "configurações" 200 -b $J -H "$H" "$B/api/settings"
check "marca" 200 -b $J -H "$H" "$B/api/settings/branding"
check "chaves de API" 200 -b $J -H "$H" "$B/api/settings/api-keys"
fi
has audit.read && check "auditoria" 200 -b $J -H "$H" "$B/api/audit?page=1&pageSize=5"
echo "## 9. Plataforma (SaaS)"
if [ -n "${SIOW_PLATFORM_EMAIL:-}" ]; then
check "login plataforma" 200 -c $PJ -H "$H" -H "$CT" -X POST -d "{\"email\":\"$SIOW_PLATFORM_EMAIL\",\"password\":\"${SIOW_PLATFORM_PASSWORD:-}\"}" "$B/api/platform/auth/login"
check "visão geral" 200 -b $PJ -H "$H" "$B/api/platform/overview"
check "organizações" 200 -b $PJ -H "$H" "$B/api/platform/organizations"
check "planos" 200 -b $PJ -H "$H" "$B/api/platform/plans"
check "faturas" 200 -b $PJ -H "$H" "$B/api/platform/invoices"
check "marca pública" 200 "$B/api/public/branding"
check "planos públicos" 200 "$B/api/public/plans"
else echo "pulado (defina SIOW_PLATFORM_EMAIL/SIOW_PLATFORM_PASSWORD)"; fi
echo "## 10. Logout"
check "logout" 200 -b $J -c $J -H "$H" -X POST "$B/api/auth/logout"
check "me após logout → 401" 401 -b $J -H "$H" "$B/api/auth/me"
echo
echo "RESUMO: $ok ok, $fail falhas, $slow respostas acima de 3 s"
rm -f $J $PJ /tmp/homol.body
[ "$fail" -eq 0 ]
