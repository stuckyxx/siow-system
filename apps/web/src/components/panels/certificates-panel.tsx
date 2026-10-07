'use client';
import { useQuery } from '@tanstack/react-query';
import { formatBrDate, formatBrDateTime, type CertificateView } from '@siow/shared';
import { api } from '@/lib/api';
import { CertificateStatusBadge } from '../status';
import { Button, Card, Empty, Table, Td, Th } from '../ui';

/** Certidões (spec §13): status VÁLIDA/VENCENDO/VENCIDA com limiar configurável; download pela versão atual; histórico de versões. */
export function CertificatesPanel({ entityId }: { entityId?: string }) {
  const { data } = useQuery({ queryKey: ['certificates', entityId], queryFn: () => api<CertificateView[]>('/financeiro/certificates', { query: { entityId } }) });
  const download = async (docId: string): Promise<void> => { const r = await api<{ url: string }>(`/documents/${docId}/download-url`); window.open(r.url, '_blank', 'noopener'); };
  return (
    <Card>
      {!data ? <div className="p-4 text-sm text-ink-3">Carregando…</div> : data.length === 0 ? <div className="p-4"><Empty>Nenhuma certidão sincronizada ainda</Empty></div> : (
        <Table>
          <thead><tr><Th>Certidão</Th><Th>Validade</Th><Th>Situação</Th><Th>Capturada em</Th><Th>Versões</Th><Th></Th></tr></thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id} className="hover:bg-surface">
                <Td className="font-medium">{c.name}</Td>
                <Td className="tabular-nums">{formatBrDate(c.current?.validUntil)}{c.daysToExpire !== null && <span className="ml-1 text-xs text-ink-3">({c.daysToExpire >= 0 ? `${c.daysToExpire} dias` : `há ${-c.daysToExpire} dias`})</span>}</Td>
                <Td><CertificateStatusBadge status={c.status} /></Td>
                <Td className="text-ink-2">{c.current ? formatBrDateTime(c.current.capturedAt) : '—'}</Td>
                <Td className="text-center">{c.versionsCount}</Td>
                <Td className="whitespace-nowrap">
                  {c.current?.documentId ? <Button size="sm" variant="secondary" onClick={() => download(c.current!.documentId!)}>Baixar</Button> : c.current?.sourceUrl ? <a className="text-sm text-brand hover:underline" href={c.current.sourceUrl} target="_blank" rel="noopener">Abrir na origem</a> : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
