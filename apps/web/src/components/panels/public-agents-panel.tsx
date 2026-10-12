'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatBrDate, todayIso, type PublicAgent } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Dialog, Empty, Field, Input, Table, Td, Th, Textarea } from '../ui';

const POSITIONS = ['Prefeito(a)', 'Vice-prefeito(a)', 'Presidente da Câmara', 'Vereador(a)', 'Secretário(a) de Administração', 'Secretário(a) de Finanças', 'Controlador(a)', 'Contador(a)', 'Procurador(a)', 'Pregoeiro(a)', 'Tesoureiro(a)', 'Chefe de gabinete', 'Outro'];

/** Agentes públicos da entidade (Cadastro Público): cargo, mandato, decisor. Dados pessoais → permissões de contatos. */
export function PublicAgentsPanel({ entityId }: { entityId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PublicAgent | 'new' | null>(null);
  const { data } = useQuery({ queryKey: ['agents', entityId], queryFn: () => api<PublicAgent[]>(`/financeiro/entities/${entityId}/agents`), enabled: can('contacts.read') });
  const remove = useMutation({ mutationFn: (id: string) => api(`/financeiro/entities/${entityId}/agents/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', entityId] }) });
  if (!can('contacts.read')) return null;
  const today = todayIso();
  return (
    <div className="space-y-3" style={{ marginTop: 16 }}>
      <div className="flex items-center justify-between gap-2">
        <div><h2>Agentes públicos</h2><p className="small muted" style={{ margin: 0 }}>Prefeito, presidente da Câmara, secretários, controlador, contador, pregoeiro… com mandato e marcação de decisor.</p></div>
        {can('contacts.write') && <Button onClick={() => setEditing('new')}>Novo agente</Button>}
      </div>
      <Card>
        {!data ? <div className="p-4 text-sm text-ink-3">Carregando…</div> : data.length === 0 ? <div className="p-4"><Empty>Nenhum agente público cadastrado</Empty></div> : (
          <Table>
            <thead><tr><Th>Nome</Th><Th>Cargo</Th><Th className="hide-m">Partido</Th><Th>Mandato</Th><Th className="hide-m">Contato</Th><Th></Th></tr></thead>
            <tbody>
              {data.map((a) => {
                const ended = a.termEnd && a.termEnd < today;
                return (
                  <tr key={a.id} className="hover:bg-surface" style={{ opacity: a.isActive ? 1 : 0.6 }}>
                    <Td className="font-medium">{a.name} {a.isDecisionMaker && <Badge tone="info">decisor</Badge>} {!a.isActive && <Badge tone="neutral">inativo</Badge>}</Td>
                    <Td>{a.position}</Td>
                    <Td className="hide-m text-ink-2">{a.party ?? '—'}</Td>
                    <Td className="tabular-nums">{a.termStart || a.termEnd ? `${formatBrDate(a.termStart)} – ${formatBrDate(a.termEnd)}` : '—'} {ended && <Badge tone="warn">encerrado</Badge>}</Td>
                    <Td className="hide-m text-ink-2">{[a.whatsapp, a.phone, a.email].filter(Boolean).join(' · ') || '—'}</Td>
                    <Td className="whitespace-nowrap">{can('contacts.write') && <><Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => { if (confirm('Remover agente público?')) remove.mutate(a.id); }}>Remover</Button></>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <AgentForm entityId={entityId} agent={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['agents', entityId] }); void qc.invalidateQueries({ queryKey: ['timeline', entityId] }); }} />}
    </div>
  );
}

function AgentForm({ entityId, agent, onClose, onSaved }: { entityId: string; agent: PublicAgent | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: agent?.name ?? '', position: agent?.position ?? 'Prefeito(a)', party: agent?.party ?? '', termStart: agent?.termStart ?? '', termEnd: agent?.termEnd ?? '', email: agent?.email ?? '', phone: agent?.phone ?? '', whatsapp: agent?.whatsapp ?? '', notes: agent?.notes ?? '', isDecisionMaker: agent?.isDecisionMaker ?? false, isActive: agent?.isActive ?? true });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const body = { ...f, party: f.party || null, termStart: f.termStart || null, termEnd: f.termEnd || null, email: f.email || null, phone: f.phone || null, whatsapp: f.whatsapp || null, notes: f.notes || null };
      return agent ? api(`/financeiro/entities/${entityId}/agents/${agent.id}`, { method: 'PATCH', body }) : api(`/financeiro/entities/${entityId}/agents`, { method: 'POST', body });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? `${e.message}${e.issues ? ': ' + e.issues.map((i) => `${i.path} ${i.message}`).join('; ') : ''}` : 'Falha ao salvar'),
  });
  const b = (k: 'name' | 'party' | 'termStart' | 'termEnd' | 'email' | 'phone' | 'whatsapp' | 'notes') => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Dialog open onClose={onClose} title={agent ? 'Editar agente público' : 'Novo agente público'}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nome" className="md:col-span-2"><Input {...b('name')} required /></Field>
        <Field label="Cargo"><input list="agent-positions" className="w-full" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /><datalist id="agent-positions">{POSITIONS.map((p) => <option key={p} value={p} />)}</datalist></Field>
        <Field label="Partido"><Input {...b('party')} placeholder="opcional" /></Field>
        <Field label="Início do mandato"><Input type="date" {...b('termStart')} /></Field>
        <Field label="Fim do mandato"><Input type="date" {...b('termEnd')} /></Field>
        <Field label="WhatsApp"><Input {...b('whatsapp')} placeholder="(98) 9 9999-9999" /></Field>
        <Field label="Telefone"><Input {...b('phone')} /></Field>
        <Field label="E-mail" className="md:col-span-2"><Input type="email" {...b('email')} /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...b('notes')} /></Field>
        <label className="row small muted" style={{ gap: 6 }}><input type="checkbox" checked={f.isDecisionMaker} onChange={(e) => setF({ ...f, isDecisionMaker: e.target.checked })} /> Decisor (quem aprova a contratação)</label>
        <label className="row small muted" style={{ gap: 6 }}><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Ativo</label>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={!f.name.trim() || !f.position.trim() || m.isPending}>{m.isPending ? 'Salvando…' : 'Salvar'}</Button></div>
    </Dialog>
  );
}
