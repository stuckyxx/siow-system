'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { MODULE_LABELS, type ModuleKey } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';

interface PublicPlan { key: string; name: string; description: string | null; priceMonthly: string; maxUsers: number | null; maxEntities: number | null; modules: string[]; trialDays: number }
const brl = (v: string) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Autocadastro (quando habilitado pela plataforma): cria organização em período de teste. */
export default function SignupPage() {
  const { data } = useQuery({ queryKey: ['public-plans'], queryFn: () => api<{ selfSignup: boolean; plans: PublicPlan[] }>('/public/plans') });
  const [f, setF] = useState({ companyName: '', document: '', adminName: '', adminEmail: '', adminPassword: '', planKey: '', acceptTerms: false });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<{ organization: { slug: string; trialEndsAt: string | null }; admin: { email: string } } | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    try { setOk(await api('/public/signup', { method: 'POST', body: { ...f, document: f.document || null, planKey: f.planKey || undefined } })); }
    catch (err) { setError(err instanceof ApiError ? err.message + (err.issues ? ': ' + err.issues.map((i) => i.message).join('; ') : '') : 'Falha ao cadastrar'); }
    finally { setLoading(false); }
  }
  return (
    <main className="login-wrap">
      <div className="lg-card" style={{ maxWidth: 560 }}>
        <div style={{ position: 'absolute', top: 12, right: 12 }}><ThemeToggle className="btn sm ghost" /></div>
        <img className="lg-logo" src="/logo.png" alt="Siow System" />
        <div className="lg-sub">Criar conta de teste</div>
        {data && !data.selfSignup ? <p className="small muted">O cadastro por conta própria não está disponível. Fale com a Siow System para contratar.</p> : ok ? (
          <div className="small"><p><b>Conta criada.</b> Entre com <b>{ok.admin.email}</b> e a senha informada; será pedida uma nova senha no primeiro acesso.{ok.organization.trialEndsAt && <> Teste gratuito até {new Date(ok.organization.trialEndsAt).toLocaleDateString('pt-BR')}.</>}</p><Link className="btn p" href="/login" style={{ display: 'inline-block', marginTop: 12 }}>Ir para o login</Link></div>
        ) : (
          <form onSubmit={submit}>
            <label className="f">Empresa<input value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} required /></label>
            <label className="f">CNPJ (opcional)<input value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} /></label>
            <label className="f">Plano<select value={f.planKey} onChange={(e) => setF({ ...f, planKey: e.target.value })}><option value="">Plano padrão</option>{data?.plans.map((p) => <option key={p.key} value={p.key}>{p.name} — {brl(p.priceMonthly)}/mês · {p.trialDays} dias grátis</option>)}</select></label>
            {f.planKey && data && (() => { const p = data.plans.find((x) => x.key === f.planKey); return p ? <p className="small muted">{p.description} · usuários: {p.maxUsers ?? 'ilimitados'} · entidades: {p.maxEntities ?? 'ilimitadas'} · módulos: {p.modules.length ? p.modules.map((m) => MODULE_LABELS[m as ModuleKey] ?? m).join(', ') : 'todos'}</p> : null; })()}
            <label className="f">Seu nome<input value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} required /></label>
            <label className="f">E-mail<input type="email" autoComplete="username" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} required /></label>
            <label className="f">Senha (mín. 10, com letras, números e símbolo)<input type="password" autoComplete="new-password" value={f.adminPassword} onChange={(e) => setF({ ...f, adminPassword: e.target.value })} required /></label>
            <label className="row small" style={{ gap: 8, textTransform: 'none', color: 'var(--ink2)' }}><input type="checkbox" checked={f.acceptTerms} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} /> Aceito os termos de uso e a política de privacidade (LGPD)</label>
            {error && <div className="err" role="alert">{error}</div>}
            <button className="btn p" type="submit" disabled={loading || !f.acceptTerms}>{loading ? 'Criando…' : 'Criar conta'}</button>
            <p className="small muted" style={{ marginTop: 12 }}>Já tem conta? <Link href="/login" style={{ color: 'var(--accent)' }}>Entrar</Link></p>
          </form>
        )}
      </div>
    </main>
  );
}
