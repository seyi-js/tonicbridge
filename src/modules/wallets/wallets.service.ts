import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { UniqueConstraintError } from 'sequelize';
import { Repository, Sequelize } from 'sequelize-typescript';
import { DomainError } from '../../common/errors/domain.error';
import { currencies } from '../../common/money';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { Wallet } from './models/wallet.model';
import { Balance } from './models/balance.model';
import { walletView } from './wallets.mapper';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class WalletsService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectModel(Balance) private readonly balancesRepository: Repository<Balance>,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  async create(input: CreateWalletDto) {
    try {
      return await this.sequelize.transaction(async (transaction) => {
        const wallet = await this.wallets.create(
          { email: input.email ?? null, phone: input.phone ?? null },
          { transaction },
        );
        await this.balancesRepository.bulkCreate(
          currencies.map((currency) => ({ walletId: wallet.id, currency, amount: '0.000000' })),
          { transaction },
        );
        await this.ledger.createWalletAccounts(wallet.id, transaction);
        return walletView(wallet);
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError)
        throw new DomainError(
          409,
          'DUPLICATE_IDENTITY',
          'A wallet already exists for that email or phone.',
        );
      throw error;
    }
  }

  async get(id: string) {
    const wallet = await this.wallets.findByPk(id);
    if (!wallet) throw new DomainError(404, 'WALLET_NOT_FOUND', 'Wallet not found.');
    return walletView(wallet);
  }

  async balances(id: string): Promise<Balance[]> {
    await this.get(id);
    return this.balancesRepository.findAll({
      where: { walletId: id },
      order: [['currency', 'ASC']],
    });
  }
}
