'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MODULE_LABELS, MODULES, CORE_MODULES, type ModuleKey } from '@siow/shared';
import { api } from '@/lib/api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Field, Input, Select, Table, Td, Textarea, Th } from '@/components/ui';
import { brl, errMsg, type Plan } from './shared';

const EMPTY = { key: '', name: '', description: '', priceMonthly: '0', maxUsers: '', maxEntities: '', modules: [] as string[], trialDays: '14', isActive: true, isPublic: false };

export function PlansPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['platform-plans'], queryFn: () => api<Plan[]>('/platform/plans') });
  const [editing, setEditing] = useState<typeof EMPTY | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (f: typeof EMPTY) => api('/platform/plans', { method: 'PUT', body: { key: f.key.toUpperCase(), name: f.name, description: f.description || null, priceMonthly: f.priceMonthly, maxUsers: f.maxUsers ? Number(f.maxUsers) : null, maxEntities: f.maxEntities ? Number(f.maxEntities) : null, modules: f.modules, trialDays: Number(f.trialDays), isActive: f.isActive, isPublic: f.isPublic } }),
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ['platform-plans'] }); }, onError: (e) => setError(errMsg(e)),
  });
  const edit = (p: Plan) => setEditing({ key: p.key, name: p.name, description: p.description ?? '', priceMonthly: p.priceMonthly, maxUsers: p.maxUsers?.toString() ?? '', maxEntities: p.maxEntities?.toString() ?? '', modules: p.modules, trialDays: String(p.trialDays), isActive: p.isActive, isPublic: p.isPublic });
  const f = editing;
  return (
    <Card>
      <CardHeader><CardTitle>Planos</CardTitle><Button size="sm" onClick={() => { setError(null); setEditing({ ...EMPTY }); }}>Novo plano</Button></CardHeader>
      <CardContent className="px-0">
        <Table>
          <thead><tr><Th>Chave</Th><Th>Nome</Th><Th>Mensalidade</Th><Th>Usuários</Th><Th>Entidades</Th><Th>Módulos</Th><Th>Teste</Th><Th>Situação</Th><Th></Th></tr></thead>
          <tbody>{data?.map((p) => <tr key={p.key}><Td style={{ fontFamily: 'var(--mono)' }}>{p.key}</Td><Td>{p.name}<div className="text-xs text-ink-3">{p.description}</div></Td><Td className="num">{brl(p.priceMonthly)}</Td><Td className="num">{p.maxUsers ?? '∞'}</Td><Td className="num">{p.maxEntities ?? '∞'}</Td><Td className="small">{p.modules.length ? p.modules.map((m) => MODULE_LABELS[m as ModuleKey] ?? m).join(', ') : 'todos'}</Td><Td className="num">{p.trialDays} d</Td><Td>{p.isActive ? <Badge tone="good">ativo</Badge> : <Badge tone="neutral">inativo</Badge>} {p.isPublic && <Badge tone="info">público</Badge>}</Td><Td><Button size="sm" variant="secondary" onClick={() => edit(p)}>Editar</Button></Td></tr>)}</tbody>
        </Table>
      </CardContent>
      <Dialog open={!!f} onClose={() => setEditing(null)} title={f?.key && data?.some((p) => p.key === f.key) ? `Plano ${f.key}` : 'Novo plano'} wide>
        {f && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Chave (A-Z, 0-9, _)"><Input value={f.key} onChange={(e) => setEditing({ ...f, key: e.target.value.toUpperCase() })} disabled={data?.some((p) => p.key === f.key) && f.key !== ''} /></Field>
              <Field label="Nome"><Input value={f.name} onChange={(e) => setEditing({ ...f, name: e.target.value })} /></Field>
              <Field label="Mensalidade (R$)"><Input value={f.priceMonthly} onChange={(e) => setEditing({ ...f, priceMonthly: e.target.value })} /></Field>
              <Field label="Máx. usuários (vazio = ilimitado)"><Input type="number" value={f.maxUsers} onChange={(e) => setEditing({ ...f, maxUsers: e.target.value })} /></Field>
              <Field label="Máx. entidades"><Input type="number" value={f.maxEntities} onChange={(e) => setEditing({ ...f, maxEntities: e.target.value })} /></Field>
              <Field label="Dias de teste"><Input type="number" value={f.trialDays} onChange={(e) => setEditing({ ...f, trialDays: e.target.value })} /></Field>
            </div>
            <Field label="Descrição"><Textarea value={f.description} onChange={(e) => setEditing({ ...f, description: e.target.value })} /></Field>
            <div className="text-xs text-ink-3">Módulos licenciados (nenhum marcado = todos). Núcleo sempre incluído: {CORE_MODULES.map((m) => MODULE_LABELS[m]).join(', ')}.</div>
            <div className="grid gap-1 md:grid-cols-3">{MODULES.filter((m) => !CORE_MODULES.includes(m)).map((m) => <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.modules.includes(m)} onChange={() => setEditing({ ...f, modules: f.modules.includes(m) ? f.modules.filter((x) => x !== m) : [...f.modules, m] })} />{MODULE_LABELS[m]}</label>)}</div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Situação"><Select value={f.isActive ? '1' : '0'} onChange={(e) => setEditing({ ...f, isActive: e.target.value === '1' })}><option value="1">Ativo</option><option value="0">Inativo</option></Select></Field>
              <Field label="Disponível para autocadastro"><Select value={f.isPublic ? '1' : '0'} onChange={(e) => setEditing({ ...f, isPublic: e.target.value === '1' })}><option value="0">Não</option><option value="1">Sim</option></Select></Field>
            </div>
            {error && <div className="err">{error}</div>}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={() => save.mutate(f)} disabled={save.isPending || !f.key || !f.name}>Salvar</Button></div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
