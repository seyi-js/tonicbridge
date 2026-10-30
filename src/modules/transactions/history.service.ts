import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, Transaction, WhereOptions, InferAttributes } from 'sequelize';
import { Repository, Sequelize } from 'sequelize-typescript';
import { DomainError } from '../../common/errors/domain.error';
import { Wallet } from '../wallets/models/wallet.model';
import { WalletTransaction } from './models/transaction.model';
import { transactionView } from './transactions.mapper';
import { HistoryQueryDto } from './dto/history-query.dto';

@Injectable()
export class HistoryService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectModel(WalletTransaction) private readonly transactions: Repository<WalletTransaction>,
  ) {}

  async get(id: string) {
    const record = await this.transactions.findByPk(id);
    if (!record) throw new DomainError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found.');
    return transactionView(record);
  }

  async list(walletId: string, query: HistoryQueryDto) {
    const { type, currency, limit, offset } = query;
    const filters: WhereOptions<InferAttributes<WalletTransaction>>[] = [
      { [Op.or]: [{ sourceWalletId: walletId }, { destinationWalletId: walletId }] },
    ];
    if (type) filters.push({ type });
    if (currency)
      filters.push({ [Op.or]: [{ sourceCurrency: currency }, { destinationCurrency: currency }] });
    return this.sequelize.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true },
      async (transaction) => {
        const wallet = await this.wallets.findByPk(walletId, { attributes: ['id'], transaction });
        if (!wallet) throw new DomainError(404, 'WALLET_NOT_FOUND', 'Wallet not found.');
        // Both queries use one repeatable-read transaction, so count and page agree under writes.
        const { count, rows } = await this.transactions.findAndCountAll({
          where: { [Op.and]: filters },
          limit,
          offset,
          order: [
            ['createdAt', 'DESC'],
            ['id', 'DESC'],
          ],
          transaction,
        });
        return { items: rows.map(transactionView), total: count, limit, offset };
      },
    );
  }
}
