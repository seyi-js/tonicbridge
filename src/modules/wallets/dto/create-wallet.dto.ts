import { z } from 'zod';
export const createWalletSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9]{7,14}$/)
      .optional(),
  })
  .strict()
  .refine((v) => v.email || v.phone, 'An email or E.164 phone number is required.');

export type CreateWalletDto = z.infer<typeof createWalletSchema>;
