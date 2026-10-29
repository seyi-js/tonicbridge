import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Database } from './database';
import { DomainError } from './errors';
import { currencies, Currency, uuidSchema } from './money';

const createSchema = z
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

export interface WalletRow {
  id: string;

  email: string | null;

  phone: string | null;

  created_at: Date;
}
export interface BalanceRow {
  currency: Currency;

  amount: string;
}
export const walletView = (row: WalletRow) => ({
  id: row.id,
  email: row.email,
  phone: row.phone,
  createdAt: row.created_at.toISOString(),
});

@Injectable()
export class WalletsService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async create(input: unknown) {
    const data = createSchema.parse(input);
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

@Controller('wallets')
export class WalletsController {
  constructor(@Inject(WalletsService) private readonly wallets: WalletsService) {}

  @Post()
  create(@Body() body: unknown) {
    return this.wallets.create(body);
  }

  @Get(':walletId')
  get(@Param('walletId') id: string) {
    return this.wallets.get(uuidSchema.parse(id));
  }
}
