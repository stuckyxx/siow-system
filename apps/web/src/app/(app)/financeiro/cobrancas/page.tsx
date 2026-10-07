'use client';
import { CollectionsPanel } from '@/components/panels/collections-panel';

export default function CollectionsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Cobranças</h1>
      <CollectionsPanel />
    </div>
  );
}
