import { z } from 'zod';
import { currencySchema } from '../../../common/money';
const integerQuery = (minimum: number, maximum: number) =>
  z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));
export const historySchema = z
  .object({
    type: z.enum(['deposit', 'swap', 'transfer']).optional(),
    currency: currencySchema.optional(),
    limit: integerQuery(1, 100).default('20'),
    offset: integerQuery(0, 2147483647).default('0'),
  })
  .strict();

export type HistoryQueryDto = z.infer<typeof historySchema>;
