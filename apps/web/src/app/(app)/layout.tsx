'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Building2, FileBadge, FileBarChart, LayoutDashboard, RefreshCw, Settings } from 'lucide-react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { GlobalSearch } from '@/components/global-search';
import { QuickSearch } from '@/components/quick-search';

/** Menu horizontal do protótipo aprovado: somente estes 6 itens, cada um filtrado por permissão. */
const NAV: Array<{ href: string; label: string; icon: typeof LayoutDashboard; perms: string[]; match: (p: string) => boolean }> = [
  { href: '/financeiro', label: 'Dashboard', icon: LayoutDashboard, perms: ['dashboard.read'], match: (p) => p === '/financeiro' },
  {
    href: '/financeiro/entidades', label: 'Entidades', icon: Building2, perms: ['entities.read'],
    match: (p) => ['/financeiro/entidades', '/financeiro/notas', '/financeiro/contratos', '/financeiro/agenda', '/financeiro/cobrancas', '/financeiro/ordens-de-servico'].some((x) => p.startsWith(x)),
  },
  { href: '/financeiro/certidoes', label: 'Certidões', icon: FileBadge, perms: ['certificates.read'], match: (p) => p.startsWith('/financeiro/certidoes') },
  { href: '/financeiro/relatorios', label: 'Relatórios', icon: FileBarChart, perms: ['reports.read'], match: (p) => p.startsWith('/financeiro/relatorios') },
  { href: '/financeiro/sincronizacao', label: 'Sincronização', icon: RefreshCw, perms: ['sync.read'], match: (p) => p.startsWith('/financeiro/sincronizacao') },
  { href: '/admin', label: 'Administração', icon: Settings, perms: ['users.manage', 'settings.manage', 'templates.manage', 'audit.read'], match: (p) => p.startsWith('/admin') },
];

/** Intervalo da função agendada da Netlify (apps/web/netlify.toml → scheduled-sync). */
const SYNC_EVERY_MIN = 20;

interface SyncOverview { sources: Array<{ lastSyncAt: string | null }> }

function SyncIndicator() {
  const { data } = useQuery({ queryKey: ['sync-overview-top'], queryFn: () => api<SyncOverview>('/financeiro/sync/overview'), refetchInterval: 60_000 });
  const last = data?.sources.map((s) => s.lastSyncAt).filter((x): x is string => Boolean(x)).sort().at(-1);
  return (
    <span className="demo" title="A sincronização com o Portal do Cliente roda em segundo plano">
      Sincronização automática · a cada {SYNC_EVERY_MIN} min{last ? ` · última ${new Date(last).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}` : ''}
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, can, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const allowed = (perms: string[]): boolean => perms.some(can);
  const isHome = pathname === '/financeiro';
  const goBack = (): void => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/financeiro');
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="top">
        <Link href="/financeiro" className="brand" title="Siow System — Dashboard">
          <img className="logo" src="/logo.png" alt="Siow System" />
          <small>Módulo Financeiro</small>
        </Link>
        <GlobalSearch />
        {can('sync.read') && <SyncIndicator />}
        <div className="user" style={{ marginLeft: 'auto' }}>
          <div className="who"><b>{user?.name}</b><span>{user?.roles.join(', ')}</span></div>
          <Link href="/alterar-senha" className="btn sm" title="Alterar senha">Senha</Link>
          <button className="btn sm" onClick={() => void logout()}>Sair</button>
        </div>
      </header>
      <nav className="hnav" aria-label="Menu principal">
        {NAV.filter((n) => allowed(n.perms)).map((n) => (
          <Link key={n.href} href={n.href} className={n.match(pathname) ? 'on' : ''}>
            <n.icon strokeWidth={1.8} /> {n.label}
          </Link>
        ))}
      </nav>
      <main className="content">
        {!isHome && <button className="back" onClick={goBack}>← Voltar</button>}
        {children}
      </main>
      <QuickSearch />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
