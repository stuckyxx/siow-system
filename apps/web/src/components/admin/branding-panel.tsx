'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { MODULE_LABELS, type ModuleKey } from '@siow/shared';
import { api, ApiError, apiUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyBranding } from '@/lib/branding';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@/components/ui';

interface Branding { productName?: string; tagline?: string; logoUrl?: string; accent?: string; accent2?: string; supportEmail?: string; domain: string | null; slug: string; name: string }

/** Marca (white-label) + plano/limites da organização. Logotipo via upload (Vercel Blob). */
export function BrandingPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ['branding'], queryFn: () => api<Branding>('/settings/branding') });
  const [f, setF] = useState({ productName: '', tagline: '', accent: '', accent2: '', supportEmail: '' });
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (data) setF({ productName: data.productName ?? '', tagline: data.tagline ?? '', accent: data.accent ?? '', accent2: data.accent2 ?? '', supportEmail: data.supportEmail ?? '' }); }, [data]);
  const save = useMutation({
    mutationFn: () => api('/settings/branding', { method: 'PUT', body: { productName: f.productName || null, tagline: f.tagline || null, accent: f.accent || null, accent2: f.accent2 || null, supportEmail: f.supportEmail || null } }),
    onSuccess: () => { setMsg('Marca salva. Recarregue a página para ver em todas as telas.'); qc.invalidateQueries({ queryKey: ['branding'] }); qc.invalidateQueries({ queryKey: ['me'] }); applyBranding({ accent: f.accent || null, accent2: f.accent2 || null, productName: f.productName || undefined }); },
    onError: (e) => setMsg(e instanceof ApiError ? e.message + (e.issues ? ': ' + e.issues.map((i) => i.message).join('; ') : '') : 'Erro'),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => { const fd = new FormData(); fd.append('file', file); const r = await fetch(apiUrl('/settings/branding/logo'), { method: 'POST', body: fd, credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } }); if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Falha no envio'); return r.json(); },
    onSuccess: () => { setMsg('Logotipo atualizado.'); qc.invalidateQueries({ queryKey: ['branding'] }); qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: (e) => setMsg(e instanceof Error ? e.message : 'Erro'),
  });
  const access = user?.access;
  const mods: ModuleKey[] = Object.keys(MODULE_LABELS) as ModuleKey[];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Marca (white-label)</CardTitle><span className="text-xs text-ink-3">{data?.domain ? `Domínio: ${data.domain}` : 'Sem domínio próprio'}</span></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            <img src={data?.logoUrl ?? '/logo.png'} alt="Logotipo" style={{ height: 48, maxWidth: 220, objectFit: 'contain' }} />
            <label className="btn sm" style={{ cursor: 'pointer' }}>Enviar logotipo<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate(file); }} /></label>
            <span className="text-xs text-ink-3">PNG, JPEG, SVG ou WebP · até 1 MB</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nome do produto"><Input value={f.productName} placeholder="Siow System" onChange={(e) => setF({ ...f, productName: e.target.value })} /></Field>
            <Field label="Subtítulo"><Input value={f.tagline} placeholder="Módulo Financeiro" onChange={(e) => setF({ ...f, tagline: e.target.value })} /></Field>
            <Field label="Cor principal"><div className="flex gap-2"><input type="color" value={f.accent || '#4cc9f0'} onChange={(e) => setF({ ...f, accent: e.target.value })} /><Input value={f.accent} placeholder="#4cc9f0" onChange={(e) => setF({ ...f, accent: e.target.value })} /></div></Field>
            <Field label="Cor secundária"><div className="flex gap-2"><input type="color" value={f.accent2 || '#8b5cf6'} onChange={(e) => setF({ ...f, accent2: e.target.value })} /><Input value={f.accent2} placeholder="#8b5cf6" onChange={(e) => setF({ ...f, accent2: e.target.value })} /></div></Field>
            <Field label="E-mail de suporte"><Input type="email" value={f.supportEmail} onChange={(e) => setF({ ...f, supportEmail: e.target.value })} /></Field>
          </div>
          <div className="flex items-center gap-3"><Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar marca</Button><Button variant="ghost" size="sm" onClick={() => { setF({ productName: '', tagline: '', accent: '', accent2: '', supportEmail: '' }); }}>Limpar (voltar ao padrão)</Button>{msg && <span className="text-xs text-ink-2">{msg}</span>}</div>
          <p className="text-xs text-ink-3">O domínio próprio (ex.: crm.suaempresa.com.br) é configurado pela Siow System: aponte um CNAME para o endereço do sistema e informe o domínio.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Plano e licenciamento</CardTitle>{access && <Badge tone={access.readOnly ? 'critical' : access.subscriptionStatus === 'TRIAL' ? 'warn' : 'good'}>{access.readOnly ? 'somente leitura' : access.subscriptionStatus === 'TRIAL' ? 'teste' : access.subscriptionStatus === 'EXEMPT' ? 'isento' : 'ativo'}</Badge>}</CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <div className="stat card"><div className="l">Plano</div><div className="v" style={{ fontFamily: 'var(--font)' }}>{access?.planName ?? '—'}</div></div>
            <div className="stat card"><div className="l">Usuários</div><div className="v">{access?.limits.maxUsers ?? '∞'}</div><div className="h">limite do plano</div></div>
            <div className="stat card"><div className="l">Entidades</div><div className="v">{access?.limits.maxEntities ?? '∞'}</div><div className="h">limite do plano</div></div>
          </div>
          <div>
            <div className="text-xs text-ink-3 mb-1">Módulos</div>
            <div className="flex flex-wrap gap-1">{mods.map((m) => { const on = !access || access.modules.length === 0 || access.modules.includes(m); return <Badge key={m} tone={on ? 'good' : 'neutral'}>{MODULE_LABELS[m]}</Badge>; })}</div>
          </div>
          {access?.trialEndsAt && access.subscriptionStatus === 'TRIAL' && <p className="text-xs text-ink-2">Teste até {new Date(access.trialEndsAt).toLocaleDateString('pt-BR')}.</p>}
          <div className="pt-2 border-t border-line">
            <div className="text-sm font-medium">Dados e privacidade (LGPD)</div>
            <p className="text-xs text-ink-3 mb-2">Exporta todos os dados da organização em JSON (portabilidade). A exportação é registrada na auditoria.</p>
            <a className="btn sm" href={apiUrl('/settings/export')}>Exportar dados da organização</a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
