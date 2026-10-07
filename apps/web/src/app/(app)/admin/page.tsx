'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatBrDateTime } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Field, Input, Select, Table, Tabs, Td, Textarea, Th } from '@/components/ui';

interface UserRow { id: string; name: string; email: string; isActive: boolean; lastLoginAt: string | null; roles: Array<{ id: string; name: string }> }
interface Role { id: string; name: string; description: string | null; permissions: Array<{ permission: { code: string; description: string | null } }> }
interface Setting { key: string; value: unknown; description: string | null; updatedAt: string }
interface Template { id: string; key: string; name: string; subject: string | null; body: string; channel: string | null; isActive: boolean }
interface Audit { id: string; action: string; resource: string; resourceId: string | null; justification: string | null; ip: string | null; createdAt: string; user: { name: string } | null }

/** Administração da plataforma: usuários/papéis, configurações, modelos de mensagem e auditoria. */
export default function AdminPage() {
  const [tab, setTab] = useState('users');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Administração</h1>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'users', label: 'Usuários' }, { key: 'roles', label: 'Papéis e permissões' }, { key: 'settings', label: 'Configurações' }, { key: 'templates', label: 'Modelos de mensagem' }, { key: 'audit', label: 'Auditoria' }]} />
      {tab === 'users' && <Users />}
      {tab === 'roles' && <Roles />}
      {tab === 'settings' && <Settings />}
      {tab === 'templates' && <Templates />}
      {tab === 'audit' && <AuditLog />}
    </div>
  );
}

function Users() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users') });
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/users/roles') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '', roleId: '' });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({ mutationFn: () => api('/users', { method: 'POST', body: { name: f.name, email: f.email, password: f.password, roleIds: [f.roleId] } }), onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ['users'] }); }, onError: (e) => setError(e instanceof ApiError ? e.message + (e.issues ? ': ' + e.issues.map((i) => i.message).join('; ') : '') : 'Erro') });
  const toggle = useMutation({ mutationFn: (u: UserRow) => api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }) });
  const [reset, setReset] = useState<{ user: UserRow; temporaryPassword: string } | null>(null);
  const resetPassword = useMutation({
    mutationFn: (u: UserRow) => api<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`, { method: 'POST' }).then((r) => ({ user: u, temporaryPassword: r.temporaryPassword })),
    onSuccess: (r) => { setReset(r); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => window.alert(e instanceof ApiError ? e.message : 'Erro ao redefinir a senha'),
  });
  const askReset = (u: UserRow): void => {
    if (window.confirm(`Redefinir a senha de ${u.name}? As sessões ativas serão encerradas e uma senha provisória será gerada.`)) resetPassword.mutate(u);
  };
  return (
    <Card>
      <CardHeader><CardTitle>Usuários</CardTitle><Button size="sm" onClick={() => setOpen(true)}>Novo usuário</Button></CardHeader>
      <CardContent className="px-0">
        <Table>
          <thead><tr><Th>Nome</Th><Th>E-mail</Th><Th>Papéis</Th><Th>Último acesso</Th><Th>Situação</Th><Th></Th></tr></thead>
          <tbody>{data?.map((u) => <tr key={u.id}><Td>{u.name}</Td><Td className="text-ink-2">{u.email}</Td><Td>{u.roles.map((r) => <Badge key={r.id} tone="info" className="mr-1">{r.name}</Badge>)}</Td><Td className="text-ink-2">{u.lastLoginAt ? formatBrDateTime(u.lastLoginAt) : '—'}</Td><Td>{u.isActive ? <Badge tone="good">ativo</Badge> : <Badge tone="neutral">inativo</Badge>}</Td><Td className="whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => askReset(u)} disabled={resetPassword.isPending}>Redefinir senha</Button> <Button size="sm" variant="ghost" onClick={() => toggle.mutate(u)}>{u.isActive ? 'Desativar' : 'Ativar'}</Button></Td></tr>)}</tbody>
        </Table>
      </CardContent>
      <Dialog open={Boolean(reset)} onClose={() => setReset(null)} title="Senha provisória gerada">
        {reset && (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">Informe esta senha a <strong>{reset.user.name}</strong> ({reset.user.email}). Ela só é exibida agora; no próximo login o sistema exigirá a troca.</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={reset.temporaryPassword} onFocus={(e) => e.currentTarget.select()} className="font-mono" />
              <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(reset.temporaryPassword); }}>Copiar</Button>
            </div>
            <div className="flex justify-end"><Button onClick={() => setReset(null)}>Fechar</Button></div>
          </div>
        )}
      </Dialog>
      <Dialog open={open} onClose={() => setOpen(false)} title="Novo usuário">
        <div className="space-y-3">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Senha inicial (mín. 10 caracteres)"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <Field label="Papel"><Select value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}><option value="">Selecione</option>{roles?.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.description}</option>)}</Select></Field>
          {error && <p className="text-sm text-critical">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => create.mutate()} disabled={!f.roleId || create.isPending}>Criar</Button></div>
        </div>
      </Dialog>
    </Card>
  );
}

function Roles() {
  const qc = useQueryClient();
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/users/roles') });
  const { data: perms } = useQuery({ queryKey: ['permissions'], queryFn: () => api<Array<{ code: string; description: string | null }>>('/users/permissions') });
  const save = useMutation({ mutationFn: (v: { roleId: string; permissions: string[] }) => api(`/users/roles/${v.roleId}/permissions`, { method: 'PUT', body: { permissions: v.permissions } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }) });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {roles?.map((r) => {
        const current = new Set(r.permissions.map((p) => p.permission.code));
        return (
          <Card key={r.id}>
            <CardHeader><CardTitle>{r.name}</CardTitle><span className="text-xs text-ink-3">{r.description}</span></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-1 text-xs">
                {perms?.map((p) => (
                  <label key={p.code} className="flex items-center gap-2"><input type="checkbox" checked={current.has(p.code)} onChange={(e) => { const next = new Set(current); if (e.target.checked) next.add(p.code); else next.delete(p.code); save.mutate({ roleId: r.id, permissions: [...next] }); }} /> <span title={p.description ?? ''}>{p.code}</span></label>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Settings() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<Setting[]>('/settings') });
  const save = useMutation({ mutationFn: (v: { key: string; value: unknown }) => api(`/settings/${v.key}`, { method: 'PUT', body: { value: v.value } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }) });
  return (
    <Card>
      <CardHeader><CardTitle>Configurações</CardTitle><span className="text-xs text-ink-3">Alterar o cron exige reiniciar o worker</span></CardHeader>
      <CardContent className="space-y-3">
        {data?.filter((s) => typeof s.value !== 'object').map((s) => (
          <div key={s.key} className="grid items-center gap-2 md:grid-cols-[260px_1fr_auto]">
            <div><div className="text-sm font-medium">{s.key}</div><div className="text-xs text-ink-3">{s.description}</div></div>
            <SettingInput setting={s} onSave={(value) => save.mutate({ key: s.key, value })} />
            <div className="text-xs text-ink-3">{formatBrDateTime(s.updatedAt)}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SettingInput({ setting, onSave }: { setting: Setting; onSave: (v: unknown) => void }) {
  const [v, setV] = useState(String(setting.value));
  if (typeof setting.value === 'boolean') return <Select value={v} onChange={(e) => { setV(e.target.value); onSave(e.target.value === 'true'); }} className="w-40"><option value="true">Sim</option><option value="false">Não</option></Select>;
  return <div className="flex gap-2"><Input value={v} onChange={(e) => setV(e.target.value)} className="max-w-xs" /><Button size="sm" variant="secondary" onClick={() => onSave(typeof setting.value === 'number' ? Number(v) : v)}>Salvar</Button></div>;
}

function Templates() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['templates'], queryFn: () => api<Template[]>('/financeiro/messages/templates') });
  const [editing, setEditing] = useState<Template | null>(null);
  const [f, setF] = useState({ key: '', name: '', subject: '', body: '' });
  const save = useMutation({ mutationFn: () => api('/financeiro/messages/templates', { method: 'PUT', body: { key: f.key, name: f.name, subject: f.subject || null, body: f.body } }), onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ['templates'] }); } });
  const open = (t: Template | null): void => { setF(t ? { key: t.key, name: t.name, subject: t.subject ?? '', body: t.body } : { key: '', name: '', subject: '', body: '' }); setEditing(t ?? ({ id: 'new' } as Template)); };
  return (
    <Card>
      <CardHeader><CardTitle>Modelos de mensagem</CardTitle><Button size="sm" onClick={() => open(null)}>Novo modelo</Button></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-ink-3">Variáveis: {'{{contato}} {{entidade}} {{municipio}} {{competencia}} {{exercicio}} {{contrato}} {{numeroNota}} {{valor}} {{emissao}} {{empresa}}'} — seções condicionais com {'{{#contato}}…{{/contato}}'}.</p>
        {data?.map((t) => <div key={t.id} className="flex items-start justify-between gap-3 rounded-md border border-line p-3"><div><div className="text-sm font-medium">{t.name} <span className="text-xs text-ink-3">({t.key})</span></div><div className="mt-1 whitespace-pre-wrap text-xs text-ink-2">{t.body}</div></div><Button size="sm" variant="ghost" onClick={() => open(t)}>Editar</Button></div>)}
      </CardContent>
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title="Modelo de mensagem" wide>
        <div className="space-y-3">
          <Field label="Chave (A-Z, 0-9, _)"><Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase() })} disabled={editing?.id !== 'new'} /></Field>
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Assunto (e-mail)"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
          <Field label="Mensagem"><Textarea rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={() => save.mutate()} disabled={save.isPending || !f.key || !f.body}>Salvar</Button></div>
        </div>
      </Dialog>
    </Card>
  );
}

function AuditLog() {
  const [resource, setResource] = useState('');
  const { data } = useQuery({ queryKey: ['audit', resource], queryFn: () => api<{ items: Audit[]; total: number }>('/audit', { query: { resource: resource || undefined, pageSize: 100 } }) });
  return (
    <Card>
      <CardHeader><CardTitle>Auditoria</CardTitle><Input placeholder="recurso (invoice, contract, user…)" value={resource} onChange={(e) => setResource(e.target.value)} className="w-64" /></CardHeader>
      <CardContent className="px-0">
        <Table>
          <thead><tr><Th>Data/hora</Th><Th>Usuário</Th><Th>Ação</Th><Th>Recurso</Th><Th>Justificativa</Th><Th>IP</Th></tr></thead>
          <tbody>{data?.items.map((a) => <tr key={a.id}><Td className="whitespace-nowrap text-ink-2">{formatBrDateTime(a.createdAt)}</Td><Td>{a.user?.name ?? 'sistema'}</Td><Td><Badge tone="neutral">{a.action}</Badge></Td><Td className="text-xs">{a.resource}{a.resourceId ? ` · ${a.resourceId.slice(0, 8)}` : ''}</Td><Td className="max-w-xs truncate text-xs text-ink-2">{a.justification ?? ''}</Td><Td className="text-xs text-ink-3">{a.ip ?? ''}</Td></tr>)}</tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
