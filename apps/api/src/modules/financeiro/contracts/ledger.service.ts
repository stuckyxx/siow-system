import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@siow/db';
import { competencesBetween, dateToIso, todayIso, toDecimalString, type ContractLedger, type ContractLedgerMonth } from '@siow/shared';
import { PrismaService } from '../../../common/prisma/prisma.service.js';

/**
 * Conta corrente do contrato (spec §23): mês a mês, quanto deveria ter sido
 * faturado (valor mensal vigente, considerando aditivos de valor), quanto foi
 * faturado, pago e pendente. Distingue "não houve nota" de "nota não paga".
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async build(contractId: string): Promise<ContractLedger> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      include: { amendments: { orderBy: { sequence: 'asc' } }, invoices: { where: { deletedAt: null } } },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');

    const today = todayIso();
    const start = dateToIso(contract.startDate);
    const endRaw = dateToIso(contract.endDate);
    // Encerra a janela hoje quando o contrato ainda está vigente/sem fim informado
    const end = endRaw && endRaw < today ? endRaw : today;

    const months: ContractLedgerMonth[] = [];
    const totals = { expected: 0, invoiced: 0, paid: 0, pending: 0, monthsNotInvoiced: 0, monthsPending: 0 };

    if (start) {
      const byComp = new Map<string, typeof contract.invoices>();
      for (const inv of contract.invoices) {
        const key = `${inv.competenceYear}-${String(inv.competenceMonth).padStart(2, '0')}`;
        byComp.set(key, [...(byComp.get(key) ?? []), inv]);
      }
      const currentComp = today.slice(0, 7);
      for (const c of competencesBetween(start, end)) {
        const key = `${c.year}-${String(c.month).padStart(2, '0')}`;
        const expected = contract.expectsMonthlyBilling ? this.monthlyValueAt(contract, key) : 0;
        const invs = byComp.get(key) ?? [];
        const invoiced = invs.filter((i) => i.status !== 'CANCELLED').reduce((s, i) => s + Number(i.amount), 0);
        const paid = invs.filter((i) => i.status === 'PAID').reduce((s, i) => s + Number(i.paidAmount ?? i.amount), 0);
        const pending = invs.filter((i) => i.status === 'PENDING').reduce((s, i) => s + Number(i.amount), 0);
        let state: ContractLedgerMonth['state'];
        if (invs.length === 0) state = key >= currentComp ? 'FUTURE' : 'NOT_INVOICED';
        else if (pending > 0 && paid > 0) state = 'PARTIAL';
        else if (pending > 0) state = 'PENDING';
        else state = 'PAID';
        if (state === 'NOT_INVOICED' && expected > 0) totals.monthsNotInvoiced += 1;
        if (state === 'PENDING' || state === 'PARTIAL') totals.monthsPending += 1;
        totals.expected += state === 'FUTURE' ? 0 : expected;
        totals.invoiced += invoiced;
        totals.paid += paid;
        totals.pending += pending;
        months.push({ competence: key, expected: toDecimalString(expected), invoiced: toDecimalString(invoiced), paid: toDecimalString(paid), pending: toDecimalString(pending), invoiceCount: invs.length, state });
      }
    }

    // notas fora da vigência (ex.: competências anteriores ao início) entram nos totais
    const lastPaid = contract.invoices.filter((i) => i.status === 'PAID' && i.paidAt).sort((a, b) => b.paidAt!.getTime() - a.paidAt!.getTime())[0];

    return {
      contractId: contract.id,
      contractNumber: contract.number,
      status: contract.status,
      monthlyValue: contract.monthlyValue ? contract.monthlyValue.toFixed(2) : null,
      startDate: start,
      endDate: endRaw,
      totals: {
        expected: toDecimalString(totals.expected),
        invoiced: toDecimalString(totals.invoiced),
        paid: toDecimalString(totals.paid),
        pending: toDecimalString(totals.pending),
        monthsNotInvoiced: totals.monthsNotInvoiced,
        monthsPending: totals.monthsPending,
        lastPaymentAt: lastPaid ? dateToIso(lastPaid.paidAt) : null,
        lastPaymentAmount: lastPaid ? (lastPaid.paidAmount ?? lastPaid.amount).toFixed(2) : null,
      },
      months: months.reverse(),
    };
  }

  /** Valor mensal vigente numa competência: último aditivo de valor com effectiveFrom <= competência, senão o do contrato. */
  private monthlyValueAt(
    contract: { monthlyValue: Prisma.Decimal | null; amendments: Array<{ newMonthlyValue: Prisma.Decimal | null; effectiveFrom: Date | null; signedAt: Date | null }> },
    competence: string,
  ): number {
    let value = contract.monthlyValue ? Number(contract.monthlyValue) : 0;
    for (const a of contract.amendments) {
      if (!a.newMonthlyValue) continue;
      const from = dateToIso(a.effectiveFrom ?? a.signedAt);
      if (!from || from.slice(0, 7) <= competence) value = Number(a.newMonthlyValue);
    }
    return value;
  }
}
