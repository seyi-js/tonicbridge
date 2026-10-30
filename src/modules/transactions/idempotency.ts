import { z } from 'zod';

export const keySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_.:-]{8,128}$/,
    'Idempotency-Key must contain 8–128 letters, digits, dots, colons, underscores or hyphens.',
  );
