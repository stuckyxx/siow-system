'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@/components/ui';

interface Status { enabled: boolean; pending: boolean }
interface Setup { secret: string; otpauth: string }

/** Painel de autenticação em dois fatores (TOTP). `base` = '/auth/mfa' (usuário) ou '/platform/auth/mfa' (superadmin). */
export function MfaPanel({ base }: { base: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['mfa', base], queryFn: () => api<Status>(base) });
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const err = (e: unknown) => setMsg(e instanceof ApiError ? e.message : 'Erro');
  const start = useMutation({ mutationFn: () => api<Setup>(base, { method: 'PUT' }), onSuccess: (s) => { setSetup(s); setMsg(null); }, onError: err });
  const enable = useMutation({ mutationFn: () => api(base, { method: 'PATCH', body: { code } }), onSuccess: () => { setSetup(null); setCode(''); setMsg('2FA ativado. Na próxima entrada será pedido o código do aplicativo.'); qc.invalidateQueries({ queryKey: ['mfa', base] }); }, onError: err });
  const disable = useMutation({ mutationFn: () => api(base, { method: 'DELETE', body: { password, code } }), onSuccess: () => { setCode(''); setPassword(''); setMsg('2FA desativado.'); qc.invalidateQueries({ queryKey: ['mfa', base] }); }, onError: err });
  return (
    <Card>
      <CardHeader><CardTitle>Autenticação em dois fatores (2FA)</CardTitle>{data && <Badge tone={data.enabled ? 'good' : 'neutral'}>{data.enabled ? 'ativo' : 'desativado'}</Badge>}</CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-ink-3">Com o 2FA ativo, além da senha é pedido um código de 6 dígitos gerado por um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy, 1Password…). Recomendado para administradores.</p>
        {data && !data.enabled && !setup && <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending}>Configurar 2FA</Button>}
        {setup && (
          <div className="space-y-2 rounded border border-line p-3">
            <div className="text-sm">1. No aplicativo autenticador, escolha "adicionar conta" e informe a chave manualmente (ou abra o link no celular):</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 16, letterSpacing: 2, wordBreak: 'break-all' }}>{setup.secret.match(/.{1,4}/g)?.join(' ')}</div>
            <a className="btn sm" href={setup.otpauth}>Abrir no aplicativo autenticador</a>
            <div className="text-sm">2. Digite o código de 6 dígitos mostrado no aplicativo para confirmar:</div>
            <div className="flex gap-2 items-end"><Field label="Código"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="w-32" /></Field><Button onClick={() => enable.mutate()} disabled={code.length !== 6 || enable.isPending}>Ativar</Button><Button variant="ghost" onClick={() => setSetup(null)}>Cancelar</Button></div>
          </div>
        )}
        {data?.enabled && (
          <div className="space-y-2 rounded border border-line p-3">
            <div className="text-sm">Para desativar, confirme a senha e um código atual.</div>
            <div className="grid gap-2 md:grid-cols-3 items-end">
              <Field label="Senha"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              <Field label="Código"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
              <Button variant="secondary" onClick={() => { if (window.confirm('Desativar o 2FA desta conta?')) disable.mutate(); }} disabled={!password || code.length !== 6 || disable.isPending}>Desativar 2FA</Button>
            </div>
          </div>
        )}
        {msg && <p className="text-xs text-ink-2">{msg}</p>}
      </CardContent>
    </Card>
  );
}
