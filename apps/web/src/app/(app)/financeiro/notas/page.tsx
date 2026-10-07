'use client';
import { InvoicesTable } from '@/components/invoices-table';

export default function InvoicesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Notas fiscais</h1>
      <InvoicesTable />
    </div>
  );
}
