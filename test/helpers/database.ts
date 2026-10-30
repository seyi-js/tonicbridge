import { INestApplication } from '@nestjs/common';
import { QueryResultRow } from 'pg';
import { Sequelize } from 'sequelize-typescript';

export function database(app: INestApplication) {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(sql: string, bind: unknown[] = []) {
      const [rows, metadata] = await app.get(Sequelize).query(sql, bind.length ? { bind } : {});
      return { rows: rows as T[], rowCount: (metadata as { rowCount: number }).rowCount };
    },
  };
}
