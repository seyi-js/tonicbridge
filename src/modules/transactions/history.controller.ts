import { Controller, Get, Inject } from '@nestjs/common';
import { UuidParam, ValidatedQuery } from '../../common/decorators/validation.decorators';
import { historySchema, HistoryQueryDto } from './dto/history-query.dto';
import { HistoryService } from './history.service';

@Controller()
export class HistoryController {
  constructor(@Inject(HistoryService) private readonly history: HistoryService) {}

  @Get('wallets/:walletId/transactions')
  list(
    @UuidParam('walletId') walletId: string,
    @ValidatedQuery(historySchema) query: HistoryQueryDto,
  ) {
    return this.history.list(walletId, query);
  }

  @Get('transactions/:transactionId')
  get(@UuidParam('transactionId') id: string) {
    return this.history.get(id);
  }
}
