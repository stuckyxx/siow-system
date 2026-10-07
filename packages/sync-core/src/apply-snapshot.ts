import { Prisma, type InvoiceStatus, type PrismaClient } from '@siow/db';
import type { BillingSnapshot, InvoiceSnapshot } from '@siow/integrations';
import { isoToDate, toDecimalString } from '@siow/shared';
import { syncCertificates } from './certificates.js';
import { resolveContractForInvoice, syncContracts } from './contracts.js';

export interface ApplySnapshotInput {
  dataSourceId: string;
  entityId: string;
  syncRunId: string;
  snapshot: BillingSnapshot;
  /** campos que nunca são sobrescritos quando a nota tem manualOverride */
  protectedFields?: string[];
}

export interface ApplySnapshotStats {
  invoicesSeen: number;
  invoicesCreated: number;
  invoicesUpdated: number;
  statusChanges: number;
  conflicts: number;
  missing: number;
  reappeared: number;
  contractsCreated: number;
  contractsUpdated: number;
  amendmentsCreated: number;
  certificatesNewVersions: number;
  certificateVersionIdsToFetch: string[];
  warnings: string[];
  summaryMismatch: { localDebt: string; portalDebt: string | null } | null;
  /** true quando a detecção de notas ausentes foi pulada por suspeita de snapshot inválido (ex.: portal fora do ar / login). */
  missingDetectionSkipped: boolean;
}

const DEFAULT_PROTECTED = ['status', 'paidAt', 'amount'];

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v instanceof Prisma.Decimal) return v.toFixed(2);
  return String(v);
};

/**
 * Aplica um snapshot da fonte externa ao banco preservando histórico.
 *
 * Princípios (spec §5, §26):
 *  - nota nova → cria + evento CREATED
 *  - nota existente → atualiza campo a campo; cada mudança vira InvoiceEvent
 *  - nota com alteração manual protegida → campos protegidos NÃO são
 *    sobrescritos; divergência vira SyncConflict(OPEN) para decisão humana
 *  - nota que sumiu da fonte → NÃO é apagada nem marcada como paga:
 *    recebe missingSince + needsReconciliation
 *  - fonte voltou a mostrar como pendente uma nota paga → needsReconciliation
 */
export async function applySnapshot(prisma: PrismaClient, input: ApplySnapshotInput): Promise<ApplySnapshotStats> {
  const { snapshot, entityId, dataSourceId, syncRunId } = input;
  const protectedFields = new Set(input.protectedFields ?? DEFAULT_PROTECTED);
  const now = new Date();
  const stats: ApplySnapshotStats = {
    invoicesSeen: snapshot.invoices.length,
    invoicesCreated: 0,
    invoicesUpdated: 0,
    statusChanges: 0,
    conflicts: 0,
    missing: 0,
    reappeared: 0,
    contractsCreated: 0,
    contractsUpdated: 0,
    amendmentsCreated: 0,
    certificatesNewVersions: 0,
    certificateVersionIdsToFetch: [],
    warnings: [...snapshot.warnings],
    summaryMismatch: null,
    missingDetectionSkipped: false,
  };

  await prisma.$transaction(
    async (tx) => {
      // ---- entidade / fonte: só preenche o que está vazio ----
      const entity = await tx.entity.findUniqueOrThrow({ where: { id: entityId } });
      const entityPatch: Prisma.EntityUpdateInput = {};
      if (!entity.shortName && snapshot.entity.shortName) entityPatch.shortName = snapshot.entity.shortName;
      if (!entity.logoUrl && snapshot.entity.logoUrl) entityPatch.logoUrl = snapshot.entity.logoUrl;
      if (Object.keys(entityPatch).length) await tx.entity.update({ where: { id: entityId }, data: entityPatch });
      await tx.dataSource.update({
        where: { id: dataSourceId },
        data: {
          externalEntityCode: snapshot.entity.externalCode ?? undefined,
          externalEntityType: snapshot.entity.externalType ?? undefined,
        },
      });

      // ---- contratos ----
      const contracts = await syncContracts(tx, entityId, snapshot.contracts);
      stats.contractsCreated = contracts.created;
      stats.contractsUpdated = contracts.updated;
      stats.amendmentsCreated = contracts.amendmentsCreated;
      stats.warnings.push(...contracts.warnings);

      // ---- notas ----
      const seenNumbers = new Set<string>();
      for (const inv of dedupeInvoices(snapshot.invoices, stats.warnings)) {
        seenNumbers.add(inv.number);
        const contractId = await resolveContractForInvoice(
          tx,
          entityId,
          inv.contractExternalCode,
          inv.competenceMonth,
          inv.competenceYear,
          contracts,
        );
        const existing = await tx.invoice.findUnique({ where: { entityId_number: { entityId, number: inv.number } } });
        const incoming = {
          status: inv.status as InvoiceStatus,
          paidAt: inv.paidAt ? isoToDate(inv.paidAt) : null,
          amount: new Prisma.Decimal(toDecimalString(inv.amount)),
          issueDate: inv.issueDate ? isoToDate(inv.issueDate) : null,
          competenceMonth: inv.competenceMonth,
          competenceYear: inv.competenceYear,
          contractId,
          externalId: inv.externalId,
          documentUrl: inv.documents.find((d) => d.kind === 'INVOICE')?.url ?? null,
          receiptUrl: inv.documents.find((d) => d.kind === 'RECEIPT')?.url ?? null,
          description: inv.description,
          sourceStatusRaw: inv.statusRaw,
        };

        if (!existing) {
          const created = await tx.invoice.create({
            data: {
              entityId,
              dataSourceId,
              number: inv.number,
              ...incoming,
              paidAmount: incoming.status === 'PAID' ? incoming.amount : null,
              origin: 'SYNC',
              firstSeenAt: now,
              lastSeenAt: now,
              rawSnapshot: inv.raw as Prisma.InputJsonValue,
            },
          });
          await tx.invoiceEvent.create({
            data: {
              invoiceId: created.id,
              type: 'CREATED',
              origin: 'SYNC',
              syncRunId,
              newValue: incoming.status,
              note: `Nota encontrada na fonte com status ${incoming.status}`,
            },
          });
          stats.invoicesCreated += 1;
          continue;
        }

        if (existing.deletedAt) continue; // excluída logicamente por um usuário: não ressuscitar

        const patch: Prisma.InvoiceUncheckedUpdateInput = { lastSeenAt: now, sourceStatusRaw: inv.statusRaw, rawSnapshot: inv.raw as Prisma.InputJsonValue };
        const events: Prisma.InvoiceEventUncheckedCreateInput[] = [];
        let changed = false;

        const compare: Array<[keyof typeof incoming, unknown, unknown]> = [
          ['status', existing.status, incoming.status],
          ['paidAt', existing.paidAt, incoming.paidAt],
          ['amount', existing.amount, incoming.amount],
          ['issueDate', existing.issueDate, incoming.issueDate],
          ['competenceMonth', existing.competenceMonth, incoming.competenceMonth],
          ['competenceYear', existing.competenceYear, incoming.competenceYear],
          ['contractId', existing.contractId, incoming.contractId],
          ['externalId', existing.externalId, incoming.externalId],
          ['documentUrl', existing.documentUrl, incoming.documentUrl],
          ['receiptUrl', existing.receiptUrl, incoming.receiptUrl],
        ];

        for (const [field, oldV, newV] of compare) {
          const oldS = str(oldV);
          const newS = str(newV);
          if (oldS === newS) continue;
          // não "apagar" contrato/ids já conhecidos com null vindo da fonte
          if (newS === null && ['contractId', 'externalId', 'documentUrl', 'receiptUrl', 'issueDate'].includes(field)) continue;

          if (existing.manualOverride && protectedFields.has(field)) {
            const open = await tx.syncConflict.findFirst({
              where: { invoiceId: existing.id, field, status: 'OPEN', sourceValue: newS },
            });
            if (!open) {
              await tx.syncConflict.create({
                data: { invoiceId: existing.id, syncRunId, field, manualValue: oldS, sourceValue: newS },
              });
              events.push({
                invoiceId: existing.id,
                type: 'CONFLICT_DETECTED',
                field,
                oldValue: oldS,
                newValue: newS,
                origin: 'SYNC',
                syncRunId,
                note: 'Valor protegido por alteração manual; fonte diverge',
              });
              stats.conflicts += 1;
            }
            continue;
          }

          (patch as Record<string, unknown>)[field] = newV;
          changed = true;
          if (field === 'status') {
            stats.statusChanges += 1;
            events.push({ invoiceId: existing.id, type: 'STATUS_CHANGED', field, oldValue: oldS, newValue: newS, origin: 'SYNC', syncRunId });
            if (existing.status === 'PAID' && incoming.status === 'PENDING') {
              patch.needsReconciliation = true;
              patch.reconciliationNote = 'Fonte voltou a indicar a nota como pendente após constar como paga';
            }
            if (incoming.status === 'PAID') {
              patch.paidAmount = existing.paidAmount ?? incoming.amount;
              patch.needsReconciliation = false;
              patch.reconciliationNote = null;
            }
          } else {
            events.push({ invoiceId: existing.id, type: 'FIELD_CHANGED', field, oldValue: oldS, newValue: newS, origin: 'SYNC', syncRunId });
          }
        }

        if (!existing.description && incoming.description) {
          patch.description = incoming.description;
          changed = true;
        }
        if (existing.missingSince) {
          patch.missingSince = null;
          if (existing.reconciliationNote?.startsWith('Nota deixou de aparecer')) {
            patch.needsReconciliation = false;
            patch.reconciliationNote = null;
          }
          events.push({ invoiceId: existing.id, type: 'REAPPEARED', origin: 'SYNC', syncRunId, note: 'Nota voltou a constar na fonte' });
          stats.reappeared += 1;
          changed = true;
        }

        await tx.invoice.update({ where: { id: existing.id }, data: patch });
        if (events.length) await tx.invoiceEvent.createMany({ data: events });
        if (changed) stats.invoicesUpdated += 1;
      }

      // ---- notas ausentes na fonte ----
      // Proteção contra "sumiço em massa": se o snapshot veio vazio enquanto já
      // conhecemos notas dessa entidade, ou se há avisos típicos de erro do
      // portal (SQLSTATE, tela de login), o snapshot é suspeito e NÃO marcamos
      // nada como ausente — a execução fica como PARCIAL via warning.
      const suspiciousWarning = stats.warnings.find((w) => /SQLSTATE|login/i.test(w));
      let suspicious = Boolean(suspiciousWarning);
      if (!suspicious && snapshot.invoices.length === 0) {
        const known = await tx.invoice.count({ where: { entityId, origin: 'SYNC', deletedAt: null } });
        suspicious = known > 0;
      }
      if (suspicious) {
        stats.missingDetectionSkipped = true;
        stats.warnings.push(
          suspiciousWarning
            ? 'Snapshot suspeito (aviso de erro/login do portal): detecção de notas ausentes ignorada'
            : 'Snapshot sem notas enquanto há notas sincronizadas no sistema: detecção de notas ausentes ignorada',
        );
      }
      const candidates = suspicious ? [] : await tx.invoice.findMany({
        where: {
          entityId,
          origin: 'SYNC',
          deletedAt: null,
          missingSince: null,
          status: { not: 'CANCELLED' },
          number: { notIn: [...seenNumbers] },
          ...(snapshot.invoiceListComplete ? {} : { status: 'PENDING' }),
        },
      });
      for (const inv of candidates) {
        const note = snapshot.invoiceListComplete
          ? 'Nota deixou de aparecer na listagem completa da fonte — verificar (não presumida como paga)'
          : 'Nota deixou de aparecer entre as pendentes; listagem completa indisponível — verificar quitação';
        await tx.invoice.update({
          where: { id: inv.id },
          data: { missingSince: now, needsReconciliation: true, reconciliationNote: note },
        });
        await tx.invoiceEvent.create({
          data: { invoiceId: inv.id, type: 'MISSING_FROM_SOURCE', origin: 'SYNC', syncRunId, note },
        });
        stats.missing += 1;
      }

      // ---- certidões ----
      const certs = await syncCertificates(tx, snapshot.certificates);
      stats.certificatesNewVersions = certs.newVersions;
      stats.certificateVersionIdsToFetch = certs.versionIdsToFetch;

      // ---- conferência com o resumo do portal ----
      const localDebt = await tx.invoice.aggregate({
        where: { entityId, status: 'PENDING', deletedAt: null },
        _sum: { amount: true },
      });
      const local = (localDebt._sum.amount ?? new Prisma.Decimal(0)).toFixed(2);
      if (snapshot.summary.totalDebt !== null && toDecimalString(snapshot.summary.totalDebt) !== local) {
        stats.summaryMismatch = { localDebt: local, portalDebt: toDecimalString(snapshot.summary.totalDebt) };
        stats.warnings.push(`Total de débitos calculado (${local}) difere do card do portal (${toDecimalString(snapshot.summary.totalDebt)})`);
      }
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  return stats;
}

/** Duas notas com o mesmo número no mesmo snapshot: mantém a mais "avançada" (PAID > PENDING). */
function dedupeInvoices(invoices: InvoiceSnapshot[], warnings: string[]): InvoiceSnapshot[] {
  const map = new Map<string, InvoiceSnapshot>();
  const rank = { PAID: 3, CANCELLED: 2, PENDING: 1, UNKNOWN: 0 } as const;
  for (const inv of invoices) {
    const prev = map.get(inv.number);
    if (!prev) {
      map.set(inv.number, inv);
      continue;
    }
    warnings.push(`Nota ${inv.number} apareceu mais de uma vez no snapshot`);
    if (rank[inv.status] > rank[prev.status]) map.set(inv.number, inv);
  }
  return [...map.values()];
}
