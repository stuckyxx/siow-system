'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';
import { Tabs } from '@/components/ui';
import { OrganizationsPanel } from '@/components/platform/organizations';
import { PlansPanel } from '@/components/platform/plans';
import { InvoicesPanel } from '@/components/platform/invoices';
import { OverviewPanel } from '@/components/platform/overview';
import { PlatformSettingsPanel } from '@/components/platform/settings';

interface Admin { id: string; email: string; name: string }

/** Console da plataforma (SaaS): organizações, planos, assinaturas/faturas, uso e configurações. */
export default function PlatformPage() {
  const router = useRouter();
  const { data, error, isLoading } = useQuery({ queryKey: ['platform-me'], queryFn: () => api<Admin>('/platform/auth/me'), retry: false });
  const [tab, setTab] = useState('overview');
  useEffect(() => { if (error instanceof ApiError && error.status === 401) router.replace('/plataforma/login'); }, [error, router]);
  if (isLoading) return <div className="flex h-screen items-center justify-center text-sm text-ink-3">Carregando…</div>;
  if (!data) return null;
  const logout = async () => { await api('/platform/auth/logout', { method: 'POST' }); router.replace('/plataforma/login'); };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="top">
        <div className="brand"><img className="logo" src="/logo.png" alt="Siow System" /><small>Plataforma SaaS</small></div>
        <div className="user" style={{ marginLeft: 'auto' }}>
          <div className="who"><b>{data.name}</b><span>{data.email} · superadmin</span></div>
          <ThemeToggle />
          <a className="btn sm" href="/financeiro">Ir ao sistema</a>
          <button className="btn sm" onClick={() => void logout()}>Sair</button>
        </div>
      </header>
      <main className="content">
        <h1 className="text-xl font-semibold">Administração da plataforma</h1>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Visão geral' }, { key: 'orgs', label: 'Organizações' }, { key: 'plans', label: 'Planos' }, { key: 'invoices', label: 'Faturas' }, { key: 'settings', label: 'Configurações' }]} />
        {tab === 'overview' && <OverviewPanel />}
        {tab === 'orgs' && <OrganizationsPanel />}
        {tab === 'plans' && <PlansPanel />}
        {tab === 'invoices' && <InvoicesPanel />}
        {tab === 'settings' && <PlatformSettingsPanel />}
      </main>
    </div>
  );
}
