'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatBrDateTime } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, CardContent, CardHeader, CardTitle, Dialog, Field, Input, Table, Td, Th } from '@/components/ui';

interface ApiKeyRow { id: string; name: string; prefix: string; permissions: string[]; isActive: boolean; lastUsedAt: string | null; expiresAt: string | null; createdAt: string }

/** Chaves de API da organização: `Authorization: Bearer sk_…` nas rotas /api (permissões ⊆ do criador). */
export function ApiKeysPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ['api-keys'], queryFn: () => api<ApiKeyRow[]>('/settings/api-keys') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ name: string; permissions: string[]; expiresAt: string }>({ name: '', permissions: [], expiresAt: '' });
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({ mutationFn: () => api<{ key: string; name: string }>('/settings/api-keys', { method: 'POST', body: { name: f.name, permissions: f.permissions, expiresAt: f.expiresAt || null } }), onSuccess: (r) => { setCreated(r); setOpen(false); setF({ name: '', permissions: [], expiresAt: '' }); qc.invalidateQueries({ queryKey: ['api-keys'] }); }, onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro') });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/settings/api-keys/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }) });
  const perms = (user?.permissions ?? []).filter((p) => !p.startsWith('users.') && !p.startsWith('settings.')).sort();
  const toggle = (p: string) => setF({ ...f, permissions: f.permissions.includes(p) ? f.permissions.filter((x) => x !== p) : [...f.permissions, p] });
  return (
    <Card>
      <CardHeader><CardTitle>Chaves de API</CardTitle><Button size="sm" onClick={() => { setError(null); setOpen(true); }}>Nova chave</Button></CardHeader>
      <CardContent className="px-0">
        <p className="px-4 pb-3 text-xs text-ink-3">Use <code>Authorization: Bearer sk_…</code> nas rotas <code>/api</code> (ex.: <code>GET /api/financeiro/entities</code>). A chave só é exibida na criação; as permissões nunca excedem as de quem criou.</p>
        {created && <div className="mx-4 mb-3 p-3 rounded border border-line" style={{ background: 'var(--good-soft)' }}><b>Chave criada ({created.name}).</b> Copie agora — não será mostrada novamente:<div style={{ fontFamily: 'var(--mono)', wordBreak: 'break-all', marginTop: 6 }}>{created.key}</div><Button size="sm" variant="ghost" onClick={() => setCreated(null)}>Fechar</Button></div>}
        <Table>
          <thead><tr><Th>Nome</Th><Th>Prefixo</Th><Th>Permissões</Th><Th>Último uso</Th><Th>Expira</Th><Th></Th></tr></thead>
          <tbody>{data?.map((k) => <tr key={k.id}><Td>{k.name}</Td><Td style={{ fontFamily: 'var(--mono)' }}>sk_{k.prefix}_…</Td><Td className="small">{k.permissions.length} <span className="text-ink-3">({k.permissions.slice(0, 3).join(', ')}{k.permissions.length > 3 ? '…' : ''})</span></Td><Td className="text-ink-2">{k.lastUsedAt ? formatBrDateTime(k.lastUsedAt) : 'nunca'}</Td><Td className="text-ink-2">{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString('pt-BR') : '—'}</Td><Td><Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Revogar a chave "${k.name}"? Integrações que a usam deixarão de funcionar.`)) revoke.mutate(k.id); }}>Revogar</Button></Td></tr>)}
          {data && !data.length && <tr><Td colSpan={6} className="text-center text-ink-3">Nenhuma chave ativa</Td></tr>}</tbody>
        </Table>
      </CardContent>
      <Dialog open={open} onClose={() => setOpen(false)} title="Nova chave de API" wide>
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nome (uso)"><Input value={f.name} placeholder="Ex.: ERP contábil" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Expira em (opcional)"><Input type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
          </div>
          <div className="text-xs text-ink-3">Permissões ({f.permissions.length} selecionadas) — prefira só leitura.</div>
          <div className="grid gap-1 md:grid-cols-3" style={{ maxHeight: 280, overflow: 'auto' }}>{perms.map((p) => <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.permissions.includes(p)} onChange={() => toggle(p)} />{p}</label>)}</div>
          <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setF({ ...f, permissions: perms.filter((p) => p.endsWith('.read')) })}>Marcar leitura</Button><Button size="sm" variant="ghost" onClick={() => setF({ ...f, permissions: [] })}>Limpar</Button></div>
          {error && <div className="err">{error}</div>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => create.mutate()} disabled={create.isPending || !f.name || !f.permissions.length}>Criar chave</Button></div>
        </div>
      </Dialog>
    </Card>
  );
}
