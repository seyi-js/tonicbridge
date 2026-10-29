import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { APP_CONFIG, AppConfig } from './config';

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(83716209)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    for (const name of (await readdir(join(process.cwd(), 'migrations')))
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      const applied = await client.query('SELECT name FROM schema_migrations WHERE name=$1', [
        name,
      ]);
      if (!applied.rowCount) {
        await client.query(await readFile(join(process.cwd(), 'migrations', name), 'utf8'));
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 12,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      statement_timeout: 10000,
    });
    this.pool.on('error', () => {
      /* Individual requests/readiness report connection failures safely. */
    });
  }

  async onModuleInit(): Promise<void> {
    await migrate(this.pool);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
    return this.pool.query<T>(sql, values);
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
