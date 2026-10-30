import { z } from 'zod';
import { amountSchema, currencySchema } from '../../../common/money';
export const swapSchema = z
  .object({ fromCurrency: currencySchema, toCurrency: currencySchema, amount: amountSchema })
  .strict()
  .refine((input) => input.fromCurrency !== input.toCurrency, {
    message: 'Swap currencies must be different.',
    path: ['toCurrency'],
  });
export type SwapDto = z.infer<typeof swapSchema>;
