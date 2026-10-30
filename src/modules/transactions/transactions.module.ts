import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { FxModule } from '../fx/fx.module';
import { WalletsModule } from '../wallets/wallets.module';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletTransaction } from './models/transaction.model';
import { IdempotencyRequest } from './models/idempotency-request.model';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [
    SequelizeModule.forFeature([WalletTransaction, IdempotencyRequest]),
    WalletsModule,
    LedgerModule,
    FxModule,
  ],
  controllers: [TransactionsController, HistoryController],
  providers: [TransactionsService, HistoryService],
})
export class TransactionsModule {}
