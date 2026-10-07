import { Prisma, type PrismaClient } from '@siow/db';
import type { ContractSnapshot } from '@siow/integrations';
import { isoToDate } from '@siow/shared';

type Tx = Prisma.TransactionClient | PrismaClient;

export interface ContractSyncResult {
  byExternalCode: Map<string, string>; // externalCode → contract.id
  byNumber: Map<string, string>;
  created: number;
  updated: number;
  amendmentsCreated: number;
  warnings: string[];
}

/**
 * Sincroniza contratos vindos do cabeçalho do portal.
 * Regras:
 *  - chave: (entityId, number). Contrato cadastrado manualmente NÃO tem
 *    número/objeto sobrescritos; apenas campos vazios são preenchidos.
 *  - vigência: atualizada quando o contrato tem origem SYNC; quando manual,
 *    a divergência vira aviso (o usuário decide).
 *  - aditivo: "Nº ADT" observado gera ContractAmendment(sequence) se ainda não existir.
 */
export async function syncContracts(
  tx: Tx,
  entityId: string,
  contracts: ContractSnapshot[],
): Promise<ContractSyncResult> {
  const result: ContractSyncResult = {
    byExternalCode: new Map(),
    byNumber: new Map(),
    created: 0,
    updated: 0,
    amendmentsCreated: 0,
    warnings: [],
  };

  for (const c of contracts) {
    if (!c.number) {
      result.warnings.push(`Cabeçalho de contrato sem número: "${c.rawHeader}"`);
      continue;
    }
    const start = c.startDate ? isoToDate(c.startDate) : null;
    const end = c.endDate ? isoToDate(c.endDate) : null;

    let existing = await tx.contract.findFirst({
      where: { entityId, deletedAt: null, OR: [{ number: c.number }, ...(c.externalCode ? [{ externalCode: c.externalCode }] : [])] },
    });

    if (!existing) {
      existing = await tx.contract.create({
        data: {
          entityId,
          number: c.number,
          externalCode: c.externalCode,
          startDate: start,
          endDate: end,
          status: end && end.getTime() < Date.now() ? 'EXPIRED' : 'ACTIVE',
          origin: 'SYNC',
          description: c.rawHeader,
        },
      });
      result.created += 1;
    } else {
      const data: Prisma.ContractUpdateInput = {};
      if (!existing.externalCode && c.externalCode) data.externalCode = c.externalCode;
      if (!existing.startDate && start) data.startDate = start;
      if (existing.origin === 'SYNC') {
        // Vigência: nunca deixa um cabeçalho mais antigo (ex.: aditivo anterior)
        // reduzir a data de fim já conhecida — mantém a maior data vista.
        if (end && (!existing.endDate || existing.endDate.getTime() < end.getTime())) data.endDate = end;
        if (start && (!existing.startDate || existing.startDate.getTime() !== start.getTime())) data.startDate = start;
        // Descrição (cabeçalho bruto): só o aditivo de maior sequência prevalece.
        const maxAmendment = await tx.contractAmendment.aggregate({ where: { contractId: existing.id }, _max: { sequence: true } });
        const highestSeq = maxAmendment._max.sequence ?? 0;
        if (existing.description !== c.rawHeader && (c.amendmentSequence ?? 0) >= highestSeq) data.description = c.rawHeader;
        // Status ACTIVE/EXPIRED recalculado a partir da vigência efetiva (mesma regra da criação).
        const effectiveEnd = (data.endDate as Date | undefined) ?? existing.endDate;
        if (existing.status === 'ACTIVE' || existing.status === 'EXPIRED') {
          const nextStatus = effectiveEnd && effectiveEnd.getTime() < Date.now() ? 'EXPIRED' : 'ACTIVE';
          if (nextStatus !== existing.status) data.status = nextStatus;
        }
      } else if (end && existing.endDate && existing.endDate.getTime() !== end.getTime()) {
        result.warnings.push(
          `Contrato ${c.number}: vigência no portal (${c.endDate}) difere do cadastro manual (${existing.endDate.toISOString().slice(0, 10)})`,
        );
      } else if (!existing.endDate && end) {
        data.endDate = end;
      }
      if (Object.keys(data).length > 0) {
        existing = await tx.contract.update({ where: { id: existing.id }, data });
        result.updated += 1;
      }
    }

    if (c.amendmentSequence) {
      const found = await tx.contractAmendment.findUnique({
        where: { contractId_sequence: { contractId: existing.id, sequence: c.amendmentSequence } },
      });
      if (!found) {
        await tx.contractAmendment.create({
          data: {
            contractId: existing.id,
            sequence: c.amendmentSequence,
            label: c.amendmentLabel,
            kind: 'TERM',
            newEndDate: end,
            origin: 'SYNC',
            description: `Identificado automaticamente no portal (${c.rawHeader})`,
          },
        });
        result.amendmentsCreated += 1;
      }
    }

    if (c.externalCode) result.byExternalCode.set(c.externalCode, existing.id);
    result.byNumber.set(c.number, existing.id);
  }

  return result;
}

/**
 * Escolhe o contrato de uma nota: código externo → vigência cobrindo a
 * competência → único contrato ativo da entidade → null.
 */
export async function resolveContractForInvoice(
  tx: Tx,
  entityId: string,
  contractExternalCode: string | null,
  competenceMonth: number,
  competenceYear: number,
  lookup: ContractSyncResult,
): Promise<string | null> {
  if (contractExternalCode) {
    const id = lookup.byExternalCode.get(contractExternalCode);
    if (id) return id;
    const c = await tx.contract.findFirst({ where: { entityId, externalCode: contractExternalCode, deletedAt: null } });
    if (c) return c.id;
  }
  const compDate = new Date(Date.UTC(competenceYear, competenceMonth - 1, 15));
  const covering = await tx.contract.findFirst({
    where: {
      entityId,
      deletedAt: null,
      startDate: { lte: compDate },
      OR: [{ endDate: null }, { endDate: { gte: compDate } }],
    },
    orderBy: { startDate: 'desc' },
  });
  if (covering) return covering.id;
  const actives = await tx.contract.findMany({ where: { entityId, deletedAt: null, status: 'ACTIVE' }, take: 2 });
  return actives.length === 1 ? actives[0]!.id : null;
}
