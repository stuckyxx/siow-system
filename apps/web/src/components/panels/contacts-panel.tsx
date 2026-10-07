'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Dialog, Empty, Field, Input, Table, Td, Th, Textarea } from '../ui';

interface Contact { id: string; name: string; role: string | null; department: string | null; phone: string | null; whatsapp: string | null; email: string | null; notes: string | null; isPrimary: boolean; isFinancial: boolean }

/** Contatos (spec §19). Dados pessoais: exigem contacts.read / contacts.write (LGPD §29). */
export function ContactsPanel({ entityId }: { entityId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Contact | null | 'new'>(null);
  const { data, error } = useQuery({ queryKey: ['contacts', entityId], queryFn: () => api<Contact[]>(`/financeiro/entities/${entityId}/contacts`), enabled: can('contacts.read') });
  const remove = useMutation({ mutationFn: (id: string) => api(`/financeiro/entities/${entityId}/contacts/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', entityId] }) });
  if (!can('contacts.read')) return <Empty>Você não tem permissão para visualizar contatos.</Empty>;
  return (
    <div className="space-y-3">
      {can('contacts.write') && <div className="flex justify-end"><Button onClick={() => setEditing('new')}>Novo contato</Button></div>}
      <Card>
        {error ? <div className="p-4 text-sm text-critical">Erro ao carregar</div> : !data ? <div className="p-4 text-sm text-ink-3">Carregando…</div> : data.length === 0 ? <div className="p-4"><Empty>Nenhum contato cadastrado</Empty></div> : (
          <Table>
            <thead><tr><Th>Nome</Th><Th>Cargo / setor</Th><Th>Telefone</Th><Th>WhatsApp</Th><Th>E-mail</Th><Th></Th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="hover:bg-surface">
                  <Td className="font-medium">{c.name} {c.isPrimary && <Badge tone="info">principal</Badge>} {c.isFinancial && <Badge tone="neutral">financeiro</Badge>}</Td>
                  <Td className="text-ink-2">{[c.role, c.department].filter(Boolean).join(' / ') || '—'}</Td>
                  <Td>{c.phone ?? '—'}</Td><Td>{c.whatsapp ?? '—'}</Td><Td>{c.email ?? '—'}</Td>
                  <Td className="whitespace-nowrap">{can('contacts.write') && <><Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => { if (confirm('Remover contato?')) remove.mutate(c.id); }}>Remover</Button></>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <ContactForm entityId={entityId} contact={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['contacts', entityId] }); }} />}
    </div>
  );
}

function ContactForm({ entityId, contact, onClose, onSaved }: { entityId: string; contact: Contact | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: contact?.name ?? '', role: contact?.role ?? '', department: contact?.department ?? '', phone: contact?.phone ?? '', whatsapp: contact?.whatsapp ?? '', email: contact?.email ?? '', notes: contact?.notes ?? '', isPrimary: contact?.isPrimary ?? false, isFinancial: contact?.isFinancial ?? false });
  const m = useMutation({
    mutationFn: () => {
      const body = { ...f, role: f.role || null, department: f.department || null, phone: f.phone || null, whatsapp: f.whatsapp || null, email: f.email || null, notes: f.notes || null };
      return contact ? api(`/financeiro/entities/${entityId}/contacts/${contact.id}`, { method: 'PATCH', body }) : api(`/financeiro/entities/${entityId}/contacts`, { method: 'POST', body });
    },
    onSuccess: onSaved,
  });
  const b = (k: 'name' | 'role' | 'department' | 'phone' | 'whatsapp' | 'email' | 'notes') => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Dialog open onClose={onClose} title={contact ? 'Editar contato' : 'Novo contato'}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nome" className="md:col-span-2"><Input {...b('name')} /></Field>
        <Field label="Cargo"><Input {...b('role')} /></Field>
        <Field label="Setor"><Input {...b('department')} /></Field>
        <Field label="Telefone"><Input {...b('phone')} /></Field>
        <Field label="WhatsApp"><Input {...b('whatsapp')} placeholder="(98) 9 9999-9999" /></Field>
        <Field label="E-mail" className="md:col-span-2"><Input type="email" {...b('email')} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} /> Contato principal</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isFinancial} onChange={(e) => setF({ ...f, isFinancial: e.target.checked })} /> Contato financeiro</label>
        <Field label="Observação" className="md:col-span-2"><Textarea rows={2} {...b('notes')} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.name}>Salvar</Button></div>
    </Dialog>
  );
}
