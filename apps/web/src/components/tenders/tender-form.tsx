'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TENDER_MODALITIES, TENDER_MODALITY_LABELS, type TenderRow, toBrDateTimeInput } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAssignees } from '@/components/panels/tasks-panel';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';

export const errMsg = (e: unknown): string => (e instanceof ApiError ? `${e.message}${e.issues?.length ? ': ' + e.issues.map((i) => `${i.path} ${i.message}`).join('; ') : ''}` : 'Erro inesperado');
const local = toBrDateTimeInput;

export function TenderForm({ tender, entityId, onClose, onSaved }: { tender?: TenderRow | null; entityId?: string; onClose: () => void; onSaved: (t: TenderRow) => void }) {
  const editing = Boolean(tender);
  const { data: assignees } = useAssignees();
  const { data: entities } = useQuery({ queryKey: ['entities-lite'], queryFn: () => api<{ entities: Array<{ id: string; name: string; shortName: string | null }> }>('/financeiro/dashboard/filter-options'), enabled: !entityId && !editing });
  const [f, setF] = useState({ entityId: tender?.entity.id ?? entityId ?? '', modality: tender?.modality ?? 'PREGAO_ELETRONICO', number: tender?.number ?? '', year: tender?.year ? String(tender.year) : String(new Date().getFullYear()), officialId: tender?.officialId ?? '', object: tender?.object ?? '', estimatedValue: tender?.estimatedValue?.replace('.', ',') ?? '', ourProposalValue: tender?.ourProposalValue?.replace('.', ',') ?? '', publishedAt: tender?.publishedAt ?? '', proposalDeadline: local(tender?.proposalDeadline), sessionAt: local(tender?.sessionAt), portalUrl: tender?.portalUrl ?? '', ownerUserId: tender?.owner?.id ?? '', notes: tender?.notes ?? '' });
  const [error, setError] = useState<string | null>(null);
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const m = useMutation({
    mutationFn: () => { const body = { ...f, year: f.year ? Number(f.year) : null, officialId: f.officialId || null, estimatedValue: f.estimatedValue ? f.estimatedValue.replace(/\./g, '').replace(',', '.') : null, ourProposalValue: f.ourProposalValue ? f.ourProposalValue.replace(/\./g, '').replace(',', '.') : null, publishedAt: f.publishedAt || null, proposalDeadline: f.proposalDeadline || null, sessionAt: f.sessionAt || null, portalUrl: f.portalUrl || null, ownerUserId: f.ownerUserId || null, notes: f.notes || null }; return editing ? api<TenderRow>(`/licitacoes/${tender!.id}`, { method: 'PATCH', body: { ...body, entityId: undefined } }) : api<TenderRow>('/licitacoes', { method: 'POST', body }); },
    onSuccess: onSaved, onError: (e) => setError(errMsg(e)),
  });
  return (
    <Dialog open onClose={onClose} title={editing ? `Editar licitação ${tender!.number}` : 'Nova licitação'} wide>
      <div className="grid gap-3 md:grid-cols-2">
        {!entityId && !editing && <Field label="Entidade (órgão licitante)" className="md:col-span-2"><Select {...b('entityId')}><option value="">Selecione…</option>{entities?.entities.map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}</option>)}</Select></Field>}
        <Field label="Modalidade"><Select {...b('modality')}>{TENDER_MODALITIES.map((x) => <option key={x} value={x}>{TENDER_MODALITY_LABELS[x]}</option>)}</Select></Field>
        <div className="grid gap-3" style={{ gridTemplateColumns: '2fr 1fr' }}><Field label="Número"><Input {...b('number')} placeholder="012/2026" /></Field><Field label="Ano"><Input type="number" {...b('year')} /></Field></div>
        <Field label="Identificador oficial (nº de controle PNCP)" className="md:col-span-2"><Input {...b('officialId')} placeholder="00000000000000-1-000001/2026" /></Field>
        <Field label="Objeto" className="md:col-span-2"><Textarea rows={3} {...b('object')} /></Field>
        <Field label="Valor estimado (R$)"><Input {...b('estimatedValue')} /></Field>
        <Field label="Nossa proposta (R$)"><Input {...b('ourProposalValue')} /></Field>
        <Field label="Publicação"><Input type="date" {...b('publishedAt')} /></Field>
        <Field label="Responsável"><Select {...b('ownerUserId')}><option value="">Eu</option>{assignees?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Prazo da proposta"><Input type="datetime-local" {...b('proposalDeadline')} /></Field>
        <Field label="Sessão pública"><Input type="datetime-local" {...b('sessionAt')} /></Field>
        <Field label="Link do edital / portal" className="md:col-span-2"><Input {...b('portalUrl')} placeholder="https://…" /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...b('notes')} /></Field>
      </div>
      {!editing && <p className="small muted">Ao criar, o checklist de habilitação é montado automaticamente com as certidões ativas da empresa, e os prazos de proposta e sessão viram itens do calendário.</p>}
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.number || !f.object || !f.entityId}>Salvar</Button></div>
    </Dialog>
  );
}
