'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, formatBrDateTime, type DocumentType } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Empty, Field, Input, Select, Table, Td, Th } from '../ui';

interface Doc { id: string; name: string; type: DocumentType; capturedAt: string; origin: string; blob: { size: number; mimeType: string }; invoiceId: string | null; contractId: string | null }

export function DocumentsPanel({ entityId }: { entityId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<DocumentType>('OTHER');
  const { data } = useQuery({ queryKey: ['documents', entityId], queryFn: () => api<Doc[]>('/documents', { query: { entityId } }) });
  const upload = useMutation({
    mutationFn: async () => { const fd = new FormData(); fd.append('file', file!); fd.append('type', type); fd.append('entityId', entityId); return api('/documents', { method: 'POST', formData: fd }); },
    onSuccess: () => { setFile(null); qc.invalidateQueries({ queryKey: ['documents', entityId] }); },
  });
  const download = async (id: string): Promise<void> => { const r = await api<{ url: string }>(`/documents/${id}/download-url`); window.open(r.url, '_blank', 'noopener'); };
  return (
    <div className="space-y-3">
      {can('documents.write') && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-card p-3">
          <Field label="Tipo"><Select value={type} onChange={(e) => setType(e.target.value as DocumentType)} className="w-56">{DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}</Select></Field>
          <Field label="Arquivo"><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-72" /></Field>
          <Button onClick={() => upload.mutate()} disabled={!file || upload.isPending}>Enviar</Button>
        </div>
      )}
      <Card>
        {!data ? <div className="p-4 text-sm text-ink-3">Carregando…</div> : data.length === 0 ? <div className="p-4"><Empty>Nenhum documento</Empty></div> : (
          <Table>
            <thead><tr><Th>Nome</Th><Th>Tipo</Th><Th>Origem</Th><Th>Capturado em</Th><Th className="text-right">Tamanho</Th><Th></Th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className="hover:bg-surface">
                  <Td className="font-medium">{d.name}</Td>
                  <Td>{DOCUMENT_TYPE_LABELS[d.type]}</Td>
                  <Td className="text-ink-2">{d.origin === 'SYNC' ? 'portal' : 'upload'}</Td>
                  <Td className="text-ink-2">{formatBrDateTime(d.capturedAt)}</Td>
                  <Td className="text-right tabular-nums">{(d.blob.size / 1024).toFixed(0)} KB</Td>
                  <Td><Button size="sm" variant="secondary" onClick={() => download(d.id)}>Baixar</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
