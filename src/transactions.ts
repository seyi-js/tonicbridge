import { Body, Controller, Headers, Inject, Injectable, Param, Post, Res } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Response } from 'express';
import { z } from 'zod';
import { Database } from './database';
import { DomainError } from './errors';
import { FxService } from './fx';
import {
  amountSchema,
  converted,
  currencies,
  Currency,
  currencySchema,
  D,
  MAX_AMOUNT,
  money,
  uuidSchema,
} from './money';

const depositSchema = z.object({ currency: currencySchema, amount: amountSchema }).strict();
const transferSchema = z
  .object({
    recipientWalletId: uuidSchema,
    fromCurrency: currencySchema,
    toCurrency: currencySchema,
    amount: amountSchema,
  })
  .strict();
const swapSchema = z
  .object({ fromCurrency: currencySchema, toCurrency: currencySchema, amount: amountSchema })
  .strict()
  .refine((input) => input.fromCurrency !== input.toCurrency, {
    message: 'Swap currencies must be different.',
    path: ['toCurrency'],
  });
const keySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_.:-]{8,128}$/,
    'Idempotency-Key must contain 8–128 letters, digits, dots, colons, underscores or hyphens.',
  );

export interface TransactionRow {
  id: string;

  type: 'deposit' | 'swap' | 'transfer';

  source_wallet_id: string | null;

  destination_wallet_id: string;

  source_currency: Currency;

  destination_currency: Currency;

  source_amount: string;

  destination_amount: string;

  rate: string;

  rate_source: 'live' | 'fixed' | null;

  rate_updated_at: Date | null;

  created_at: Date;
}
interface Movement {
  type: TransactionRow['type'];

  walletId: string;

  recipientId: string;

  from: Currency;

  to: Currency;

  amount: string;
}
interface RateQuote {
  rate: string;

  source: 'live' | 'fixed' | null;

  updatedAt: string | null;
}
const identityQuote: RateQuote = { rate: '1.000000000000', source: null, updatedAt: null };
export function transactionView(row: TransactionRow) {
  return {
    id: row.id,
    type: row.type,
    sourceWalletId: row.source_wallet_id,
    destinationWalletId: row.destination_wallet_id,
    sourceCurrency: row.source_currency,
    destinationCurrency: row.destination_currency,
    sourceAmount: row.source_amount,
    destinationAmount: row.destination_amount,
    rate: row.rate,
    rateSource: row.rate_source,
    rateUpdatedAt: row.rate_updated_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  async deposit(walletId: string, body: unknown, rawKey: unknown) {
    const input = depositSchema.parse(body);
    return this.move(
      {
        type: 'deposit',
        walletId,
        recipientId: walletId,
        from: input.currency,
        to: input.currency,
        amount: input.amount,
      },
      rawKey,
    );
  }

  async swap(walletId: string, body: unknown, rawKey: unknown) {
    const input = swapSchema.parse(body);
    return this.move(
      {
        type: 'swap',
        walletId,
        recipientId: walletId,
        from: input.fromCurrency,
        to: input.toCurrency,
        amount: input.amount,
      },
      rawKey,
      () => this.quote(input.fromCurrency, input.toCurrency),
    );
  }

  private async quote(from: Currency, to: Currency): Promise<RateQuote> {
    if (from === to) return identityQuote;
    const snapshot = await this.fx.snapshot();
    return {
      rate: this.fx.rate(snapshot, from, to),
      source: snapshot.source,
      updatedAt: snapshot.updatedAt,
    };
  }

  async transfer(walletId: string, body: unknown, rawKey: unknown) {
    const input = transferSchema.parse(body);
    if (input.recipientWalletId === walletId)
      throw new DomainError(400, 'SAME_WALLET', 'Recipient must be a different wallet.');
    return this.move(
      {
        type: 'transfer',
        walletId,
        recipientId: input.recipientWalletId,
        from: input.fromCurrency,
        to: input.toCurrency,
        amount: input.amount,
      },
      rawKey,
      () => this.quote(input.fromCurrency, input.toCurrency),
    );
  }

  private async move(
    input: Movement,
    rawKey: unknown,
    quoteProvider: () => Promise<RateQuote> = async () => identityQuote,
  ) {
    const key = keySchema.parse(rawKey);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          input.type,
          input.walletId,
          input.recipientId,
          input.from,
          input.to,
          input.amount,
        ]),
      )
      .digest('hex');
    const replay = async (stored: { fingerprint: string; transaction_id: string }) => {
      if (stored.fingerprint !== fingerprint)
        throw new DomainError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This key was already used for a different request.',
        );
      const result = await this.db.query<TransactionRow>('SELECT * FROM transactions WHERE id=$1', [
        stored.transaction_id,
      ]);
      return { transaction: transactionView(result.rows[0]!), replayed: true };
    };
    const prior = await this.db.query<{ fingerprint: string; transaction_id: string }>(
      'SELECT fingerprint,transaction_id FROM idempotency_requests WHERE wallet_id=$1 AND key=$2',
      [input.walletId, key],
    );
    if (prior.rows[0]) return replay(prior.rows[0]);
    // FX I/O happens before locks. Replay is checked again inside the atomic operation.
    const quote = await quoteProvider();
    return this.db.transaction(async (client) => {
      const ids = [...new Set([input.walletId, input.recipientId])].sort();
      // NO KEY UPDATE is compatible with FK KEY SHARE locks; wallet identity never changes here.
      const locked = await client.query(
        'SELECT id FROM wallets WHERE id=ANY($1::uuid[]) ORDER BY id FOR NO KEY UPDATE',
        [ids],
      );
      if (locked.rowCount !== ids.length)
        throw new DomainError(404, 'WALLET_NOT_FOUND', 'Source or recipient wallet not found.');
      const previous = await client.query<{ fingerprint: string; transaction_id: string }>(
        'SELECT fingerprint,transaction_id FROM idempotency_requests WHERE wallet_id=$1 AND key=$2',
        [input.walletId, key],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].fingerprint !== fingerprint)
          throw new DomainError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This key was already used for a different request.',
          );
        const result = await client.query<TransactionRow>(
          'SELECT * FROM transactions WHERE id=$1',
          [previous.rows[0].transaction_id],
        );
        return { transaction: transactionView(result.rows[0]!), replayed: true };
      }
      const destinationAmount = converted(input.amount, quote.rate);
      const balances = await client.query<{
        wallet_id: string;
        currency: Currency;
        amount: string;
      }>('SELECT wallet_id,currency,amount FROM balances WHERE wallet_id=ANY($1::uuid[])', [ids]);
      if (balances.rowCount !== ids.length * currencies.length)
        throw new Error('Incomplete wallet balances');
      const balance = (id: string, currency: Currency) =>
        new D(
          balances.rows.find((row) => row.wallet_id === id && row.currency === currency)!.amount,
        );
      if (input.type !== 'deposit') {
        const remaining = balance(input.walletId, input.from).minus(input.amount);
        if (remaining.lt(0))
          throw new DomainError(422, 'INSUFFICIENT_FUNDS', 'Insufficient source balance.');
        await client.query('UPDATE balances SET amount=$3 WHERE wallet_id=$1 AND currency=$2', [
          input.walletId,
          input.from,
          money(remaining),
        ]);
      }
      const received = balance(input.recipientId, input.to).plus(destinationAmount);
      if (received.gt(MAX_AMOUNT))
        throw new DomainError(
          422,
          'BALANCE_LIMIT',
          'Recipient balance exceeds the supported limit.',
        );
      await client.query('UPDATE balances SET amount=$3 WHERE wallet_id=$1 AND currency=$2', [
        input.recipientId,
        input.to,
        money(received),
      ]);
      const inserted = await client.query<TransactionRow>(
        `INSERT INTO transactions(type,source_wallet_id,destination_wallet_id,source_currency,destination_currency,source_amount,destination_amount,rate,rate_source,rate_updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          input.type,
          input.type === 'deposit' ? null : input.walletId,
          input.recipientId,
          input.from,
          input.to,
          input.amount,
          destinationAmount,
          quote.rate,
          quote.source,
          quote.updatedAt,
        ],
      );
      const transaction = inserted.rows[0]!;
      await client.query(
        'INSERT INTO idempotency_requests(wallet_id,key,fingerprint,transaction_id) VALUES ($1,$2,$3,$4)',
        [input.walletId, key, fingerprint, transaction.id],
      );
      return { transaction: transactionView(transaction), replayed: false };
    });
  }
}

@Controller('wallets/:walletId')
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly transactions: TransactionsService) {}

  @Post('deposits')
  async deposit(
    @Param('walletId') walletId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.transactions.deposit(uuidSchema.parse(walletId), body, key);
    response
      .status(result.replayed ? 200 : 201)
      .setHeader('Idempotency-Replayed', String(result.replayed));
    return result.transaction;
  }

  @Post('swaps')
  async swap(
    @Param('walletId') walletId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.transactions.swap(uuidSchema.parse(walletId), body, key);
    response
      .status(result.replayed ? 200 : 201)
      .setHeader('Idempotency-Replayed', String(result.replayed));
    return result.transaction;
  }

  @Post('transfers')
  async transfer(
    @Param('walletId') walletId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.transactions.transfer(uuidSchema.parse(walletId), body, key);
    response
      .status(result.replayed ? 200 : 201)
      .setHeader('Idempotency-Replayed', String(result.replayed));
    return result.transaction;
  }
}
