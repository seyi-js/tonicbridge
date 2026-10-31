import { PostgreSqlContainer } from '@testcontainers/postgresql';

export default async function setup() {
  process.env.FX_MODE = 'fixed';
  process.env.LOG_LEVEL = 'silent';

  if (process.env.TEST_DATABASE_URL) {
    if (!new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')) {
      throw new Error('TEST_DATABASE_URL must identify a dedicated database ending in _test.');
    }

    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

    return;
  }

  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('tonicbridge_test')
    .start();

  process.env.DATABASE_URL = container.getConnectionUri();

  return async () => {
    await container.stop();
  };
}
