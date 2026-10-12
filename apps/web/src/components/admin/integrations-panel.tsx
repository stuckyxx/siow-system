'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatBrDateTime } from '@siow/shared';
import { api } from '@/lib/api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Empty, Field, Input, Select, Table, Td, Th, useToast } from '@/components/ui';
import { errMsg } from '@/components/crm/opportunity-form';

interface FieldDef { key: string; label: string; secret?: boolean; placeholder?: string; help?: string; required?: boolean }
interface Integration { key: string; label: string; description: string; manualFallback: string | null; providers: Array<{ key: string; label: string; fields: FieldDef[] }>; provider: string; isEnabled: boolean; status: string; source: string; configured: boolean; config: Record<string, string>; secrets: Record<string, string | null>; lastTestAt: string | null; lastTestOk: boolean | null; lastError: string | null; consecutiveFailures: number; circuitOpenUntil: string | null }
interface LogRow { id: string; integrationKey: string; provider: string; action: string; status: string; attempt: number; durationMs: number | null; error: string | null; referenceType: string | null; referenceId: string | null; createdAt: string; request: unknown; response: unknown }
interface Webhook { id: string; name: string; url: string; events: string[]; isActive: boolean; hasSecret: boolean; secretMasked: string | null; consecutiveFailures: number; lastDeliveryAt: string | null; lastStatus: string | null; pending: number; failed: number; sent: number }
interface Delivery { id: string; event: string; status: string; attempts: number; responseStatus: number | null; error: string | null; nextAttemptAt: string; deliveredAt: string | null; createdAt: string }

const STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'critical' | 'neutral' }> = { CONFIGURED: { label: 'Configurada', tone: 'good' }, NOT_CONFIGURED: { label: 'Não configurada', tone: 'neutral' }, ERROR: { label: 'Com falhas', tone: 'critical' } };
const SOURCE: Record<string, string> = { db: 'configurada aqui', env: 'variáveis de ambiente', default: 'pública (sem credenciais)', none: '—' };
const EVENT_LABEL: Record<string, string> = { 'ticket.created': 'Chamado aberto', 'ticket.resolved': 'Chamado resolvido', 'opportunity.won': 'Oportunidade ganha', 'opportunity.lost': 'Oportunidade perdida', 'contract.activated': 'Contrato ativado', 'contract.terminated': 'Contrato encerrado', 'invoice.paid': 'Nota paga', 'tender.status_changed': 'Situação da licitação', 'campaign.finished': 'Campanha concluída', 'test.ping': 'Teste' };

export function IntegrationsPanel() {
  const qc = useQueryClient();
  const [toast, showToast] = useToast();
  const [editing, setEditing] = useState<Integration | null>(null);
  const [logKey, setLogKey] = useState('');
  const { data } = useQuery({ queryKey: ['integrations'], queryFn: () => api<Integration[]>('/integracoes') });
  const { data: logs } = useQuery({ queryKey: ['integration-logs', logKey], queryFn: () => api<{ items: LogRow[]; total: number }>('/integracoes/logs', { query: { key: logKey || undefined, pageSize: 30 } }) });
  const refresh = (): void => { void qc.invalidateQueries({ queryKey: ['integrations'] }); void qc.invalidateQueries({ queryKey: ['integration-logs'] }); };
  const test = useMutation({ mutationFn: (key: string) => api<{ ok: boolean; message: string }>(`/integracoes/${key}/test`, { method: 'POST' }), onSuccess: (r) => { refresh(); showToast(`${r.ok ? '✔' : '✖'} ${r.message}`); }, onError: (e) => showToast(errMsg(e)) });
  return (
    <div className="space-y-4">
      <p className="small muted">Cada integração tem adaptador próprio, configuração por organização com segredos cifrados, log de chamadas, tentativas controladas e modo manual. Nada é marcado como enviado/assinado sem confirmação do provedor. Após 5 falhas seguidas, o circuito abre por 15 minutos e o fluxo cai para manual.</p>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {data?.map((i) => (
          <div key={i.key} className="card"><div className="bd">
            <div className="row between" style={{ alignItems: 'flex-start' }}><div><b>{i.label}</b><div className="small muted">{i.description}</div></div><Badge tone={i.isEnabled ? STATUS[i.status]?.tone ?? 'neutral' : 'neutral'}>{i.isEnabled ? STATUS[i.status]?.label ?? i.status : 'Desativada'}</Badge></div>
            <div className="small muted" style={{ marginTop: 6 }}>Provedor: {i.providers.find((p) => p.key === i.provider)?.label ?? i.provider} · origem: {SOURCE[i.source] ?? i.source}{i.lastTestAt ? ` · teste ${formatBrDateTime(i.lastTestAt)} ${i.lastTestOk ? 'ok' : 'falhou'}` : ''}{i.circuitOpenUntil && new Date(i.circuitOpenUntil) > new Date() ? ` · circuito aberto até ${formatBrDateTime(i.circuitOpenUntil)}` : ''}</div>
            {i.lastError && <div className="small" style={{ color: 'var(--crit)', marginTop: 4 }}>{i.lastError}</div>}
            {i.manualFallback && <div className="small muted" style={{ marginTop: 4 }}>{i.manualFallback}</div>}
            <div className="row" style={{ marginTop: 8, gap: 6 }}><Button size="sm" variant="secondary" onClick={() => setEditing(i)}>Configurar</Button><Button size="sm" variant="ghost" onClick={() => test.mutate(i.key)} disabled={test.isPending || !i.isEnabled}>Testar conexão</Button><Button size="sm" variant="ghost" onClick={() => setLogKey(i.key)}>Logs</Button></div>
          </div></div>
        ))}
      </div>
      {editing && <IntegrationDialog i={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); showToast('Integração salva'); }} />}
      <WebhooksSection onToast={showToast} />
      <Card>
        <CardHeader><CardTitle>Log de chamadas externas</CardTitle><Select value={logKey} onChange={(e) => setLogKey(e.target.value)} className="w-56"><option value="">Todas as integrações</option>{data?.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}<option value="WEBHOOK">Webhooks de saída</option></Select></CardHeader>
        <CardContent>{!logs ? <p className="small muted">Carregando…</p> : logs.items.length === 0 ? <Empty>Sem chamadas registradas</Empty> : (
          <div className="tbl"><Table><thead><tr><Th>Quando</Th><Th>Integração</Th><Th>Ação</Th><Th>Resultado</Th><Th className="r">Tentativa</Th><Th className="r">ms</Th><Th>Detalhe</Th></tr></thead>
            <tbody>{logs.items.map((l) => <tr key={l.id}><Td className="small num">{formatBrDateTime(l.createdAt)}</Td><Td className="small">{l.integrationKey}<div className="muted">{l.provider}</div></Td><Td className="small">{l.action}</Td><Td><Badge tone={l.status === 'OK' ? 'good' : l.status === 'FAILED' ? 'critical' : 'neutral'}>{l.status}</Badge></Td><Td className="r num">{l.attempt}</Td><Td className="r num">{l.durationMs ?? '—'}</Td><Td className="small muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify({ request: l.request, response: l.response })}>{l.error ?? JSON.stringify(l.response ?? l.request ?? '').slice(0, 140)}</Td></tr>)}</tbody></Table></div>
        )}</CardContent>
      </Card>
      {toast}
    </div>
  );
}

function IntegrationDialog({ i, onClose, onSaved }: { i: Integration; onClose: () => void; onSaved: () => void }) {
  const [provider, setProvider] = useState(i.provider);
  const [enabled, setEnabled] = useState(i.isEnabled);
  const [config, setConfig] = useState<Record<string, string>>({ ...i.config });
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const prov = i.providers.find((p) => p.key === provider) ?? i.providers[0]!;
  const m = useMutation({ mutationFn: () => api(`/integracoes/${i.key}`, { method: 'PUT', body: { provider, isEnabled: enabled, config, secrets } }), onSuccess: onSaved, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={`Integração: ${i.label}`} wide>
      <div className="grid gap-3 md:grid-cols-2">
        {i.providers.length > 1 && <Field label="Provedor"><Select value={provider} onChange={(e) => setProvider(e.target.value)}>{i.providers.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</Select></Field>}
        <Field label="Situação"><Select value={enabled ? 'on' : 'off'} onChange={(e) => setEnabled(e.target.value === 'on')}><option value="on">Ativa</option><option value="off">Desativada (fluxo manual)</option></Select></Field>
        {prov.fields.map((f) => f.secret ? (
          <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}><Input type="password" autoComplete="new-password" placeholder={i.secrets[f.key] ? `${i.secrets[f.key]} (deixe em branco para manter)` : f.placeholder ?? ''} value={secrets[f.key] ?? ''} onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })} />{f.help && <div className="small muted">{f.help}</div>}</Field>
        ) : (
          <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}><Input placeholder={f.placeholder ?? ''} value={config[f.key] ?? ''} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />{f.help && <div className="small muted">{f.help}</div>}</Field>
        ))}
        {prov.fields.length === 0 && <p className="small muted md:col-span-2">Esta integração é pública e não exige credenciais.</p>}
      </div>
      {i.key === 'WHATSAPP' && <p className="small muted" style={{ marginTop: 8 }}>Webhook de recebimento: configure na Meta a URL <code>{typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/whatsapp</code> com o verify token acima. Mensagens recebidas viram chamados no Atendimento e status de entrega atualizam as mensagens enviadas.</p>}
      {i.key === 'SIGNATURE' && <p className="small muted" style={{ marginTop: 8 }}>Webhook do provedor: <code>{typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/signature/clicksign</code>. O documento assinado é baixado e anexado à OS automaticamente; o cron também consulta os pedidos em aberto.</p>}
      <p className="small muted" style={{ marginTop: 8 }}>Segredos são cifrados no banco e nunca exibidos. Para apagar um segredo, informe um espaço e salve.</p>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending}>Salvar</Button></div>
    </Dialog>
  );
}

function WebhooksSection({ onToast }: { onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['webhooks'], queryFn: () => api<{ items: Webhook[]; events: string[] }>('/integracoes/webhooks') });
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const refresh = (): void => { void qc.invalidateQueries({ queryKey: ['webhooks'] }); void qc.invalidateQueries({ queryKey: ['webhook-deliveries'] }); void qc.invalidateQueries({ queryKey: ['integration-logs'] }); };
  const ping = useMutation({ mutationFn: (id: string) => api(`/integracoes/webhooks/${id}/ping`, { method: 'POST' }), onSuccess: () => { refresh(); onToast('Evento de teste enviado — veja o resultado nas entregas'); }, onError: (e) => onToast(errMsg(e)) });
  const del = useMutation({ mutationFn: (id: string) => api(`/integracoes/webhooks/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: (e) => onToast(errMsg(e)) });
  const reveal = useMutation({ mutationFn: (id: string) => api<{ secret: string | null }>(`/integracoes/webhooks/${id}/secret`, { method: 'POST' }), onSuccess: (r) => { if (r.secret) { void navigator.clipboard?.writeText(r.secret); onToast(`Segredo copiado: ${r.secret}`); } }, onError: (e) => onToast(errMsg(e)) });
  return (
    <Card>
      <CardHeader><CardTitle>Webhooks de saída</CardTitle><Button size="sm" onClick={() => setEditing('new')}>+ Webhook</Button></CardHeader>
      <CardContent>
        <p className="small muted" style={{ margin: '0 0 8px' }}>Eventos da plataforma enviados por POST com assinatura HMAC-SHA256 (<code>X-Siow-Signature: sha256=…</code> sobre <code>timestamp.body</code>). Reentrega automática em 1, 5, 15, 60 e 180 min.</p>
        {!data ? <p className="small muted">Carregando…</p> : data.items.length === 0 ? <Empty>Nenhum webhook</Empty> : (
          <div className="tbl"><Table><thead><tr><Th>Nome</Th><Th>URL</Th><Th>Eventos</Th><Th>Último envio</Th><Th className="r">Enviadas</Th><Th className="r">Pendentes</Th><Th className="r">Falhas</Th><Th /></tr></thead>
            <tbody>{data.items.map((w) => <tr key={w.id}><Td><b>{w.name}</b>{!w.isActive && <Badge tone="neutral" className="ml-1">inativo</Badge>}</Td><Td className="small num" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.url}</Td><Td className="small">{w.events.map((e) => EVENT_LABEL[e] ?? e).join(', ')}</Td><Td className="small">{w.lastDeliveryAt ? `${formatBrDateTime(w.lastDeliveryAt)} · ${w.lastStatus}` : '—'}</Td><Td className="r num">{w.sent}</Td><Td className="r num">{w.pending}</Td><Td className="r num">{w.failed}</Td><Td className="r whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => setOpenId(w.id)}>Entregas</Button><Button size="sm" variant="ghost" onClick={() => ping.mutate(w.id)}>Testar</Button><Button size="sm" variant="ghost" onClick={() => reveal.mutate(w.id)}>Segredo</Button><Button size="sm" variant="ghost" onClick={() => setEditing(w)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => { if (confirm('Excluir webhook?')) del.mutate(w.id); }}>Excluir</Button></Td></tr>)}</tbody></Table></div>
        )}
        {editing && data && <WebhookDialog w={editing === 'new' ? null : editing} events={data.events} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
        {openId && <DeliveriesDialog id={openId} onClose={() => setOpenId(null)} onToast={onToast} />}
      </CardContent>
    </Card>
  );
}

function WebhookDialog({ w, events, onClose, onSaved }: { w: Webhook | null; events: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: w?.name ?? '', url: w?.url ?? '', events: w?.events ?? ['ticket.created', 'invoice.paid'], isActive: w?.isActive ?? true, secret: '' });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api(w ? `/integracoes/webhooks/${w.id}` : '/integracoes/webhooks', { method: w ? 'PUT' : 'POST', body: { name: f.name, url: f.url, events: f.events, isActive: f.isActive, ...(f.secret ? { secret: f.secret } : {}) } }), onSuccess: onSaved, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={w ? 'Editar webhook' : 'Novo webhook'}>
      <div className="grid gap-3">
        <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="URL (HTTPS)"><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://exemplo.com/siow" /></Field>
        <div><div className="small muted">Eventos</div><div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>{events.filter((e) => e !== 'test.ping').map((e) => <label key={e} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={f.events.includes(e)} onChange={() => setF({ ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e] })} /> {EVENT_LABEL[e] ?? e}</label>)}</div></div>
        <Field label={w ? 'Novo segredo (em branco mantém o atual)' : 'Segredo (em branco: gerado automaticamente)'}><Input value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} /></Field>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Ativo</label>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.name || !f.url || !f.events.length}>Salvar</Button></div>
    </Dialog>
  );
}

function DeliveriesDialog({ id, onClose, onToast }: { id: string; onClose: () => void; onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['webhook-deliveries', id], queryFn: () => api<{ items: Delivery[]; total: number }>(`/integracoes/webhooks/${id}/deliveries`) });
  const retry = useMutation({ mutationFn: (d: string) => api(`/integracoes/webhooks/deliveries/${d}/retry`, { method: 'POST' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['webhook-deliveries', id] }); void qc.invalidateQueries({ queryKey: ['webhooks'] }); onToast('Reenviado'); }, onError: (e) => onToast(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title="Entregas do webhook" wide>
      {!data ? <p className="small muted">Carregando…</p> : data.items.length === 0 ? <Empty>Nenhuma entrega</Empty> : (
        <div className="tbl" style={{ maxHeight: 380, overflow: 'auto' }}><Table><thead><tr><Th>Quando</Th><Th>Evento</Th><Th>Situação</Th><Th className="r">Tentativas</Th><Th>Resposta</Th><Th /></tr></thead>
          <tbody>{data.items.map((d) => <tr key={d.id}><Td className="small num">{formatBrDateTime(d.createdAt)}</Td><Td className="small">{EVENT_LABEL[d.event] ?? d.event}</Td><Td><Badge tone={d.status === 'SENT' ? 'good' : d.status === 'FAILED' ? 'critical' : d.status === 'PENDING' ? 'warn' : 'neutral'}>{({ SENT: 'entregue', FAILED: 'falhou', PENDING: 'pendente', CANCELLED: 'cancelada' } as Record<string, string>)[d.status] ?? d.status}</Badge>{d.status === 'PENDING' && d.attempts > 0 && <div className="small muted">próxima {formatBrDateTime(d.nextAttemptAt)}</div>}</Td><Td className="r num">{d.attempts}</Td><Td className="small muted">{d.responseStatus ?? ''} {d.error ?? ''}</Td><Td className="r">{d.status !== 'SENT' && <Button size="sm" variant="ghost" onClick={() => retry.mutate(d.id)}>Reenviar</Button>}</Td></tr>)}</tbody></Table></div>
      )}
      <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
    </Dialog>
  );
}
