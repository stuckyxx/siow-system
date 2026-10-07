'use client';
import { ContractsPanel } from '@/components/panels/contracts-panel';

export default function ContractsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Contratos</h1>
      <p className="text-sm text-ink-3">Para cadastrar um contrato, abra a entidade e use a aba Contratos.</p>
      <ContractsPanel />
    </div>
  );
}
