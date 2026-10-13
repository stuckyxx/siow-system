import { ApiError } from '@/lib/api';

export const brl = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const errMsg = (e: unknown): string => (e instanceof ApiError ? e.message + (e.issues?.length ? ': ' + e.issues.map((i) => `${i.path} ${i.message}`).join('; ') : '') : e instanceof Error ? e.message : 'Erro');
export const SUB_LABEL: Record<string, string> = { TRIAL: 'teste', ACTIVE: 'ativa', PAST_DUE: 'em atraso', BLOCKED: 'bloqueada', CANCELLED: 'cancelada', EXEMPT: 'isenta' };
export const SUB_TONE: Record<string, 'good' | 'warn' | 'critical' | 'neutral' | 'info'> = { TRIAL: 'info', ACTIVE: 'good', PAST_DUE: 'warn', BLOCKED: 'critical', CANCELLED: 'neutral', EXEMPT: 'neutral' };
export const ORG_LABEL: Record<string, string> = { ACTIVE: 'ativa', READONLY: 'somente leitura', SUSPENDED: 'suspensa' };
export const INV_LABEL: Record<string, string> = { OPEN: 'em aberto', PAID: 'paga', OVERDUE: 'vencida', CANCELLED: 'cancelada' };
export const INV_TONE: Record<string, 'good' | 'warn' | 'critical' | 'neutral' | 'info'> = { OPEN: 'info', PAID: 'good', OVERDUE: 'critical', CANCELLED: 'neutral' };

export interface Plan { key: string; name: string; description: string | null; priceMonthly: string; maxUsers: number | null; maxEntities: number | null; modules: string[]; trialDays: number; isActive: boolean; isPublic: boolean }
export interface Subscription { id: string; planKey: string; status: string; amount: string; billingDay: number; graceDays: number; trialEndsAt: string | null; notes: string | null }
export interface OrgRow { id: string; name: string; slug: string; document: string | null; plan: string; modules: string[]; branding: Record<string, string>; limits: { maxUsers?: number | null; maxEntities?: number | null }; domain: string | null; status: string; trialEndsAt: string | null; blockedAt: string | null; blockReason: string | null; createdAt: string; subscription: Subscription | null; _count: { users: number; entities: number; contracts: number; invoices: number }; openInvoices: Array<{ status: string; count: number; amount: string }> }
export interface PlatformInvoice { id: string; organizationId: string; period: string; amount: string; dueDate: string; status: string; paidAt: string | null; paymentRef: string | null; notes: string | null; organization?: { name: string; slug: string } }
export interface OrgDetail extends OrgRow { invoices: PlatformInvoice[]; access: { planName: string; modules: string[]; readOnly: boolean; limits: { maxUsers: number | null; maxEntities: number | null } }; usage: { users: number; entities: number; contracts: number; invoices: number; tickets: number; opportunities: number; tenders: number; documents: number; storageBytes: number; lastLoginAt: string | null } }
