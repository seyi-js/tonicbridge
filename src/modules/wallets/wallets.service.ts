import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../../database/database.service';
import { DomainError } from '../../common/errors/domain.error';
import { currencies } from '../../common/money';
import { createWalletSchema } from './dto/create-wallet.dto';
import { WalletRow, BalanceRow, walletView } from './wallets.types';
@Injectable()
export class WalletsService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async create(input: unknown) {
    const data = createWalletSchema.parse(input);
    try {
      return await this.db.transaction(async (client) => {
        const result = await client.query<WalletRow>(
          'INSERT INTO wallets(email, phone) VALUES ($1,$2) RETURNING *',
          [data.email ?? null, data.phone ?? null],
        );
        const wallet = result.rows[0]!;
        await client.query(
          'INSERT INTO balances(wallet_id,currency) SELECT $1, unnest($2::text[])',
          [wallet.id, currencies],
        );
        return walletView(wallet);
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new DomainError(
          409,
          'DUPLICATE_IDENTITY',
          'A wallet already exists for that email or phone.',
        );
      throw error;
    }
  }

  async get(id: string) {
    const result = await this.db.query<WalletRow>('SELECT * FROM wallets WHERE id=$1', [id]);
    if (!result.rows[0]) throw new DomainError(404, 'WALLET_NOT_FOUND', 'Wallet not found.');
    return walletView(result.rows[0]);
  }

  async balances(id: string): Promise<BalanceRow[]> {
    await this.get(id);
    const result = await this.db.query<BalanceRow>(
      'SELECT currency, amount FROM balances WHERE wallet_id=$1 ORDER BY currency',
      [id],
    );
    return result.rows;
  }
}
