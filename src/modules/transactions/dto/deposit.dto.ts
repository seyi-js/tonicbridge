import { z } from 'zod';
import { amountSchema, currencySchema } from '../../../common/money';
export const depositSchema = z.object({ currency: currencySchema, amount: amountSchema }).strict();
export type DepositDto = z.infer<typeof depositSchema>;
