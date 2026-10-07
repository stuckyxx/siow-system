'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, Card, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
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
      setError(err instanceof ApiError ? (err.status === 429 ? 'Muitas tentativas. Aguarde um minuto.' : err.message) : 'Falha ao entrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6">
          <div className="text-lg font-semibold">Siow System</div>
          <div className="text-sm text-ink-3">Acesso à plataforma</div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="E-mail">
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Senha">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <p className="text-sm text-critical">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</Button>
        </form>
      </Card>
    </main>
  );
}
