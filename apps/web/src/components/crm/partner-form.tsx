'use client';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { PARTNER_KINDS, PARTNER_KIND_LABELS, type PartnerRow } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAssignees } from '@/components/panels/tasks-panel';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';

export const errMsg = (e: unknown): string => (e instanceof ApiError ? `${e.message}${e.issues?.length ? ': ' + e.issues.map((i) => `${i.path} ${i.message}`).join('; ') : ''}` : 'Erro inesperado');

export function PartnerForm({ partner, onClose, onSaved }: { partner: PartnerRow | null; onClose: () => void; onSaved: (p: PartnerRow) => void }) {
  const { data: users } = useAssignees();
  const [f, setF] = useState({ name: partner?.name ?? '', kind: partner?.kind ?? 'REPRESENTANTE', document: partner?.document ?? '', contactName: partner?.contactName ?? '', email: partner?.email ?? '', phone: partner?.phone ?? '', whatsapp: partner?.whatsapp ?? '', userId: partner?.userId ?? '', bankInfo: partner?.bankInfo ?? '', notes: partner?.notes ?? '', isActive: partner?.isActive ?? true });
  const [error, setError] = useState<string | null>(null);
  const b = (k: keyof typeof f) => ({ value: String(f[k]), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const m = useMutation({ mutationFn: () => { const body = { ...f, document: f.document || null, contactName: f.contactName || null, email: f.email || null, phone: f.phone || null, whatsapp: f.whatsapp || null, userId: f.userId || null, bankInfo: f.bankInfo || null, notes: f.notes || null }; return partner ? api<PartnerRow>(`/parceiros/${partner.id}`, { method: 'PATCH', body }) : api<PartnerRow>('/parceiros', { method: 'POST', body }); }, onSuccess: onSaved, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={partner ? `Editar parceiro — ${partner.name}` : 'Novo parceiro'} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nome"><Input {...b('name')} /></Field>
        <Field label="Tipo"><Select {...b('kind')}>{PARTNER_KINDS.map((k) => <option key={k} value={k}>{PARTNER_KIND_LABELS[k]}</option>)}</Select></Field>
        <Field label="CPF/CNPJ"><Input {...b('document')} /></Field>
        <Field label="Pessoa de contato"><Input {...b('contactName')} /></Field>
        <Field label="E-mail"><Input type="email" {...b('email')} /></Field>
        <Field label="Telefone"><Input {...b('phone')} /></Field>
        <Field label="WhatsApp"><Input {...b('whatsapp')} /></Field>
        <Field label="Usuário do portal (papel PARCEIRO)"><Select {...b('userId')}><option value="">Sem acesso ao portal</option>{users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
        <Field label="Dados bancários / PIX" className="md:col-span-2"><Input {...b('bankInfo')} /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...b('notes')} /></Field>
        <label className="row small md:col-span-2" style={{ gap: 6 }}><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Ativo (regras inativas de parceiro inativo não geram comissão)</label>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.name}>Salvar</Button></div>
    </Dialog>
  );
}
