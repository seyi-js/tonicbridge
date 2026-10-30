import Decimal from 'decimal.js';
import { z } from 'zod';
import { DomainError } from './errors/domain.error';

export const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_DOWN });

export const currencies = ['cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx'] as const;

export const currencySchema = z.enum(currencies);

export type Currency = z.infer<typeof currencySchema>;

export const MAX_AMOUNT = new D('999999999999999999.999999');

export const uuidSchema = z
  .string()
  .uuid()
  .transform((v) => v.toLowerCase());

export const amountSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/)
  .pipe(z.string().refine((v) => new D(v).gt(0), 'Amount must be greater than zero.'))
  .transform((v) => new D(v).toFixed(6));

export function money(value: Decimal.Value): string {
  return new D(value).toFixed(6, Decimal.ROUND_DOWN);
}

export function converted(amount: string, rate: string): string {
  const value = new D(amount).times(rate).toDecimalPlaces(6, Decimal.ROUND_DOWN);

  if (value.lte(0)) {
    throw new DomainError(422, 'AMOUNT_TOO_SMALL', 'Conversion rounds to zero.');
  }

  if (value.gt(MAX_AMOUNT)) {
    throw new DomainError(422, 'BALANCE_LIMIT', 'Amount exceeds the supported limit.');
  }

  return money(value);
}
