/**
 * Datas de negócio (competência, emissão, pagamento, validade) são tratadas
 * como "datas civis" (YYYY-MM-DD) — sem fuso — para evitar deslocamentos.
 */

const MONTHS_PT: Record<string, number> = {
  JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6,
  JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12,
};

export const MONTH_NAMES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
] as const;

export const MONTH_ABBR_PT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'] as const;

export interface Competence {
  month: number; // 1..12
  year: number;
}

/** "SET/2026", "09/2026", "9/2026" → { month: 9, year: 2026 } */
export function parseCompetence(input: string | null | undefined): Competence | null {
  if (!input) return null;
  const s = input.trim().toUpperCase();
  const m = /^([A-ZÇ]{3}|\d{1,2})\s*\/\s*(\d{4})$/.exec(s);
  if (!m) return null;
  const [, mon, year] = m;
  const month = /^\d+$/.test(mon!) ? Number(mon) : MONTHS_PT[mon!.replace('Ç', 'C')];
  if (!month || month < 1 || month > 12) return null;
  return { month, year: Number(year) };
}

export function formatCompetence(c: Competence | { competenceMonth: number; competenceYear: number }): string {
  const month = 'month' in c ? c.month : c.competenceMonth;
  const year = 'year' in c ? c.year : c.competenceYear;
  return `${String(month).padStart(2, '0')}/${year}`;
}

export function competenceKey(month: number, year: number): number {
  return year * 100 + month;
}

/** "22/09/2026" → "2026-09-22" (ISO civil). Retorna null se inválida. */
export function parseBrDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(input);
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo}-${d}`;
  return isValidIsoDate(iso) ? iso : null;
}

export function isValidIsoDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** ISO civil "2026-09-22" → Date em UTC meia-noite (compatível com @db.Date). */
export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function dateToIso(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Diferença em dias inteiros entre duas datas civis (b - a). */
export function daysBetween(aIso: string, bIso: string): number {
  const a = isoToDate(aIso).getTime();
  const b = isoToDate(bIso).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function formatBrDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const iso = typeof value === 'string' ? value.slice(0, 10) : dateToIso(value);
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatBrDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Adiciona dias a uma data civil. */
export function addDaysIso(iso: string, days: number): string {
  const d = isoToDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lista competências (mês/ano) entre duas datas civis, inclusive. */
export function competencesBetween(startIso: string, endIso: string): Competence[] {
  const out: Competence[] = [];
  const start = isoToDate(startIso);
  const end = isoToDate(endIso);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth() + 1)) {
    out.push({ month: m, year: y });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
