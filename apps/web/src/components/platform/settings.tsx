'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select } from '@/components/ui';
import { errMsg, type Plan } from './shared';
import { MfaPanel } from '@/components/mfa-panel';

export function PlatformSettingsPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['platform-settings'], queryFn: () => api<{ selfSignup: boolean; defaultPlan: string }>('/platform/settings') });
  const { data: plans } = useQuery({ queryKey: ['platform-plans'], queryFn: () => api<Plan[]>('/platform/plans') });
  const save = useMutation({ mutationFn: (b: { selfSignup?: boolean; defaultPlan?: string }) => api('/platform/settings', { method: 'PUT', body: b }), onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-settings'] }), onError: (e) => window.alert(errMsg(e)) });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const changePw = useMutation({ mutationFn: () => api('/platform/auth/change-password', { method: 'POST', body: pw }), onSuccess: () => { setPwMsg('Senha alterada.'); setPw({ currentPassword: '', newPassword: '' }); }, onError: (e) => setPwMsg(errMsg(e)) });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Autocadastro (/cadastro)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Permitir que empresas criem conta de teste por conta própria"><Select value={data?.selfSignup ? '1' : '0'} onChange={(e) => save.mutate({ selfSignup: e.target.value === '1' })}><option value="0">Não (somente a Siow cria organizações)</option><option value="1">Sim</option></Select></Field>
          <Field label="Plano padrão do autocadastro"><Select value={data?.defaultPlan ?? ''} onChange={(e) => save.mutate({ defaultPlan: e.target.value })}>{plans?.filter((p) => p.isActive).map((p) => <option key={p.key} value={p.key}>{p.name}{p.isPublic ? '' : ' (não público)'}</option>)}</Select></Field>
          <p className="text-xs text-ink-3">Só planos marcados como públicos aparecem no autocadastro. A conta nasce em teste pelo prazo do plano e passa a cobrar ao fim (bloqueio suave após a carência).</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Minha senha de plataforma</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Senha atual"><Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="Nova senha (mín. 10, letras, números e símbolo)"><Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
          <div className="flex items-center gap-3"><Button onClick={() => changePw.mutate()} disabled={!pw.currentPassword || !pw.newPassword}>Alterar senha</Button>{pwMsg && <span className="text-xs text-ink-2">{pwMsg}</span>}</div>
        </CardContent>
      </Card>
      <MfaPanel base="/platform/auth/mfa" />
    </div>
  );
}
