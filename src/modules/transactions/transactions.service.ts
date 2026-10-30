import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Database } from '../../database/database.service';
import { DomainError } from '../../common/errors/domain.error';
import { FxService } from '../fx/fx.service';
import { converted, currencies, Currency, D, MAX_AMOUNT, money } from '../../common/money';
import { depositSchema } from './dto/deposit.dto';
import { swapSchema } from './dto/swap.dto';
import { transferSchema } from './dto/transfer.dto';
import { keySchema } from './idempotency';
import {
  TransactionRow,
  Movement,
  RateQuote,
  identityQuote,
  transactionView,
} from './transactions.types';
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
