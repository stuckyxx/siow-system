'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Building2, CalendarDays, FileBadge, FileText, Gauge, HandCoins, LayoutDashboard, ListChecks, RefreshCw, ScrollText, Settings } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/financeiro', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.read' },
  { href: '/financeiro/entidades', label: 'Entidades', icon: Building2, perm: 'entities.read' },
  { href: '/financeiro/notas', label: 'Notas fiscais', icon: FileText, perm: 'invoices.read' },
  { href: '/financeiro/contratos', label: 'Contratos', icon: ScrollText, perm: 'contracts.read' },
  { href: '/financeiro/agenda', label: 'Agenda', icon: CalendarDays, perm: 'tasks.read' },
  { href: '/financeiro/cobrancas', label: 'Cobranças', icon: HandCoins, perm: 'collections.read' },
  { href: '/financeiro/ordens-de-servico', label: 'Ordens de serviço', icon: ListChecks, perm: 'service_orders.read' },
  { href: '/financeiro/certidoes', label: 'Certidões', icon: FileBadge, perm: 'certificates.read' },
  { href: '/financeiro/relatorios', label: 'Relatórios', icon: Gauge, perm: 'reports.read' },
  { href: '/financeiro/sincronizacao', label: 'Sincronização', icon: RefreshCw, perm: 'sync.read' },
  { href: '/admin', label: 'Administração', icon: Settings, perm: 'users.manage' },
];

function Shell({ children }: { children: React.ReactNode }) {
  const { user, can, logout } = useAuth();
  const pathname = usePathname();
  const { data: notifications } = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api<Array<{ id: string; title: string }>>('/notifications', { query: { unread: true } }), refetchInterval: 60_000 });
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-card md:flex">
        <div className="px-5 py-4">
          <div className="text-base font-semibold">Siow System</div>
          <div className="text-xs text-ink-3">Módulo Financeiro</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.filter((n) => can(n.perm)).map((n) => {
            const active = n.href === '/financeiro' ? pathname === n.href : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm', active ? 'bg-brand/10 font-medium text-brand' : 'text-ink-2 hover:bg-surface')}>
                <n.icon className="h-4 w-4" /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line px-4 py-3 text-xs text-ink-3">
          <div className="truncate font-medium text-ink">{user?.name}</div>
          <div className="truncate">{user?.roles.join(', ')}</div>
          <div className="mt-2 flex gap-3">
            <Link href="/alterar-senha" className="text-brand hover:underline">Alterar senha</Link>
            <button onClick={logout} className="text-brand hover:underline">Sair</button>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-line bg-card px-4 md:px-6">
          <div className="text-sm text-ink-3 md:hidden">Siow System</div>
          <div className="ml-auto flex items-center gap-4">
            <Link href="/notificacoes" className="relative text-ink-2" aria-label="Notificações">
              <Bell className="h-5 w-5" />
              {notifications && notifications.length > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-critical px-1 text-[10px] text-white">{notifications.length}</span>}
            </Link>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
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
