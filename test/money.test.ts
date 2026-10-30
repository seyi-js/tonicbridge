import { describe, expect, it } from 'vitest';
import { amountSchema, converted } from '../src/common/money';

describe('decimal money', () => {
  it('keeps large values exact and rounds conversion down', () => {
    expect(amountSchema.parse('9007199254740993.123456')).toBe('9007199254740993.123456');
    expect(converted('0.100000', '3.333333333333')).toBe('0.333333');
    expect(converted('1600.000000', '0.000625000000')).toBe('1.000000');
  });
  it('rejects malformed, numeric, nonpositive, excessive-scale and oversized inputs', () => {
    for (const value of [
      1,
      '-1',
      '0',
      '01',
      '1e3',
      'NaN',
      '1.0000001',
      '1000000000000000000',
      ' 1',
    ])
      expect(amountSchema.safeParse(value).success).toBe(false);
    expect(() => converted('0.000001', '0.000625000000')).toThrow('rounds to zero');
    expect(() => converted('999999999999999999.999999', '2')).toThrow('limit');
  });
});
