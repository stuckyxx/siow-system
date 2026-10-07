'use client';
import {
  CERTIFICATE_STATUS_LABELS,
  COLLECTION_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  SERVICE_ORDER_STATUS_LABELS,
  SYNC_STATUS_LABELS,
  TASK_STATUS_LABELS,
  type CertificateStatus,
  type CollectionStatus,
  type ContractStatus,
  type InvoiceStatus,
  type ServiceOrderStatus,
  type SyncStatus,
  type TaskStatus,
} from '@siow/shared';
import { Badge } from './ui';

/** Badges de status com rótulo em PT-BR e cor semântica — nunca cor sozinha. */
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const tone = status === 'PAID' ? 'good' : status === 'PENDING' ? 'warn' : status === 'CANCELLED' ? 'neutral' : 'serious';
  return <Badge tone={tone}>{INVOICE_STATUS_LABELS[status]}</Badge>;
}
export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const tone = status === 'ACTIVE' ? 'good' : status === 'EXPIRED' || status === 'TERMINATED' ? 'neutral' : 'warn';
  return <Badge tone={tone}>{CONTRACT_STATUS_LABELS[status]}</Badge>;
}
export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const tone = status === 'DONE' ? 'good' : status === 'IN_PROGRESS' ? 'info' : status === 'CANCELLED' ? 'neutral' : 'warn';
  return <Badge tone={tone}>{TASK_STATUS_LABELS[status]}</Badge>;
}
export function CollectionStatusBadge({ status }: { status: CollectionStatus | null }) {
  if (!status) return <Badge tone="neutral">Não cobrada</Badge>;
  const tone = status === 'SETTLED' ? 'good' : status === 'NOT_CHARGED' ? 'neutral' : status === 'PAYMENT_PROMISED' || status === 'AWAITING_PAYMENT' ? 'info' : 'warn';
  return <Badge tone={tone}>{COLLECTION_STATUS_LABELS[status]}</Badge>;
}
export function ServiceOrderStatusBadge({ status }: { status: ServiceOrderStatus }) {
  const tone = status === 'SIGNED' ? 'good' : status === 'CANCELLED' ? 'neutral' : status === 'NOT_REQUESTED' ? 'serious' : 'warn';
  return <Badge tone={tone}>{SERVICE_ORDER_STATUS_LABELS[status]}</Badge>;
}
export function CertificateStatusBadge({ status }: { status: CertificateStatus }) {
  const tone = status === 'VALID' ? 'good' : status === 'EXPIRING' ? 'warn' : status === 'EXPIRED' ? 'critical' : 'neutral';
  return <Badge tone={tone}>{CERTIFICATE_STATUS_LABELS[status]}</Badge>;
}
export function SyncStatusBadge({ status }: { status: SyncStatus | null }) {
  if (!status) return <Badge tone="neutral">Nunca</Badge>;
  const tone = status === 'SUCCESS' ? 'good' : status === 'PARTIAL' ? 'warn' : status === 'FAILED' ? 'critical' : status === 'RUNNING' || status === 'QUEUED' ? 'info' : 'neutral';
  return <Badge tone={tone}>{SYNC_STATUS_LABELS[status]}</Badge>;
}
