'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { formatBRL, type DashboardResponse } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Central do módulo Financeiro (módulo 5): atalhos para todas as funções financeiras existentes. */
const ITEMS: Array<{ href: string; label: string; desc: string; perm: string; icon: string }> = [
  { href: '/financeiro/notas', label: 'Notas fiscais', desc: 'Pendentes, pagas, conflitos, alteração em lote e cadastro manual', perm: 'invoices.read', icon: '🧾' },
  { href: '/financeiro/cobrancas', label: 'Cobranças', desc: 'Casos de cobrança, tentativas e mensagens', perm: 'collections.read', icon: '📨' },
  { href: '/financeiro/alarmes', label: 'Alarmes de emissão', desc: 'Prazos de emissão de notas por entidade', perm: 'invoices.read', icon: '🔔' },
  { href: '/financeiro/agenda', label: 'Agenda', desc: 'Tarefas financeiras, comerciais e de contratos (agenda única)', perm: 'tasks.read', icon: '📅' },
  { href: '/financeiro/ordens-de-servico', label: 'Ordens de serviço', desc: 'Emissão, assinatura e acompanhamento', perm: 'service_orders.read', icon: '📝' },
  { href: '/financeiro/certidoes', label: 'Certidões', desc: 'Validade das certidões e alertas de vencimento', perm: 'certificates.read', icon: '📜' },
  { href: '/financeiro/sincronizacao', label: 'Sincronização', desc: 'Monitoramento das fontes ASSESI/ADOIS', perm: 'sync.read', icon: '🔄' },
  { href: '/financeiro/relatorios', label: 'Relatórios', desc: 'Exportação PDF, Excel e CSV', perm: 'reports.read', icon: '📊' },
];

export default function FinanceiroHubPage() {
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ['dashboard', {}], queryFn: () => api<DashboardResponse>('/financeiro/dashboard'), enabled: can('dashboard.read') });
  const c = data?.cards;
  return (
    <div>
      <h1>Financeiro</h1>
      <p className="sub">Fonte oficial das informações financeiras: notas, recebimentos, cobranças, certidões, ordens de serviço e sincronização.</p>
      {c && (
        <div className="alerts" style={{ marginBottom: 12 }}>
          <Link className={Number(c.totalReceivable) > 0 ? 'warn' : 'good'} href="/financeiro/notas?status=PENDING"><b>{formatBRL(c.totalReceivable)}</b> pendente em {c.pendingInvoices} nota(s)</Link>
          {c.needsReconciliation > 0 && <Link className="crit" href="/financeiro/notas">⚠ <b>{c.needsReconciliation}</b> a verificar</Link>}
          {c.issuanceDue > 0 && <Link className="warn" href="/financeiro/alarmes">🔔 <b>{c.issuanceDue}</b> nota(s) para emitir</Link>}
          {c.certificatesExpiring > 0 && <Link className="warn" href="/financeiro/certidoes"><b>{c.certificatesExpiring}</b> certidão(ões) vencendo</Link>}
        </div>
      )}
      <div className="g2">
        {ITEMS.filter((i) => can(i.perm)).map((i) => (
          <Link key={i.href} href={i.href} className="card" style={{ padding: '14px 18px', textDecoration: 'none' }}>
            <div className="row" style={{ gap: 12 }}><span style={{ fontSize: 22 }}>{i.icon}</span><div><b>{i.label}</b><div className="small muted">{i.desc}</div></div></div>
          </Link>
        ))}
      </div>
    </div>
  );
}
