const MAX_PRICE_CENTS = 2_147_483_647;

export function parseMxnCents(input: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const pesos = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(pesos) || pesos > Math.floor(MAX_PRICE_CENTS / 100)) return null;
  const result = pesos * 100 + cents;
  return result <= MAX_PRICE_CENTS ? result : null;
}

export function formatMxnCents(cents: number): string {
  const pesos = Math.floor(cents / 100).toLocaleString('es-MX');
  return `$${pesos}.${String(cents % 100).padStart(2, '0')}`;
}
