import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { createHash } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import { Repository, Sequelize } from 'sequelize-typescript';
import { DomainError } from '../../common/errors/domain.error';
import { converted, currencies, Currency, D, MAX_AMOUNT, money } from '../../common/money';
import { FxService } from '../fx/fx.service';
import { Wallet } from '../wallets/models/wallet.model';
import { Balance } from '../wallets/models/balance.model';
import { DepositDto } from './dto/deposit.dto';
import { SwapDto } from './dto/swap.dto';
import { TransferDto } from './dto/transfer.dto';
import { keySchema } from './idempotency';
import { WalletTransaction } from './models/transaction.model';
import { IdempotencyRequest } from './models/idempotency-request.model';
import { Movement, RateQuote, identityQuote } from './transactions.types';
import { transactionView } from './transactions.mapper';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectModel(Balance) private readonly balances: Repository<Balance>,
    @InjectModel(WalletTransaction) private readonly transactions: Repository<WalletTransaction>,
    @InjectModel(IdempotencyRequest) private readonly requests: Repository<IdempotencyRequest>,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  deposit(walletId: string, input: DepositDto, key: unknown) {
    return this.move(
      {
        type: 'deposit',
        walletId,
        recipientId: walletId,
        from: input.currency,
        to: input.currency,
        amount: input.amount,
      },
      key,
    );
  }

  swap(walletId: string, input: SwapDto, key: unknown) {
    return this.move(
      {
        type: 'swap',
        walletId,
        recipientId: walletId,
        from: input.fromCurrency,
        to: input.toCurrency,
        amount: input.amount,
      },
      key,
      () => this.quote(input.fromCurrency, input.toCurrency),
    );
  }

  transfer(walletId: string, input: TransferDto, key: unknown) {
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
      key,
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

  private async replay(stored: IdempotencyRequest, fingerprint: string, transaction?: Transaction) {
    if (stored.fingerprint !== fingerprint)
      throw new DomainError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This key was already used for a different request.',
      );

    const original = await this.transactions.findByPk(stored.transactionId, { transaction });
    if (!original) throw new Error('Idempotency record has no transaction');

    return { transaction: transactionView(original), replayed: true };
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

    const prior = await this.requests.findOne({ where: { walletId: input.walletId, key } });
    if (prior) return this.replay(prior, fingerprint);

    // External FX calls finish before acquiring any wallet locks.
    const quote = await quoteProvider();

    return this.sequelize.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
      async (transaction) => {
        const ids = [...new Set([input.walletId, input.recipientId])].sort();

        // A single ordered query locks parents consistently; NO KEY UPDATE permits FK checks.
        const locked = await this.wallets.findAll({
          attributes: ['id'],
          where: { id: { [Op.in]: ids } },
          order: [['id', 'ASC']],
          lock: transaction.LOCK.NO_KEY_UPDATE,
          transaction,
        });
        if (locked.length !== ids.length)
          throw new DomainError(404, 'WALLET_NOT_FOUND', 'Source or recipient wallet not found.');

        const previous = await this.requests.findOne({
          where: { walletId: input.walletId, key },
          transaction,
        });
        if (previous) return this.replay(previous, fingerprint, transaction);

        const destinationAmount = converted(input.amount, quote.rate);
        const balances = await this.balances.findAll({
          where: { walletId: { [Op.in]: ids } },
          transaction,
        });
        if (balances.length !== ids.length * currencies.length)
          throw new Error('Incomplete wallet balances');

        const balance = (walletId: string, currency: Currency) =>
          balances.find((row) => row.walletId === walletId && row.currency === currency)!;

        if (input.type !== 'deposit') {
          const source = balance(input.walletId, input.from);
          const remaining = new D(source.amount).minus(input.amount);
          if (remaining.lt(0))
            throw new DomainError(422, 'INSUFFICIENT_FUNDS', 'Insufficient source balance.');
          await source.update({ amount: money(remaining) }, { transaction });
        }

        const destination = balance(input.recipientId, input.to);
        const received = new D(destination.amount).plus(destinationAmount);
        if (received.gt(MAX_AMOUNT))
          throw new DomainError(
            422,
            'BALANCE_LIMIT',
            'Recipient balance exceeds the supported limit.',
          );
        await destination.update({ amount: money(received) }, { transaction });

        const saved = await this.transactions.create(
          {
            type: input.type,
            sourceWalletId: input.type === 'deposit' ? null : input.walletId,
            destinationWalletId: input.recipientId,
            sourceCurrency: input.from,
            destinationCurrency: input.to,
            sourceAmount: input.amount,
            destinationAmount,
            rate: quote.rate,
            rateSource: quote.source,
            rateUpdatedAt: quote.updatedAt ? new Date(quote.updatedAt) : null,
          },
          { transaction },
        );
        await this.requests.create(
          { walletId: input.walletId, key, fingerprint, transactionId: saved.id },
          { transaction },
        );

        return { transaction: transactionView(saved), replayed: false };
      },
    );
  }
}
