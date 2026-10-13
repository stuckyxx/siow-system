'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';

/** Login da plataforma (superadmin Siow) — independente das organizações. */
export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      type Res = { ok: boolean; mfaRequired?: boolean; mfaToken?: string };
      const res = mfaToken ? await api<Res>('/platform/auth/mfa', { method: 'POST', body: { mfaToken, code } }) : await api<Res>('/platform/auth/login', { method: 'POST', body: { email, password } });
      if (res.mfaRequired && res.mfaToken) { setMfaToken(res.mfaToken); return; }
      router.replace('/plataforma');
    }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Falha ao entrar'); }
    finally { setLoading(false); }
  }
  return (
    <main className="login-wrap">
      <div className="lg-card">
        <div style={{ position: 'absolute', top: 12, right: 12 }}><ThemeToggle className="btn sm ghost" /></div>
        <img className="lg-logo" src="/logo.png" alt="Siow System" />
        <div className="lg-sub">Administração da plataforma</div>
        <form onSubmit={submit}>
          {mfaToken ? (<>
            <label className="f">Código do autenticador<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></label>
            {error && <div className="err" role="alert">{error}</div>}
            <button className="btn p" type="submit" disabled={loading || code.length !== 6}>{loading ? 'Verificando…' : 'Confirmar'}</button>
          </>) : (<>
          <label className="f">E-mail<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="f">Senha<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn p" type="submit" disabled={loading}>{loading ? 'Entrando…' : 'Entrar na plataforma'}</button>
          </>)}
        </form>
        <p className="small muted" style={{ marginTop: 12 }}>Acesso exclusivo da Siow System. Usuários das organizações entram em <a href="/login" style={{ color: 'var(--accent)' }}>/login</a>.</p>
      </div>
    </main>
  );
}
