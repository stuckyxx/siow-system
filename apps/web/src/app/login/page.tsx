'use client';
import { ThemeToggle } from '@/components/theme-toggle';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { usePublicBranding } from '@/lib/branding';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const brand = usePublicBranding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  // "Salvar meus dados": guarda o e-mail neste navegador (a senha fica com o gerenciador de senhas do navegador).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('siow.login.email');
      if (saved) { setEmail(saved); setRemember(true); }
    } catch { /* armazenamento indisponível */ }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      type LoginRes = { ok: boolean; mfaRequired?: boolean; mfaToken?: string; user: { mustChangePassword: boolean } };
      const res = mfaToken
        ? await api<LoginRes>('/auth/mfa', { method: 'POST', body: { mfaToken, code } })
        : await api<LoginRes>('/auth/login', { method: 'POST', body: { email, password } });
      if (res.mfaRequired && res.mfaToken) { setMfaToken(res.mfaToken); setLoading(false); return; }
      try {
        if (remember) window.localStorage.setItem('siow.login.email', email.trim());
        else window.localStorage.removeItem('siow.login.email');
      } catch { /* armazenamento indisponível */ }
      // Senha provisória (primeiro acesso / redefinida pelo admin): troca obrigatória.
      if (res.user?.mustChangePassword) { router.replace('/alterar-senha'); return; }
      const me = await api<{ permissions: string[] }>('/auth/me').catch(() => null);
      router.replace(me && !me.permissions.includes('dashboard.read') && me.permissions.includes('partners.portal') ? '/parceiro' : '/financeiro');
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos ou peça ao administrador para redefinir a senha.' : err.status >= 500 ? 'Sistema indisponível no momento. Tente novamente em instantes.' : err.message) : 'Falha ao entrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-wrap">
      <div className="lg-card">
        <div style={{ position: 'absolute', top: 12, right: 12 }}><ThemeToggle className="btn sm ghost" /></div>
        <img className="lg-logo" src={brand.logoUrl} alt={brand.productName} />
        <div className="lg-sub">{brand.tagline}</div>
        <form onSubmit={submit}>
          {mfaToken ? (
            <>
              <p className="small" style={{ color: 'var(--ink2)' }}>Digite o código de 6 dígitos do seu aplicativo autenticador.</p>
              <label className="f">Código de verificação<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></label>
              {error && <div className="err" role="alert">{error}</div>}
              <button className="btn p" type="submit" disabled={loading || code.length !== 6}>{loading ? 'Verificando…' : 'Confirmar'}</button>
              <button type="button" className="link small" style={{ marginTop: 10 }} onClick={() => { setMfaToken(null); setCode(''); setError(null); }}>Voltar</button>
            </>
          ) : (
            <>
          <label className="f">E-mail<input type="email" autoComplete="username" placeholder="voce@siowsystem.com.br" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="f">Senha<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <label className="row small" style={{ gap: 8, textTransform: 'none', color: 'var(--ink2)' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Salvar meus dados de acesso neste dispositivo
          </label>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn p" type="submit" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</button>
            </>
          )}
        </form>
        <button className="link small" style={{ marginTop: 12 }} onClick={() => setInfo('Peça ao administrador do sistema para redefinir sua senha (Administração → Usuários → Redefinir senha).')}>Esqueci minha senha</button>
        {info && <p className="small muted" style={{ marginTop: 8 }}>{info}</p>}
        {brand.selfSignup && !brand.organizationSlug && <p className="small muted" style={{ marginTop: 14 }}>Ainda não tem conta? <Link href="/cadastro" style={{ color: 'var(--accent)' }}>Criar conta de teste</Link></p>}
      </div>
    </main>
  );
}
