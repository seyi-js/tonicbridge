import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { FxModule } from '../fx/fx.module';
import { LedgerModule } from '../ledger/ledger.module';
import { Wallet } from './models/wallet.model';
import { Balance } from './models/balance.model';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { BalancesService } from './balances.service';

@Module({
  imports: [SequelizeModule.forFeature([Wallet, Balance]), FxModule, LedgerModule],
  controllers: [WalletsController],
  providers: [WalletsService, BalancesService],
  exports: [WalletsService, SequelizeModule],
})
export class WalletsModule {}
