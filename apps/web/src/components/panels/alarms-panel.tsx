'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatBrDate, type IssuanceAlarm, type IssuanceDeadline, type IssuanceDeadlineStatus } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Dialog, Empty, Field, Input, Select, Table, Td, Th, Textarea, useToast } from '../ui';

export const DEADLINE_LABEL: Record<IssuanceDeadlineStatus, string> = { LATE: 'Atrasada', DUE: 'A vencer', UPCOMING: 'Próxima', ISSUED: 'Emitida' };
export const DEADLINE_TONE: Record<IssuanceDeadlineStatus, 'critical' | 'warn' | 'info' | 'good'> = { LATE: 'critical', DUE: 'warn', UPCOMING: 'info', ISSUED: 'good' };

/** Texto do prazo: "faltam 3 dias", "hoje", "2 dias de atraso". */
export function deadlineText(d: IssuanceDeadline): string {
  if (d.status === 'ISSUED') return `nota ${d.issuedInvoiceNumber} emitida em ${formatBrDate(d.issuedAt)}`;
  if (d.daysUntil === 0) return 'vence hoje';
  if (d.daysUntil < 0) return `${-d.daysUntil} dia(s) de atraso`;
  return `faltam ${d.daysUntil} dia(s)`;
}

/**
 * Aba "Alarme" da entidade: dia do mês em que a nota deve ser emitida + antecedência do aviso (padrão 5 dias).
 * O sistema notifica (cron diário → Notificações, Dashboard e /financeiro/alarmes) e marca como emitida
 * quando aparece nota da entidade no mês.
 */
export function AlarmsPanel({ entityId, contracts }: { entityId: string; contracts: Array<{ number: string; status: string }> }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [toast, showToast] = useToast();
  const [editing, setEditing] = useState<IssuanceAlarm | 'new' | null>(null);
  const { data: alarms } = useQuery({ queryKey: ['alarms', entityId], queryFn: () => api<IssuanceAlarm[]>('/financeiro/alarms', { query: { entityId } }) });
  const { data: deadlines } = useQuery({ queryKey: ['alarm-deadlines', entityId], queryFn: () => api<IssuanceDeadline[]>('/financeiro/alarms/deadlines', { query: { entityId, days: 60 } }) });
  const refresh = (): void => { void qc.invalidateQueries({ queryKey: ['alarms'] }); void qc.invalidateQueries({ queryKey: ['alarm-deadlines'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const remove = useMutation({
    mutationFn: (id: string) => api(`/financeiro/alarms/${id}`, { method: 'DELETE' }),
    onSuccess: () => { showToast('Alarme excluído'); refresh(); },
    onError: (e) => showToast(e instanceof ApiError ? e.message : 'Falha ao excluir'),
  });
  const toggle = useMutation({
    mutationFn: (a: IssuanceAlarm) => api(`/financeiro/alarms/${a.id}`, { method: 'PATCH', body: { isActive: !a.isActive } }),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="small muted" style={{ margin: 0, flex: 1 }}>Cadastre o dia do mês em que a nota desta entidade deve ser emitida. O sistema avisa com a antecedência informada (padrão 5 dias) nas Notificações, no Dashboard e no painel de prazos.</p>
        {can('entities.write') && <Button onClick={() => setEditing('new')}>+ Novo alarme</Button>}
      </div>

      <Card>
        <div className="hd"><h2>Próximos prazos</h2></div>
        {!deadlines ? <div className="p-6 text-sm text-ink-3">Carregando…</div> : deadlines.length === 0 ? <div className="p-6"><Empty>Nenhum prazo nos próximos 60 dias. Cadastre um alarme acima.</Empty></div> : (
          <Table>
            <thead><tr><Th>Prazo</Th><Th>Competência</Th><Th>Alarme</Th><Th className="hide-m">Contrato</Th><Th>Situação</Th></tr></thead>
            <tbody>
              {deadlines.map((d) => (
                <tr key={`${d.id}-${d.competence}`}>
                  <Td className="tabular-nums">{formatBrDate(d.dueDate)}</Td>
                  <Td className="tabular-nums">{d.competence.split('-').reverse().join('/')}</Td>
                  <Td>{d.label}</Td>
                  <Td className="hide-m text-ink-2">{d.contractNumber ?? '—'}</Td>
                  <Td><Badge tone={DEADLINE_TONE[d.status]}>{DEADLINE_LABEL[d.status]}</Badge> <span className="small muted">{deadlineText(d)}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <div className="hd"><h2>Alarmes cadastrados</h2></div>
        {!alarms ? <div className="p-6 text-sm text-ink-3">Carregando…</div> : alarms.length === 0 ? <div className="p-6"><Empty>Nenhum alarme cadastrado</Empty></div> : (
          <Table>
            <thead><tr><Th>Dia do mês</Th><Th>Descrição</Th><Th className="hide-m">Contrato</Th><Th>Aviso</Th><Th>Ativo</Th><Th></Th></tr></thead>
            <tbody>
              {alarms.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium tabular-nums">dia {a.dayOfMonth}</Td>
                  <Td>{a.label}{a.notes && <div className="small muted">{a.notes}</div>}</Td>
                  <Td className="hide-m text-ink-2">{a.contractNumber ?? '—'}</Td>
                  <Td>{a.leadDays} dia(s) antes</Td>
                  <Td>{can('entities.write') ? <input type="checkbox" checked={a.isActive} onChange={() => toggle.mutate(a)} aria-label="Ativo" /> : a.isActive ? 'Sim' : 'Não'}</Td>
                  <Td className="text-right">
                    {can('entities.write') && <><Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Editar</Button> <Button size="sm" variant="danger" onClick={() => { if (window.confirm('Excluir este alarme?')) remove.mutate(a.id); }}>Excluir</Button></>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing && <AlarmDialog entityId={entityId} alarm={editing === 'new' ? null : editing} contracts={contracts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); showToast('Alarme salvo'); refresh(); }} />}
      {toast}
    </div>
  );
}

function AlarmDialog({ entityId, alarm, contracts, onClose, onSaved }: { entityId: string; alarm: IssuanceAlarm | null; contracts: Array<{ number: string; status: string }>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ label: alarm?.label ?? 'Emissão da nota', dayOfMonth: String(alarm?.dayOfMonth ?? 1), leadDays: String(alarm?.leadDays ?? 5), contractNumber: alarm?.contractNumber ?? '', notes: alarm?.notes ?? '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body = { label: f.label.trim(), dayOfMonth: Number(f.dayOfMonth), leadDays: Number(f.leadDays), contractNumber: f.contractNumber || null, notes: f.notes.trim() || null };
      return alarm ? api(`/financeiro/alarms/${alarm.id}`, { method: 'PATCH', body }) : api('/financeiro/alarms', { method: 'POST', body: { entityId, ...body } });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Falha ao salvar'),
  });
  const day = Number(f.dayOfMonth); const lead = Number(f.leadDays);
  const valid = f.label.trim().length >= 2 && day >= 1 && day <= 31 && lead >= 0 && lead <= 60;
  const options = [...new Set(contracts.map((c) => c.number))];
  return (
    <Dialog open onClose={onClose} title={alarm ? 'Editar alarme' : 'Novo alarme de emissão'}>
      <form className="frm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <Field label="Dia do mês da emissão"><Input type="number" min={1} max={31} value={f.dayOfMonth} onChange={set('dayOfMonth')} required /></Field>
        <Field label="Avisar com antecedência (dias)"><Input type="number" min={0} max={60} value={f.leadDays} onChange={set('leadDays')} required /></Field>
        <Field label="Descrição" className="w"><Input value={f.label} onChange={set('label')} placeholder="Emissão da nota" required /></Field>
        <Field label="Contrato (opcional)">
          {options.length ? (
            <Select value={f.contractNumber} onChange={set('contractNumber')}><option value="">Qualquer contrato</option>{options.map((n) => <option key={n} value={n}>{n}</option>)}</Select>
          ) : <Input value={f.contractNumber} onChange={set('contractNumber')} placeholder="nº do contrato" />}
        </Field>
        <Field label="Observações"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <p className="small muted w" style={{ margin: 0 }}>Em meses com menos dias (ex.: dia 31 em abril), o prazo passa para o último dia do mês. O alarme fica como "emitida" assim que uma nota da entidade for emitida no mês.</p>
        {error && <p className="small w" style={{ color: 'var(--crit)', margin: 0 }}>{error}</p>}
        <div className="row w" style={{ justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
