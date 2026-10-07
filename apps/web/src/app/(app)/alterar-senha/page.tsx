'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@/components/ui';

/**
 * Troca de senha do usuário logado. Usada no primeiro acesso (mustChangePassword)
 * — o AuthProvider redireciona para cá — e a qualquer momento pelo próprio usuário.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const required = user?.mustChangePassword === true;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('A confirmação não confere com a nova senha');
      return;
    }
    setLoading(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/financeiro');
    } catch (err) {
      setError(err instanceof ApiError ? err.message + (err.issues?.length ? ': ' + err.issues.map((i) => i.message).join('; ') : '') : 'Falha ao alterar a senha');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Alterar senha</h1>
      <Card>
        <CardHeader>
          <CardTitle>{required ? 'Defina uma nova senha' : 'Nova senha'}</CardTitle>
        </CardHeader>
        <CardContent>
          {required && (
            <p className="mb-4 rounded-md border border-line bg-surface p-3 text-sm text-ink-2">
              Esta é a sua primeira entrada (ou sua senha foi redefinida por um administrador). Por segurança, escolha uma nova senha antes de continuar.
            </p>
          )}
          <form onSubmit={submit} className="space-y-4">
            <Field label="Senha atual">
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </Field>
            <Field label="Nova senha">
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} />
            </Field>
            <Field label="Confirmar nova senha">
              <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={10} />
            </Field>
            <p className="text-xs text-ink-3">Mínimo de 10 caracteres, com letra maiúscula, número e um símbolo (ex.: ! @ # $). Diferente da senha atual.</p>
            {error && <p className="text-sm text-critical">{error}</p>}
            <div className="flex justify-end gap-2">
              {!required && <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>}
              <Button type="submit" disabled={loading}>{loading ? 'Salvando…' : 'Salvar nova senha'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
