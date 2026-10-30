import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { Repository } from 'sequelize-typescript';
import { DomainError } from '../../common/errors/domain.error';
import { currencies, Currency, D, MAX_AMOUNT, money } from '../../common/money';
import { WalletTransaction } from '../transactions/models/transaction.model';
import { Balance } from '../wallets/models/balance.model';
import { LedgerAccount } from './models/ledger-account.model';
import { LedgerEntry } from './models/ledger-entry.model';
import { LedgerJournal } from './models/ledger-journal.model';

interface Posting {
  kind: LedgerAccount['kind'];
  walletId: string | null;
  currency: Currency;
  direction: LedgerEntry['direction'];
  amount: string;
}

@Injectable()
export class LedgerService {
  constructor(
    @InjectModel(LedgerAccount) private readonly accounts: Repository<LedgerAccount>,
    @InjectModel(LedgerJournal) private readonly journals: Repository<LedgerJournal>,
    @InjectModel(LedgerEntry) private readonly entries: Repository<LedgerEntry>,
    @InjectModel(Balance) private readonly balances: Repository<Balance>,
  ) {}

  async createWalletAccounts(walletId: string, transaction: Transaction): Promise<void> {
    await this.accounts.bulkCreate(
      currencies.map((currency) => ({ kind: 'wallet' as const, walletId, currency })),
      { transaction },
    );
  }

  // The caller holds ordered wallet locks and owns the surrounding database transaction.
  async post(record: WalletTransaction, transaction: Transaction): Promise<void> {
    const postings = this.postings(record);
    const walletIds = [
      ...new Set(postings.flatMap((entry) => (entry.walletId ? [entry.walletId] : []))),
    ];
    const accounts = await this.accounts.findAll({
      where: { [Op.or]: [{ walletId: { [Op.in]: walletIds } }, { walletId: null }] },
      transaction,
    });
    const balances = await this.balances.findAll({
      where: { walletId: { [Op.in]: walletIds } },
      transaction,
    });
    if (balances.length !== walletIds.length * currencies.length)
      throw new Error('Incomplete wallet balances');

    // Build the projection from the same postings that will be stored in the journal.
    const changes = postings
      .filter((entry) => entry.kind === 'wallet')
      .map((entry) => {
        const balance = balances.find(
          (row) => row.walletId === entry.walletId && row.currency === entry.currency,
        );
        if (!balance) throw new Error('Wallet balance is missing');
        const amount = new D(balance.amount).plus(
          entry.direction === 'credit' ? entry.amount : new D(entry.amount).negated(),
        );
        if (amount.lt(0))
          throw new DomainError(422, 'INSUFFICIENT_FUNDS', 'Insufficient source balance.');
        if (amount.gt(MAX_AMOUNT))
          throw new DomainError(
            422,
            'BALANCE_LIMIT',
            'Recipient balance exceeds the supported limit.',
          );
        return { balance, amount: money(amount) };
      });

    const journal = await this.journals.create({ transactionId: record.id }, { transaction });
    await this.entries.bulkCreate(
      postings.map((entry, index) => {
        const account = accounts.find(
          (row) =>
            row.kind === entry.kind &&
            row.walletId === entry.walletId &&
            row.currency === entry.currency,
        );
        if (!account) throw new Error('Ledger account is missing');
        return {
          journalId: journal.id,
          lineNumber: index + 1,
          accountId: account.id,
          currency: entry.currency,
          direction: entry.direction,
          amount: entry.amount,
        };
      }),
      { transaction },
    );

    for (const change of changes) {
      await change.balance.update({ amount: change.amount }, { transaction });
    }
    // Deferred PostgreSQL constraints verify balance, transaction matching, and projections at commit.
  }

  async get(transactionId: string) {
    const journal = await this.journals.findOne({ where: { transactionId } });
    if (!journal) throw new DomainError(404, 'JOURNAL_NOT_FOUND', 'Ledger journal not found.');
    const entries = await this.entries.findAll({
      where: { journalId: journal.id },
      order: [['lineNumber', 'ASC']],
    });
    const accounts = await this.accounts.findAll({
      where: { id: { [Op.in]: entries.map((entry) => entry.accountId) } },
    });
    return {
      id: journal.id,
      transactionId,
      recordedAt: journal.recordedAt.toISOString(),
      entries: entries.map((entry) => {
        const account = accounts.find((row) => row.id === entry.accountId)!;
        return {
          id: entry.id,
          lineNumber: entry.lineNumber,
          accountId: account.id,
          accountKind: account.kind,
          walletId: account.walletId,
          currency: entry.currency,
          direction: entry.direction,
          amount: entry.amount,
        };
      }),
    };
  }

  private postings(record: WalletTransaction): Posting[] {
    const source: Posting = {
      kind: record.type === 'deposit' ? 'funding' : 'wallet',
      walletId: record.sourceWalletId,
      currency: record.sourceCurrency,
      direction: 'debit',
      amount: record.sourceAmount,
    };
    const destination: Posting = {
      kind: 'wallet',
      walletId: record.destinationWalletId,
      currency: record.destinationCurrency,
      direction: 'credit',
      amount: record.destinationAmount,
    };
    if (record.sourceCurrency === record.destinationCurrency) return [source, destination];
    return [
      source,
      {
        kind: 'fx',
        walletId: null,
        currency: record.sourceCurrency,
        direction: 'credit',
        amount: record.sourceAmount,
      },
      {
        kind: 'fx',
        walletId: null,
        currency: record.destinationCurrency,
        direction: 'debit',
        amount: record.destinationAmount,
      },
      destination,
    ];
  }
}
