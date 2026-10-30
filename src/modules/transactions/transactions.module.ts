import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
@Module({
  imports: [FxModule],
  controllers: [TransactionsController, HistoryController],
  providers: [TransactionsService, HistoryService],
})
export class TransactionsModule {}
