'use client';
import { CertificatesPanel } from '@/components/panels/certificates-panel';

export default function CertificatesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Certidões</h1>
      <p className="text-sm text-ink-3">Certidões da empresa sincronizadas do Portal do Cliente. O limiar de "vencendo" é configurável em Administração.</p>
      <CertificatesPanel />
    </div>
  );
}
