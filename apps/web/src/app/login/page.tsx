'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean; user: { mustChangePassword: boolean } }>('/auth/login', { method: 'POST', body: { email, password } });
      // Senha provisória (primeiro acesso / redefinida pelo admin): troca obrigatória.
      router.replace(res.user?.mustChangePassword ? '/alterar-senha' : '/financeiro');
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos ou peça ao administrador para redefinir a senha.' : err.status >= 500 ? 'Sistema indisponível no momento. Tente novamente em instantes.' : err.message) : 'Falha ao entrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-wrap">
      <div className="lg-card">
        <img className="lg-logo" src="/logo.png" alt="Siow System" />
        <div className="lg-sub">Módulo Financeiro</div>
        <form onSubmit={submit}>
          <label className="f">E-mail<input type="email" autoComplete="username" placeholder="voce@siowsystem.com.br" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="f">Senha<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn p" type="submit" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <button className="link small" style={{ marginTop: 12 }} onClick={() => setInfo('Peça ao administrador do sistema para redefinir sua senha (Administração → Usuários → Redefinir senha).')}>Esqueci minha senha</button>
        {info && <p className="small muted" style={{ marginTop: 8 }}>{info}</p>}
      </div>
    </main>
  );
}
