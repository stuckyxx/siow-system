'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { MODULE_LABELS, MODULES, CORE_MODULES, SUBSCRIPTION_STATUSES, type ModuleKey } from '@siow/shared';
import { api, apiUrl } from '@/lib/api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Field, Input, Select, Table, Td, Textarea, Th } from '@/components/ui';
import { InvoiceActions } from './invoices';
import { brl, errMsg, INV_LABEL, INV_TONE, ORG_LABEL, SUB_LABEL, SUB_TONE, type OrgDetail, type OrgRow, type Plan } from './shared';

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

export function OrganizationsPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['platform-orgs'], queryFn: () => api<OrgRow[]>('/platform/organizations') });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['platform-orgs'] }); qc.invalidateQueries({ queryKey: ['platform-overview'] }); qc.invalidateQueries({ queryKey: ['platform-invoices'] }); };
  return (
    <Card>
      <CardHeader><CardTitle>Organizações</CardTitle><Button size="sm" onClick={() => setCreating(true)}>Nova organização</Button></CardHeader>
      <CardContent className="px-0">
        <Table>
          <thead><tr><Th>Organização</Th><Th>Plano</Th><Th>Assinatura</Th><Th>Situação</Th><Th>Usuários</Th><Th>Entidades</Th><Th>Em aberto</Th><Th>Domínio</Th><Th></Th></tr></thead>
          <tbody>{data?.map((o) => {
            const open = o.openInvoices.reduce((a, x) => a + Number(x.amount), 0);
            const overdue = o.openInvoices.some((x) => x.status === 'OVERDUE');
            return <tr key={o.id}><Td><b>{o.name}</b><div className="text-xs text-ink-3">{o.slug}{o.document ? ` · ${o.document}` : ''}</div></Td><Td>{o.subscription?.planKey ?? o.plan}</Td><Td>{o.subscription ? <Badge tone={SUB_TONE[o.subscription.status]}>{SUB_LABEL[o.subscription.status]}</Badge> : <Badge tone="neutral">sem assinatura</Badge>}{o.subscription?.status === 'TRIAL' && o.subscription.trialEndsAt && <div className="text-xs text-ink-3">até {new Date(o.subscription.trialEndsAt).toLocaleDateString('pt-BR')}</div>}</Td><Td><Badge tone={o.status === 'ACTIVE' ? 'good' : o.status === 'READONLY' ? 'warn' : 'critical'}>{ORG_LABEL[o.status] ?? o.status}</Badge></Td><Td className="num">{o._count.users}{o.limits?.maxUsers ? `/${o.limits.maxUsers}` : ''}</Td><Td className="num">{o._count.entities}{o.limits?.maxEntities ? `/${o.limits.maxEntities}` : ''}</Td><Td className="num" style={{ color: overdue ? 'var(--crit)' : undefined }}>{open ? brl(open) : '—'}</Td><Td className="text-ink-2 small">{o.domain ?? '—'}</Td><Td><Button size="sm" variant="secondary" onClick={() => setOpenId(o.id)}>Gerenciar</Button></Td></tr>;
          })}</tbody>
        </Table>
      </CardContent>
      <CreateOrgDialog open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); }} />
      {openId && <OrgDialog id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </Card>
  );
}

function usePlans() { return useQuery({ queryKey: ['platform-plans'], queryFn: () => api<Plan[]>('/platform/plans') }).data ?? []; }

/** Onboarding: dados da empresa → plano → administrador. */
function CreateOrgDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const plans = usePlans();
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ name: '', slug: '', document: '', domain: '', planKey: 'SAAS_BASICO', trial: true, adminName: '', adminEmail: '', adminPassword: '', productName: '', accent: '' });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ organization: { slug: string; trialEndsAt: string | null }; admin: { email: string } } | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ organization: { slug: string; trialEndsAt: string | null }; admin: { email: string } }>('/platform/organizations', { method: 'POST', body: { name: f.name, slug: f.slug, document: f.document || null, domain: f.domain || null, planKey: f.planKey, trial: f.trial, adminName: f.adminName, adminEmail: f.adminEmail, adminPassword: f.adminPassword, branding: { productName: f.productName || null, accent: f.accent || null } } }),
    onSuccess: (r) => { setResult(r); }, onError: (e) => setError(errMsg(e)),
  });
  useEffect(() => { if (open) { setStep(1); setResult(null); setError(null); } }, [open]);
  const plan = plans.find((p) => p.key === f.planKey);
  return (
    <Dialog open={open} onClose={() => { onClose(); if (result) onDone(); }} title="Nova organização" wide>
      {result ? (
        <div className="space-y-3">
          <div className="p-3 rounded border border-line" style={{ background: 'var(--good-soft)' }}><b>Organização criada.</b> Identificador <code>{result.organization.slug}</code>. Administrador: <b>{result.admin.email}</b> (troca de senha obrigatória no primeiro acesso).{result.organization.trialEndsAt && <> Teste até {new Date(result.organization.trialEndsAt).toLocaleDateString('pt-BR')}.</>}</div>
          <p className="text-xs text-ink-3">Envie ao cliente: endereço do sistema, e-mail e a senha provisória definida. Papéis padrão, configurações e modelos de mensagem já foram criados.</p>
          <div className="flex justify-end"><Button onClick={() => { onDone(); }}>Concluir</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2 text-xs text-ink-3">{['Empresa', 'Plano', 'Administrador'].map((l, i) => <span key={l} style={{ color: step === i + 1 ? 'var(--accent)' : undefined, fontWeight: step === i + 1 ? 600 : 400 }}>{i + 1}. {l}</span>)}</div>
          {step === 1 && <div className="grid gap-3 md:grid-cols-2">
            <Field label="Razão social / nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slug && f.slug !== slugify(f.name) ? f.slug : slugify(e.target.value) })} /></Field>
            <Field label="Identificador (slug)"><Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
            <Field label="CNPJ (opcional)"><Input value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} /></Field>
            <Field label="Domínio próprio (opcional)"><Input value={f.domain} placeholder="crm.empresa.com.br" onChange={(e) => setF({ ...f, domain: e.target.value.toLowerCase() })} /></Field>
            <Field label="Nome do produto (marca, opcional)"><Input value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} /></Field>
            <Field label="Cor principal (opcional)"><Input value={f.accent} placeholder="#0891b2" onChange={(e) => setF({ ...f, accent: e.target.value })} /></Field>
          </div>}
          {step === 2 && <div className="space-y-3">
            <Field label="Plano"><Select value={f.planKey} onChange={(e) => setF({ ...f, planKey: e.target.value })}>{plans.filter((p) => p.isActive).map((p) => <option key={p.key} value={p.key}>{p.name} — {brl(p.priceMonthly)}/mês</option>)}</Select></Field>
            {plan && <div className="text-xs text-ink-2">{plan.description} · usuários: {plan.maxUsers ?? '∞'} · entidades: {plan.maxEntities ?? '∞'} · módulos: {plan.modules.length ? plan.modules.map((m) => MODULE_LABELS[m as ModuleKey] ?? m).join(', ') : 'todos'} · teste: {plan.trialDays} dias</div>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.trial} onChange={(e) => setF({ ...f, trial: e.target.checked })} /> Iniciar em período de teste ({plan?.trialDays ?? 0} dias, sem cobrança)</label>
          </div>}
          {step === 3 && <div className="grid gap-3 md:grid-cols-3">
            <Field label="Nome do administrador"><Input value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} /></Field>
            <Field label="E-mail"><Input type="email" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} /></Field>
            <Field label="Senha provisória (mín. 12)"><Input type="text" value={f.adminPassword} onChange={(e) => setF({ ...f, adminPassword: e.target.value })} /></Field>
          </div>}
          {error && <div className="err">{error}</div>}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}>Voltar</Button>
            {step < 3 ? <Button onClick={() => setStep(step + 1)} disabled={step === 1 && (!f.name || !f.slug)}>Avançar</Button> : <Button onClick={() => create.mutate()} disabled={create.isPending || !f.adminName || !f.adminEmail || f.adminPassword.length < 12}>Criar organização</Button>}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function OrgDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const plans = usePlans();
  const { data: o } = useQuery({ queryKey: ['platform-org', id], queryFn: () => api<OrgDetail>(`/platform/organizations/${id}`) });
  const [tab, setTab] = useState<'dados' | 'assinatura' | 'faturas' | 'uso'>('dados');
  const [f, setF] = useState({ name: '', document: '', domain: '', modules: [] as string[], maxUsers: '', maxEntities: '', status: 'ACTIVE', blockReason: '' });
  const [sub, setSub] = useState({ planKey: '', status: 'ACTIVE', amount: '', billingDay: '10', graceDays: '10', trialEndsAt: '', notes: '' });
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (o) { setF({ name: o.name, document: o.document ?? '', domain: o.domain ?? '', modules: o.modules ?? [], maxUsers: o.limits?.maxUsers?.toString() ?? '', maxEntities: o.limits?.maxEntities?.toString() ?? '', status: o.status, blockReason: o.blockReason ?? '' }); setSub({ planKey: o.subscription?.planKey ?? o.plan, status: o.subscription?.status ?? 'ACTIVE', amount: o.subscription?.amount ?? '', billingDay: String(o.subscription?.billingDay ?? 10), graceDays: String(o.subscription?.graceDays ?? 10), trialEndsAt: o.subscription?.trialEndsAt?.slice(0, 10) ?? '', notes: o.subscription?.notes ?? '' }); } }, [o]);
  const done = (m: string) => { setMsg(m); qc.invalidateQueries({ queryKey: ['platform-org', id] }); onChanged(); };
  const save = useMutation({ mutationFn: () => api(`/platform/organizations/${id}`, { method: 'PATCH', body: { name: f.name, document: f.document || null, domain: f.domain || null, modules: f.modules, limits: { maxUsers: f.maxUsers ? Number(f.maxUsers) : null, maxEntities: f.maxEntities ? Number(f.maxEntities) : null }, status: f.status, blockReason: f.blockReason || null } }), onSuccess: () => done('Dados salvos.'), onError: (e) => setMsg(errMsg(e)) });
  const saveSub = useMutation({ mutationFn: () => api(`/platform/organizations/${id}/subscription`, { method: 'PUT', body: { planKey: sub.planKey, status: sub.status, amount: sub.amount || undefined, billingDay: Number(sub.billingDay), graceDays: Number(sub.graceDays), trialEndsAt: sub.trialEndsAt || null, notes: sub.notes || null } }), onSuccess: () => done('Assinatura salva.'), onError: (e) => setMsg(errMsg(e)) });
  const gen = useMutation({ mutationFn: () => { const period = window.prompt('Período da fatura (AAAA-MM):', new Date().toISOString().slice(0, 7)); if (!period) return Promise.reject(new Error('cancelado')); return api(`/platform/organizations/${id}/invoices`, { method: 'POST', body: { period } }); }, onSuccess: () => done('Fatura gerada (ou já existia).'), onError: (e) => { if (!(e instanceof Error && e.message === 'cancelado')) setMsg(errMsg(e)); } });
  const remove = useMutation({ mutationFn: () => api(`/platform/organizations/${id}`, { method: 'DELETE' }), onSuccess: () => { onChanged(); onClose(); }, onError: (e) => setMsg(errMsg(e)) });
  if (!o) return <Dialog open onClose={onClose} title="Organização" wide><div className="text-sm text-ink-3">Carregando…</div></Dialog>;
  const isDefault = o.id === '7a1b5c3e-5e1f-4a4e-8c0d-000000000001';
  return (
    <Dialog open onClose={onClose} title={`${o.name} (${o.slug})`} wide>
      <div className="space-y-3">
        <div className="tabs" style={{ margin: '0 0 10px' }}>{(['dados', 'assinatura', 'faturas', 'uso'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ dados: 'Dados e licenciamento', assinatura: 'Assinatura', faturas: `Faturas (${o.invoices.length})`, uso: 'Uso e dados' }[t]}</button>)}</div>
        {tab === 'dados' && <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="CNPJ"><Input value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} /></Field>
            <Field label="Domínio próprio"><Input value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value.toLowerCase() })} /></Field>
            <Field label="Máx. usuários (sobrescreve o plano)"><Input type="number" value={f.maxUsers} onChange={(e) => setF({ ...f, maxUsers: e.target.value })} /></Field>
            <Field label="Máx. entidades"><Input type="number" value={f.maxEntities} onChange={(e) => setF({ ...f, maxEntities: e.target.value })} /></Field>
            <Field label="Situação"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} disabled={isDefault}><option value="ACTIVE">Ativa</option><option value="READONLY">Somente leitura (bloqueio suave)</option><option value="SUSPENDED">Suspensa (sem acesso)</option></Select></Field>
          </div>
          {f.status !== 'ACTIVE' && <Field label="Motivo exibido aos usuários"><Input value={f.blockReason} onChange={(e) => setF({ ...f, blockReason: e.target.value })} /></Field>}
          <div className="text-xs text-ink-3">Módulos habilitados na organização (nenhum = conforme o plano). Núcleo sempre: {CORE_MODULES.map((m) => MODULE_LABELS[m]).join(', ')}. Efetivo agora: <b>{o.access.modules.length ? o.access.modules.map((m) => MODULE_LABELS[m as ModuleKey] ?? m).join(', ') : 'todos'}</b>.</div>
          <div className="grid gap-1 md:grid-cols-3">{MODULES.filter((m) => !CORE_MODULES.includes(m)).map((m) => <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.modules.includes(m)} onChange={() => setF({ ...f, modules: f.modules.includes(m) ? f.modules.filter((x) => x !== m) : [...f.modules, m] })} />{MODULE_LABELS[m]}</label>)}</div>
          <div className="flex justify-between items-center"><div>{!isDefault && <Button variant="ghost" size="sm" onClick={() => { if (window.confirm('Remover (exclusão lógica) esta organização? Só é permitido sem dados de negócio; nada é apagado fisicamente.')) remove.mutate(); }}>Remover organização</Button>}</div><div className="flex items-center gap-3">{msg && <span className="text-xs text-ink-2">{msg}</span>}<Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button></div></div>
        </div>}
        {tab === 'assinatura' && <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Plano"><Select value={sub.planKey} onChange={(e) => { const p = plans.find((x) => x.key === e.target.value); setSub({ ...sub, planKey: e.target.value, amount: p ? p.priceMonthly : sub.amount }); }}>{plans.map((p) => <option key={p.key} value={p.key}>{p.name} — {brl(p.priceMonthly)}</option>)}</Select></Field>
            <Field label="Situação"><Select value={sub.status} onChange={(e) => setSub({ ...sub, status: e.target.value })}>{SUBSCRIPTION_STATUSES.map((s) => <option key={s} value={s}>{SUB_LABEL[s]}</option>)}</Select></Field>
            <Field label="Mensalidade (R$)"><Input value={sub.amount} onChange={(e) => setSub({ ...sub, amount: e.target.value })} /></Field>
            <Field label="Dia de vencimento (1–28)"><Input type="number" value={sub.billingDay} onChange={(e) => setSub({ ...sub, billingDay: e.target.value })} /></Field>
            <Field label="Carência (dias) antes do bloqueio"><Input type="number" value={sub.graceDays} onChange={(e) => setSub({ ...sub, graceDays: e.target.value })} /></Field>
            <Field label="Fim do teste"><Input type="date" value={sub.trialEndsAt} onChange={(e) => setSub({ ...sub, trialEndsAt: e.target.value })} /></Field>
          </div>
          <Field label="Observações"><Textarea value={sub.notes} onChange={(e) => setSub({ ...sub, notes: e.target.value })} /></Field>
          <p className="text-xs text-ink-3">Fluxo: teste → ativa → em atraso (fatura vencida) → bloqueada (após a carência; organização em somente leitura) → ativa (ao registrar o pagamento). "Isenta" não gera faturas.</p>
          <div className="flex justify-end items-center gap-3">{msg && <span className="text-xs text-ink-2">{msg}</span>}<Button onClick={() => saveSub.mutate()} disabled={saveSub.isPending || isDefault && sub.status === 'BLOCKED'}>Salvar assinatura</Button></div>
        </div>}
        {tab === 'faturas' && <div className="space-y-3">
          <div className="flex justify-between items-center"><span className="text-xs text-ink-3">Faturas da assinatura (geradas pelo cron diário ou manualmente).</span><Button size="sm" variant="secondary" onClick={() => gen.mutate()}>Gerar fatura do período</Button></div>
          <Table><thead><tr><Th>Período</Th><Th>Valor</Th><Th>Vencimento</Th><Th>Situação</Th><Th>Pagamento</Th><Th></Th></tr></thead>
            <tbody>{o.invoices.map((i) => <tr key={i.id}><Td style={{ fontFamily: 'var(--mono)' }}>{i.period}</Td><Td className="num">{brl(i.amount)}</Td><Td>{new Date(i.dueDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</Td><Td><Badge tone={INV_TONE[i.status]}>{INV_LABEL[i.status]}</Badge></Td><Td className="small text-ink-2">{i.paidAt ? `${new Date(i.paidAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}${i.paymentRef ? ` · ${i.paymentRef}` : ''}` : i.notes ?? '—'}</Td><Td><InvoiceActions inv={i} onDone={() => done('Fatura atualizada.')} /></Td></tr>)}{!o.invoices.length && <tr><Td colSpan={6} className="text-center text-ink-3">Nenhuma fatura</Td></tr>}</tbody></Table>
          {msg && <span className="text-xs text-ink-2">{msg}</span>}
        </div>}
        {tab === 'uso' && <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            {([['Usuários ativos', `${o.usage.users}${o.access.limits.maxUsers ? ` / ${o.access.limits.maxUsers}` : ''}`], ['Entidades', `${o.usage.entities}${o.access.limits.maxEntities ? ` / ${o.access.limits.maxEntities}` : ''}`], ['Contratos', o.usage.contracts], ['Notas fiscais', o.usage.invoices], ['Chamados', o.usage.tickets], ['Oportunidades', o.usage.opportunities], ['Licitações', o.usage.tenders], ['Documentos', `${o.usage.documents} · ${(o.usage.storageBytes / 1048576).toFixed(1)} MB`]] as Array<[string, React.ReactNode]>).map(([l, v]) => <div key={l} className="stat card"><div className="l">{l}</div><div className="v">{v}</div></div>)}
          </div>
          <div className="text-xs text-ink-3">Último acesso: {o.usage.lastLoginAt ? new Date(o.usage.lastLoginAt).toLocaleString('pt-BR') : 'nunca'} · criada em {new Date(o.createdAt).toLocaleDateString('pt-BR')}</div>
          <div className="pt-2 border-t border-line"><div className="text-sm font-medium">LGPD / portabilidade</div><p className="text-xs text-ink-3 mb-2">Exportação completa dos dados da organização em JSON.</p><a className="btn sm" href={apiUrl(`/platform/organizations/${id}/export`)}>Exportar dados</a></div>
        </div>}
      </div>
    </Dialog>
  );
}
