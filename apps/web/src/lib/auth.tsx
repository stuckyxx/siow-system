'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect } from 'react';
import type { CurrentUser } from '@siow/shared';
import { api, ApiError } from './api';

/** /api/auth/me devolve CurrentUser + mustChangePassword (troca obrigatória no 1º acesso). */
export type MeUser = CurrentUser & { mustChangePassword?: boolean };

const CHANGE_PASSWORD_PATH = '/alterar-senha';

const AuthContext = createContext<{ user: MeUser | null; can: (p: string) => boolean; logout: () => Promise<void> }>({ user: null, can: () => false, logout: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: ['me'], queryFn: () => api<MeUser>('/auth/me'), retry: false });

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace('/login');
  }, [error, router]);

  // Senha provisória (seed/redefinição pelo admin): obriga a troca antes de usar o sistema.
  const mustChange = data?.mustChangePassword === true && pathname !== CHANGE_PASSWORD_PATH;
  useEffect(() => {
    if (mustChange) router.replace(CHANGE_PASSWORD_PATH);
  }, [mustChange, router]);

  if (isLoading) return <div className="flex h-screen items-center justify-center text-sm text-ink-3">Carregando…</div>;
  if (!data) return null;
  if (mustChange) return <div className="flex h-screen items-center justify-center text-sm text-ink-3">Redirecionando…</div>;

  const can = (p: string): boolean => data.permissions.includes(p);
  const logout = async (): Promise<void> => {
    await api('/auth/logout', { method: 'POST' });
    qc.clear();
    router.replace('/login');
  };
  return <AuthContext.Provider value={{ user: data, can, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
