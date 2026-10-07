/**
 * Utilidades monetárias. Valores trafegam como string decimal ("750.00")
 * entre API e frontend para evitar perda de precisão com float.
 */

/** Converte "R$ 1.320,00", "1.320,00", "1320,00" ou "1320.00" em número (reais). */
export function parseBRL(input: string | null | undefined): number | null {
  if (!input) return null;
  let s = input.replace(/[^\d,.-]/g, '').trim();
  if (!s) return null;
  const negative = s.startsWith('-');
  s = s.replace('-', '');
  // Se tem vírgula, assumimos formato brasileiro: "." milhar e "," decimal
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    // "1.320.000" sem vírgula: pontos são milhar
    s = s.replace(/\./g, '');
  } else if (/^\d{1,3}\.\d{3}$/.test(s)) {
    // "1.320" sem vírgula: ponto único seguido de exatamente 3 dígitos é milhar (pt-BR)
    s = s.replace('.', '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Formata número/string decimal em "R$ 1.320,00". */
export function formatBRL(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Normaliza para string decimal com 2 casas ("750.00"), formato aceito pelo Prisma.Decimal. */
export function toDecimalString(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function sumDecimalStrings(values: Array<string | number | null | undefined>): number {
  let total = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const n = typeof v === 'string' ? Number(v) : v;
    if (Number.isFinite(n)) total += n;
  }
  return Math.round(total * 100) / 100;
}
