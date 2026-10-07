'use client';
import { ServiceOrdersPanel } from '@/components/panels/service-orders-panel';

export default function ServiceOrdersPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Ordens de serviço</h1>
      <p className="text-sm text-ink-3">Para criar uma OS, abra a entidade e use a aba Ordens de serviço.</p>
      <ServiceOrdersPanel />
    </div>
  );
}
