import { describe, expect, it } from 'vitest';
import { formatMxnCents, parseMxnCents } from './money';

describe('MXN en centavos enteros', () => {
  it('acepta pesos y hasta dos decimales', () => {
    expect(['31', '31.5', '31.50', '31,50', '0'].map(parseMxnCents)).toEqual([3100, 3150, 3150, 3150, 0]);
  });

  it('rechaza entradas inválidas y valores fuera de rango', () => {
    for (const input of ['-5', 'abc', '12.999', 'NaN', '1,234.50', '', '21474836.48']) {
      expect(parseMxnCents(input)).toBeNull();
    }
  });

  it('formatea sin aritmética de punto flotante', () => {
    expect(formatMxnCents(3150)).toBe('$31.50');
    expect(formatMxnCents(0)).toBe('$0.00');
  });
});
