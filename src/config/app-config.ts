import { z } from 'zod';

export const APP_CONFIG = Symbol('APP_CONFIG');

const schema = z.object({
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://tonic:tonic_local@localhost:55432/tonicbridge'),
  FX_MODE: z.enum(['live', 'fixed']).default('live'),
  FX_BASE_URL: z
    .string()
    .url()
    .default('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest'),
  FX_TIMEOUT_MS: z.coerce.number().int().min(50).max(10000).default(2500),
  FX_CACHE_SECONDS: z.coerce.number().int().min(1).max(86400).default(3600),
});

export type AppConfig = z.infer<typeof schema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    throw new Error('Invalid configuration; check .env.example.');
  }

  return parsed.data;
}
