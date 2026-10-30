import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../../database/database.service';
import { DomainError } from '../../common/errors/domain.error';
import { TransactionRow, transactionView } from './transactions.types';
import { historySchema } from './dto/history-query.dto';
@Injectable()
export class HistoryService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async get(id: string) {
    const result = await this.db.query<TransactionRow>('SELECT * FROM transactions WHERE id=$1', [
      id,
    ]);
    if (!result.rows[0])
      throw new DomainError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found.');
    return transactionView(result.rows[0]);
  }

  async list(walletId: string, query: unknown) {
    const { type, currency, limit, offset } = historySchema.parse(query);
    return this.db.transaction(async (client) => {
      // Count and page see the same committed snapshot, even during concurrent writes.
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const wallet = await client.query('SELECT id FROM wallets WHERE id=$1', [walletId]);
      if (!wallet.rowCount) throw new DomainError(404, 'WALLET_NOT_FOUND', 'Wallet not found.');
      const filter = `(source_wallet_id=$1 OR destination_wallet_id=$1)
        AND ($2::text IS NULL OR type=$2)
        AND ($3::text IS NULL OR source_currency=$3 OR destination_currency=$3)`;
      const params = [walletId, type ?? null, currency ?? null];
      const count = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM transactions WHERE ${filter}`,
        params,
      );
      const page = await client.query<TransactionRow>(
        `SELECT * FROM transactions WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,
        [...params, limit, offset],
      );
      return {
        items: page.rows.map(transactionView),
        total: Number(count.rows[0]!.total),
        limit,
        offset,
      };
    });
  }
}
