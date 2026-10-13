/**
 * Retenção de registros operacionais (Fase 11). Só remove histórico técnico, nunca dados de negócio:
 *  - sync_runs concluídos (SUCCESS/SKIPPED) com mais de `sync.retentionDays` (padrão 180), preservando a última execução de cada fonte;
 *  - sessões revogadas/expiradas há mais de 30 dias;
 *  - notificações lidas há mais de 90 dias.
 * Execuções com falha são mantidas (evidência para suporte). Configurável por organização.
 */
import { prisma } from '../db.js';

export interface RetentionResult { syncRuns: number; sessions: number; notifications: number; assistantConversations: number; retentionDays: number }

export async function retention(now = new Date()): Promise<RetentionResult> {
  const s = await prisma.setting.findFirst({ where: { key: 'sync.retentionDays' } });
  const retentionDays = Math.max(30, Number(s?.value ?? 180) || 180);
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  // Última execução por fonte (preservada mesmo que antiga).
  const latest = await prisma.syncRun.groupBy({ by: ['dataSourceId'], _max: { queuedAt: true } });
  const keepIds = (await prisma.syncRun.findMany({ where: { OR: latest.map((l) => ({ dataSourceId: l.dataSourceId, queuedAt: l._max.queuedAt ?? undefined })) }, select: { id: true } })).map((r) => r.id);
  const syncRuns = latest.length ? (await prisma.syncRun.deleteMany({ where: { status: { in: ['SUCCESS', 'SKIPPED'] }, queuedAt: { lt: cutoff }, id: { notIn: keepIds } } })).count : 0;
  const users = await prisma.user.findMany({ select: { id: true } });
  const sessions = (await prisma.session.deleteMany({ where: { userId: { in: users.map((u) => u.id) }, OR: [{ revokedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } }, { expiresAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } }] } })).count;
  const notifications = (await prisma.notification.deleteMany({ where: { readAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } })).count;
  // Fase 13: conversas do Assistente excluídas pelo usuário há mais de 30 dias ou sem atividade há `retentionDays`.
  const assistantConversations = (await prisma.assistantConversation.deleteMany({ where: { OR: [{ deletedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } }, { updatedAt: { lt: cutoff } }] } })).count;
  return { syncRuns, sessions, notifications, assistantConversations, retentionDays };
}
