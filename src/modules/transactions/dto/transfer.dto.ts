import { z } from 'zod';
import { amountSchema, currencySchema, uuidSchema } from '../../../common/money';

export const transferSchema = z
  .object({
    recipientWalletId: uuidSchema,
    fromCurrency: currencySchema,
    toCurrency: currencySchema,
    amount: amountSchema,
  })
  .strict();

export type TransferDto = z.infer<typeof transferSchema>;
