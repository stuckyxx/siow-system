'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { COMMISSION_BASES, COMMISSION_BASIS_LABELS, OPPORTUNITY_STATUS_LABELS, PARTNER_KIND_LABELS, formatBRL, formatBrDate, type CommissionBasis, type CommissionRuleRow, type OpportunityStatus, type PartnerKind, type PartnerPaymentsSummary, type PartnerStatement } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CommissionsTable } from '@/components/crm/commissions-table';
import { Badge, Button, Dialog, Empty, Field, Input, Select, Stat, Table, Tabs, Td, Textarea, Th, useToast } from '@/components/ui';
import { PartnerForm, errMsg } from '@/components/crm/partner-form';
import { PaymentForm, paymentToast } from '@/components/crm/partner-payment-form';

const TABS = [{ key: 'extrato', label: 'Extrato' }, { key: 'regras', label: 'Regras de comissão' }, { key: 'entidades', label: 'Entidades' }, { key: 'oportunidades', label: 'Oportunidades' }, { key: 'pagamentos', label: 'Pagamentos' }];

export default function PartnerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [tab, setTab] = useState('extrato');
  const [editing, setEditing] = useState(false);
  const { data: st } = useQuery({ queryKey: ['partner-statement', id], queryFn: () => api<PartnerStatement>(`/parceiros/${id}/statement`) });
  const refresh = (): void => { for (const k of ['partner-statement', 'partners', 'commissions', 'rules', 'partner-payments']) void qc.invalidateQueries({ queryKey: [k] }); };
  const remove = useMutation({ mutationFn: () => api(`/parceiros/${id}`, { method: 'DELETE' }), onSuccess: () => router.push('/parceiros'), onError: (e) => showToast(errMsg(e)) });
  if (!st) return <div className="muted">Carregando…</div>;
  const p = st.partner;
  return (
    <div>
      <Link href="/parceiros" className="btn sm" style={{ marginBottom: 10 }}>← Parceiros</Link>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div><div className="small muted">{PARTNER_KIND_LABELS[p.kind as PartnerKind] ?? p.kind}{p.document ? ` · ${p.document}` : ''}{p.userName ? ` · portal: ${p.userName}` : ''}</div><h1>{p.name}</h1><div className="small muted">{[p.contactName, p.email, p.phone, p.whatsapp].filter(Boolean).join(' · ')}{p.bankInfo ? ` · ${p.bankInfo}` : ''} <Badge tone={p.isActive ? 'good' : 'neutral'}>{p.isActive ? 'Ativo' : 'Inativo'}</Badge></div></div>
        <div className="row">{can('partners.manage') && <Button variant="secondary" onClick={() => setEditing(true)}>Editar</Button>}{can('partners.manage') && <Button variant="ghost" onClick={() => { if (confirm('Excluir este parceiro? As comissões registradas são mantidas.')) remove.mutate(); }}>Excluir</Button>}</div>
      </div>
      <div className="g5" style={{ marginTop: 12 }}>
        <Stat small label="Previstas" value={formatBRL(st.totals.forecast)} tone="info" hint="notas emitidas não pagas" />
        <Stat small label="A pagar" value={formatBRL(st.totals.due)} tone={st.totals.dueCount ? 'warn' : 'good'} hint={`${st.totals.dueCount} comissão(ões)`} />
        <Stat small label="Pagas" value={formatBRL(st.totals.paid)} tone="good" />
        <Stat small label="Estornadas" value={formatBRL(st.totals.reversed)} />
        <Stat small label="Valor mensal" value={formatBRL(p.monthlyTotal)} hint={`${p.entityCount} entidade(s) · pago em ${new Date().getFullYear()}: ${formatBRL(p.paidThisYear)}${p.paidThroughThisYear ? ` (até ${p.paidThroughThisYear.slice(5)}/${p.paidThroughThisYear.slice(0, 4)})` : ''}`} />
      </div>
      <Tabs tabs={[TABS[0]!, { ...TABS[1]!, count: p.ruleCount }, { ...TABS[2]!, count: p.entityCount }, { ...TABS[3]!, count: st.opportunities.length }, TABS[4]!]} value={tab} onChange={setTab} />
      {tab === 'extrato' && (
        <div>
          {st.byMonth.length > 0 && <div className="card" style={{ marginBottom: 12 }}><div className="hd"><h2>Por competência</h2></div><div className="bd"><table style={{ width: '100%' }}><thead><tr><th className="l">Competência</th><th className="r">Previstas</th><th className="r">A pagar</th><th className="r">Pagas</th></tr></thead><tbody>{st.byMonth.map((m) => <tr key={m.competence}><td>{m.competence.slice(5)}/{m.competence.slice(0, 4)}</td><td className="r num">{formatBRL(m.forecast)}</td><td className="r num">{formatBRL(m.due)}</td><td className="r num">{formatBRL(m.paid)}</td></tr>)}</tbody></table></div></div>}
          <CommissionsTable partnerId={id} readOnly={!can('partners.manage')} />
        </div>
      )}
      {tab === 'regras' && <RulesPanel partnerId={id} onChanged={refresh} />}
      {tab === 'entidades' && <EntitiesPanel partnerId={id} entities={st.entities} onChanged={refresh} />}
      {tab === 'oportunidades' && <div className="card">{st.opportunities.length === 0 ? <div className="bd"><Empty>Nenhuma oportunidade originada por este parceiro</Empty></div> : <div className="tbl"><Table><thead><tr><Th>Oportunidade</Th><Th>Entidade</Th><Th>Situação</Th><Th className="r">Valor</Th></tr></thead><tbody>{st.opportunities.map((o) => <tr key={o.id} className="click" onClick={() => router.push(`/comercial/oportunidades/${o.id}`)}><Td><span className="link">{o.title}</span></Td><Td>{o.entityName}</Td><Td><Badge tone={o.status === 'WON' ? 'good' : o.status === 'LOST' ? 'critical' : 'info'}>{o.status === 'OPEN' ? o.stageName : OPPORTUNITY_STATUS_LABELS[o.status as OpportunityStatus]}</Badge></Td><Td className="r num">{o.totalAmount ? formatBRL(o.totalAmount) : '—'}</Td></tr>)}</tbody></Table></div>}</div>}
      {tab === 'pagamentos' && <PaymentsPanel partnerId={id} entities={st.entities} onChanged={refresh} />}
      {editing && <PartnerForm partner={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />}
      {toast}
    </div>
  );
}

function RulesPanel({ partnerId, onChanged }: { partnerId: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [editing, setEditing] = useState<CommissionRuleRow | 'new' | null>(null);
  const { data } = useQuery({ queryKey: ['rules', partnerId], queryFn: () => api<CommissionRuleRow[]>(`/parceiros/${partnerId}/rules`) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/parceiros/rules/${id}`, { method: 'DELETE' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['rules', partnerId] }); onChanged(); }, onError: (e) => showToast(errMsg(e)) });
  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}><span className="small muted">Percentual sobre o recebimento confirmado (ou sobre o faturamento). Sem entidade/contrato, a regra vale para todas as entidades vinculadas ao parceiro. Alterar uma regra recalcula as comissões não pagas.</span>{can('partners.manage') && <Button size="sm" onClick={() => setEditing('new')}>+ Nova regra</Button>}</div>
      <div className="card">{!data ? <div className="bd small muted">Carregando…</div> : data.length === 0 ? <div className="bd"><Empty>Nenhuma regra — sem regra não há comissão</Empty></div> : (
        <div className="tbl"><Table><thead><tr><Th>Regra</Th><Th>Base</Th><Th className="r">%</Th><Th>Escopo</Th><Th>Vigência</Th><Th>Situação</Th><Th /></tr></thead><tbody>{data.map((r) => (
          <tr key={r.id}><Td><b>{r.name}</b>{r.notes && <div className="small muted">{r.notes}</div>}</Td><Td className="small">{COMMISSION_BASIS_LABELS[r.basis as CommissionBasis]}</Td><Td className="r num">{Number(r.percent).toLocaleString('pt-BR')}%</Td><Td className="small">{r.contractNumber ? `contrato ${r.contractNumber}` : r.entityName ? r.entityName : 'todas as entidades do parceiro'}{r.maxMonths ? ` · ${r.maxMonths} primeiras competências` : ''}</Td><Td className="small num">{r.startDate || r.endDate ? `${r.startDate ? formatBrDate(r.startDate) : '…'} a ${r.endDate ? formatBrDate(r.endDate) : '…'}` : 'sem limite'}</Td><Td><Badge tone={r.isActive ? 'good' : 'neutral'}>{r.isActive ? 'Ativa' : 'Inativa'}</Badge></Td><Td className="r">{can('partners.manage') && <><Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => { if (confirm('Remover a regra? Se houver comissões a pagar/pagas ela é apenas desativada.')) remove.mutate(r.id); }}>Remover</Button></>}</Td></tr>))}</tbody></Table></div>)}</div>
      {editing && <RuleForm partnerId={partnerId} rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['rules', partnerId] }); onChanged(); showToast('Regra salva e comissões recalculadas'); }} />}
      {toast}
    </div>
  );
}

function RuleForm({ partnerId, rule, onClose, onSaved }: { partnerId: string; rule: CommissionRuleRow | null; onClose: () => void; onSaved: () => void }) {
  const { data: entities } = useQuery({ queryKey: ['entities-lite'], queryFn: () => api<{ entities: Array<{ id: string; name: string; shortName: string | null }> }>('/financeiro/dashboard/filter-options') });
  const [f, setF] = useState({ name: rule?.name ?? 'Comissão padrão', basis: rule?.basis ?? 'RECEIVED', percent: rule ? rule.percent.replace('.', ',') : '10', entityId: rule?.entityId ?? '', contractId: rule?.contractId ?? '', startDate: rule?.startDate ?? '', endDate: rule?.endDate ?? '', maxMonths: rule?.maxMonths ? String(rule.maxMonths) : '', notes: rule?.notes ?? '', isActive: rule?.isActive ?? true });
  const { data: contracts } = useQuery({ queryKey: ['contracts', f.entityId], queryFn: () => api<Array<{ id: string; number: string }>>('/financeiro/contracts', { query: { entityId: f.entityId } }), enabled: Boolean(f.entityId) });
  const [error, setError] = useState<string | null>(null);
  const b = (k: keyof typeof f) => ({ value: String(f[k]), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const m = useMutation({ mutationFn: () => { const body = { name: f.name, basis: f.basis, percent: Number(f.percent.replace(',', '.')), entityId: f.entityId || null, contractId: f.contractId || null, startDate: f.startDate || null, endDate: f.endDate || null, maxMonths: f.maxMonths ? Number(f.maxMonths) : null, notes: f.notes || null, isActive: f.isActive }; return rule ? api(`/parceiros/rules/${rule.id}`, { method: 'PATCH', body }) : api(`/parceiros/${partnerId}/rules`, { method: 'POST', body }); }, onSuccess: onSaved, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={rule ? 'Editar regra' : 'Nova regra de comissão'} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nome"><Input {...b('name')} /></Field>
        <Field label="Percentual (%)"><Input {...b('percent')} inputMode="decimal" /></Field>
        <Field label="Base de cálculo" className="md:col-span-2"><Select {...b('basis')}>{COMMISSION_BASES.map((x) => <option key={x} value={x}>{COMMISSION_BASIS_LABELS[x]}</option>)}</Select></Field>
        <Field label="Entidade (vazio = todas vinculadas ao parceiro)"><Select value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value, contractId: '' })}><option value="">Todas as entidades do parceiro</option>{entities?.entities.map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}</option>)}</Select></Field>
        <Field label="Contrato (opcional)"><Select {...b('contractId')} disabled={!f.entityId}><option value="">Todos os contratos</option>{contracts?.map((c) => <option key={c.id} value={c.id}>{c.number}</option>)}</Select></Field>
        <Field label="Competência inicial"><Input type="date" {...b('startDate')} /></Field>
        <Field label="Competência final"><Input type="date" {...b('endDate')} /></Field>
        <Field label="Limitar às N primeiras competências do contrato"><Input type="number" min={1} {...b('maxMonths')} placeholder="ex.: 12" /></Field>
        <label className="row small" style={{ gap: 6, alignSelf: 'end' }}><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Regra ativa</label>
        <Field label="Observações / condição contratual" className="md:col-span-2"><Textarea rows={2} {...b('notes')} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.name || !f.percent}>Salvar</Button></div>
    </Dialog>
  );
}

function EntitiesPanel({ partnerId, entities, onChanged }: { partnerId: string; entities: PartnerStatement['entities']; onChanged: () => void }) {
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState<PartnerStatement['entities'][number] | null>(null);
  const { data: all } = useQuery({ queryKey: ['entities-lite'], queryFn: () => api<{ entities: Array<{ id: string; name: string; shortName: string | null }> }>('/financeiro/dashboard/filter-options') });
  const link = useMutation({ mutationFn: (v: { entityIds: string[]; unlink: boolean }) => api(`/parceiros/${partnerId}/link`, { method: 'POST', body: v }), onSuccess: () => { setAdding(''); onChanged(); }, onError: (e) => showToast(errMsg(e)) });
  const linked = new Set(entities.map((e) => e.id));
  const total = entities.reduce((a, e) => a + Number(e.monthlyValue ?? 0), 0).toFixed(2);
  return (
    <div>
      {can('partners.manage') && <div className="row" style={{ marginBottom: 8 }}><Select value={adding} onChange={(e) => setAdding(e.target.value)} style={{ minWidth: 320 }}><option value="">Vincular entidade…</option>{all?.entities.filter((e) => !linked.has(e.id)).map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}</option>)}</Select><Button size="sm" onClick={() => link.mutate({ entityIds: [adding], unlink: false })} disabled={!adding || link.isPending}>Vincular</Button><span className="small muted">Uma entidade tem no máximo um parceiro. O vínculo também pode ser feito no cadastro da entidade.</span></div>}
      <div className="card">{entities.length === 0 ? <div className="bd"><Empty>Nenhuma entidade vinculada</Empty></div> : <div className="tbl"><Table><thead><tr><Th>Entidade</Th><Th>Município/UF</Th><Th>Contrato ativo</Th><Th className="r">Valor mensal</Th><Th>Observação</Th><Th /></tr></thead><tbody>{entities.map((e) => <tr key={e.id}><Td><Link href={`/financeiro/entidades/${e.id}`} className="link">{e.shortName ?? e.name}</Link></Td><Td>{e.municipality}/{e.uf}</Td><Td className="num">{e.activeContract ?? '—'}</Td><Td className="r num">{e.monthlyValue ? formatBRL(e.monthlyValue) : '—'}</Td><Td className="small">{e.partnerNotes ?? ''}</Td><Td className="r">{can('partners.manage') && <><Button size="sm" variant="ghost" onClick={() => setEditing(e)}>Valor</Button><Button size="sm" variant="ghost" onClick={() => link.mutate({ entityIds: [e.id], unlink: true })}>Desvincular</Button></>}</Td></tr>)}<tr><Td><b>Total mensal</b></Td><Td /><Td /><Td className="r num"><b>{formatBRL(total)}</b></Td><Td /><Td /></tr></tbody></Table></div>}</div>
      {editing && <EntityValueForm partnerId={partnerId} entity={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); showToast('Valor mensal salvo'); }} />}
      {toast}
    </div>
  );
}

function EntityValueForm({ partnerId, entity, onClose, onSaved }: { partnerId: string; entity: PartnerStatement['entities'][number]; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(entity.monthlyValue ? entity.monthlyValue.replace('.', ',') : '');
  const [notes, setNotes] = useState(entity.partnerNotes ?? '');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api(`/parceiros/${partnerId}/entities/${entity.id}`, { method: 'PATCH', body: { monthlyValue: value.trim() ? value.trim().replace(/\./g, '').replace(',', '.') : null, notes: notes.trim() || null } }), onSuccess: onSaved, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={`Valor mensal — ${entity.shortName ?? entity.name}`}>
      <div className="grid gap-3">
        <Field label="Valor mensal (R$)"><Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="ex.: 1.500,00" /></Field>
        <Field label="Observação"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending}>Salvar</Button></div>
    </Dialog>
  );
}

const competenceLabel = (c: string): string => `${c.slice(5)}/${c.slice(0, 4)}`;

function PaymentsPanel({ partnerId, entities, onChanged }: { partnerId: string; entities: PartnerStatement['entities']; onChanged: () => void }) {
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [adding, setAdding] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PartnerPaymentsSummary['payments'][number] | null>(null);
  const { data } = useQuery({ queryKey: ['partner-payments', partnerId], queryFn: () => api<PartnerPaymentsSummary>(`/parceiros/${partnerId}/payments`) });
  const remove = useMutation({ mutationFn: (paymentId: string) => api(`/parceiros/${partnerId}/payments/${paymentId}`, { method: 'DELETE' }), onSuccess: () => { onChanged(); showToast('Pagamento removido'); }, onError: (e) => showToast(errMsg(e)) });
  if (!data) return <div className="small muted">Carregando…</div>;
  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}><span className="small muted">Valores pagos pelo parceiro (valem para todas as entidades vinculadas). Ao registrar, as notas pendentes da competência recebem baixa no Financeiro. O esperado é a soma atual das mensalidades. Remover um pagamento não reabre as notas.</span>{can('partners.manage') && <Button size="sm" onClick={() => setAdding(true)}>+ Registrar pagamento</Button>}</div>
      <div className="card" style={{ marginBottom: 12 }}><div className="hd"><h2>Por exercício</h2></div><div className="bd"><table style={{ width: '100%' }}><thead><tr><th className="l">Exercício</th><th className="l">Pago até</th><th className="r">Total pago</th><th className="r">Esperado</th><th className="r">Saldo</th></tr></thead><tbody>{data.byYear.map((y) => <tr key={y.year}><td><b>{y.year}</b></td><td>{y.paidThrough ? competenceLabel(y.paidThrough) : '—'}</td><td className="r num"><b>{formatBRL(y.paid)}</b></td><td className="r num">{formatBRL(y.expected)}<div className="small muted">{y.months} {y.months === 1 ? 'mês' : 'meses'}</div></td><td className="r num" style={{ color: Number(y.balance) > 0 ? 'var(--warn)' : 'var(--good)' }}>{Number(y.balance) > 0 ? formatBRL(y.balance) : Number(y.balance) < 0 ? `+${formatBRL(y.balance.replace('-', ''))}` : 'quitado'}</td></tr>)}</tbody></table><div className="small muted" style={{ marginTop: 6 }}>Esperado = mensalidade total atual × meses do exercício (até o mês atual no ano corrente).</div></div></div>
      <div className="card" style={{ marginBottom: 12 }}><div className="hd"><h2>Por competência</h2></div><div className="bd"><table style={{ width: '100%' }}><thead><tr><th className="l">Competência</th><th className="r">Esperado</th><th className="r">Pago</th><th className="r">Saldo</th></tr></thead><tbody>{data.byMonth.map((m) => <tr key={m.competence}><td>{competenceLabel(m.competence)}</td><td className="r num">{formatBRL(m.expected)}</td><td className="r num">{formatBRL(m.paid)}</td><td className="r num" style={{ color: Number(m.balance) > 0 ? 'var(--warn)' : 'var(--good)' }}>{Number(m.balance) > 0 ? formatBRL(m.balance) : Number(m.balance) < 0 ? `+${formatBRL(m.balance.replace('-', ''))}` : 'quitado'}</td></tr>)}</tbody></table></div></div>
      <div className="card">{data.payments.length === 0 ? <div className="bd"><Empty>Nenhum pagamento registrado</Empty></div> : <div className="tbl"><Table><thead><tr><Th>Competência</Th><Th>Entidade</Th><Th className="r">Valor</Th><Th>Pago em</Th><Th>Observação</Th><Th /></tr></thead><tbody>{data.payments.map((r) => <tr key={r.id}><Td className="num">{competenceLabel(r.competence)}</Td><Td>{r.entityName ?? <span className="muted">Geral</span>}</Td><Td className="r num">{formatBRL(r.amount)}</Td><Td className="num">{formatBrDate(r.paidAt)}</Td><Td className="small">{r.notes ?? ''}</Td><Td className="r">{can('partners.manage') && <><Button size="sm" variant="ghost" onClick={() => setEditingPayment(r)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => { if (confirm('Remover este pagamento?')) remove.mutate(r.id); }}>Remover</Button></>}</Td></tr>)}</tbody></Table></div>}</div>
      {editingPayment && <PaymentForm partnerId={partnerId} entities={entities} payment={editingPayment} onClose={() => setEditingPayment(null)} onSaved={(r) => { setEditingPayment(null); onChanged(); showToast(paymentToast(r)); }} />}
      {adding && <PaymentForm partnerId={partnerId} entities={entities} onClose={() => setAdding(false)} onSaved={(r) => { setAdding(false); onChanged(); showToast(paymentToast(r)); }} />}
      {toast}
    </div>
  );
}
