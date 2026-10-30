import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

@Injectable()
export class MigrationsService implements OnModuleInit {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async onModuleInit(): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      await this.sequelize.query('SELECT pg_advisory_xact_lock(83716209)', { transaction });

      await this.sequelize.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
        { transaction },
      );

      const applied = await this.sequelize.query<{ name: string }>(
        'SELECT name FROM schema_migrations',
        { type: QueryTypes.SELECT, transaction },
      );

      const appliedNames = new Set(applied.map((row) => row.name));

      for (const name of (await readdir(join(process.cwd(), 'migrations')))
        .filter((name) => name.endsWith('.sql'))
        .sort()) {
        if (appliedNames.has(name)) {
          continue;
        }

        await this.sequelize.query(
          await readFile(join(process.cwd(), 'migrations', name), 'utf8'),
          { transaction },
        );

        await this.sequelize.query('INSERT INTO schema_migrations(name) VALUES ($1)', {
          bind: [name],
          transaction,
        });
      }
    });
  }
}
