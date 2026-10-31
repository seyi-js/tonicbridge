import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { createHash } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import { Repository, Sequelize } from 'sequelize-typescript';
import { AppLogger } from '../../common/logging/app-logger';
import { RequestContext } from '../../common/logging/request-context';
import { errorFields } from '../../common/logging/error-fields';
import { DomainError } from '../../common/errors/domain.error';
import { converted, Currency } from '../../common/money';
import { FxService } from '../fx/fx.service';
import { Wallet } from '../wallets/models/wallet.model';
import { LedgerService } from '../ledger/ledger.service';
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
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @InjectModel(WalletTransaction) private readonly transactions: Repository<WalletTransaction>,
    @InjectModel(IdempotencyRequest) private readonly requests: Repository<IdempotencyRequest>,
    @Inject(FxService) private readonly fx: FxService,
    @Inject(AppLogger) private readonly logger: AppLogger,
    @Inject(RequestContext) private readonly context: RequestContext,
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
    if (input.recipientWalletId === walletId) {
      throw new DomainError(400, 'SAME_WALLET', 'Recipient must be a different wallet.');
    }

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
    if (from === to) {
      return identityQuote;
    }

    const snapshot = await this.fx.snapshot();

    return {
      rate: this.fx.rate(snapshot, from, to),
      source: snapshot.source,
      updatedAt: snapshot.updatedAt,
    };
  }

  private async replay(stored: IdempotencyRequest, fingerprint: string, transaction?: Transaction) {
    this.context.identify({ transactionId: stored.transactionId });

    if (stored.fingerprint !== fingerprint) {
      this.logger.warn('transaction.idempotency_conflict', { transactionId: stored.transactionId });

      throw new DomainError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This key was already used for a different request.',
      );
    }

    const original = await this.transactions.findByPk(stored.transactionId, { transaction });

    if (!original) {
      throw new Error('Idempotency record has no transaction');
    }

    this.logger.info('transaction.replayed', {
      transactionId: original.id,
      operation: original.type,
    });

    return { transaction: transactionView(original), replayed: true };
  }

  private async move(
    input: Movement,
    rawKey: unknown,
    quoteProvider: () => Promise<RateQuote> = async () => identityQuote,
  ) {
    this.logger.debug('transaction.requested', { operation: input.type });

    const key = keySchema.parse(rawKey, { path: ['idempotency-key'] });

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

    if (prior) {
      return this.replay(prior, fingerprint);
    }

    // External FX calls finish before acquiring any wallet locks.
    const quoteStarted = performance.now();
    const quote = await quoteProvider();

    this.logger.debug('transaction.rate_obtained', {
      operation: input.type,
      rateSource: quote.source,
      durationMs: Math.round(performance.now() - quoteStarted),
    });

    const started = performance.now();
    const progress: { phase: 'begin' | 'work' | 'commit' } = { phase: 'begin' };

    try {
      const result = await this.sequelize.transaction(
        { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
        async (transaction) => {
          progress.phase = 'work';
          this.logger.debug('transaction.started', { operation: input.type });

          const ids = [...new Set([input.walletId, input.recipientId])].sort();

          const lockStarted = performance.now();

          this.logger.debug('wallet.locks_waiting', { walletCount: ids.length });

          // A single ordered query locks parents consistently; NO KEY UPDATE permits FK checks.
          const locked = await this.wallets.findAll({
            attributes: ['id'],
            where: { id: { [Op.in]: ids } },
            order: [['id', 'ASC']],
            lock: transaction.LOCK.NO_KEY_UPDATE,
            transaction,
          });

          this.logger.debug('wallet.locks_acquired', {
            walletCount: locked.length,
            waitMs: Math.round(performance.now() - lockStarted),
          });

          if (locked.length !== ids.length) {
            throw new DomainError(404, 'WALLET_NOT_FOUND', 'Source or recipient wallet not found.');
          }

          const previous = await this.requests.findOne({
            where: { walletId: input.walletId, key },
            transaction,
          });

          if (previous) {
            const replay = await this.replay(previous, fingerprint, transaction);

            progress.phase = 'commit';

            return replay;
          }

          const destinationAmount = converted(input.amount, quote.rate);

          const savedTransaction = await this.transactions.create(
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

          this.context.identify({ transactionId: savedTransaction.id });

          this.logger.debug('transaction.record_prepared', {
            transactionId: savedTransaction.id,
            operation: input.type,
          });

          await this.ledger.post(savedTransaction, transaction);

          await this.requests.create(
            { walletId: input.walletId, key, fingerprint, transactionId: savedTransaction.id },
            { transaction },
          );

          this.logger.debug('transaction.commit_requested', { transactionId: savedTransaction.id });
          progress.phase = 'commit';

          return { transaction: transactionView(savedTransaction), replayed: false };
        },
      );

      // Await the managed transaction itself: even afterCommit hooks can run on a failed commit in Sequelize 6.
      if (!result.replayed) {
        this.logger.info('transaction.committed', {
          transactionId: result.transaction.id,
          operation: input.type,
          durationMs: Math.round(performance.now() - started),
        });
      }

      return result;
    } catch (error) {
      // Sequelize attempts rollback for callback errors but suppresses rollback errors.
      // Commit/connection failures can leave an uncertain outcome, so never claim a confirmed rollback here.
      const fields = {
        operation: input.type,
        phase: progress.phase,
        outcome: progress.phase === 'work' ? ('rollback_attempted' as const) : ('unknown' as const),
        durationMs: Math.round(performance.now() - started),
        ...errorFields(error),
      };

      if (error instanceof DomainError && error.status < 500) {
        this.logger.warn('transaction.failed', fields);
      } else {
        this.logger.error('transaction.failed', fields);
      }

      throw error;
    }
  }
}
