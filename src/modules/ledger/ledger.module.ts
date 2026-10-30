import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Balance } from '../wallets/models/balance.model';
import { LedgerAccount } from './models/ledger-account.model';
import { LedgerEntry } from './models/ledger-entry.model';
import { LedgerJournal } from './models/ledger-journal.model';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

@Module({
  imports: [SequelizeModule.forFeature([LedgerAccount, LedgerJournal, LedgerEntry, Balance])],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
