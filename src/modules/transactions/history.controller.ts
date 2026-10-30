import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { uuidSchema } from '../../common/money';
import { HistoryService } from './history.service';
@Controller()
export class HistoryController {
  constructor(@Inject(HistoryService) private readonly history: HistoryService) {}

  @Get('wallets/:walletId/transactions')
  list(@Param('walletId') walletId: string, @Query() query: unknown) {
    return this.history.list(uuidSchema.parse(walletId), query);
  }

  @Get('transactions/:transactionId')
  get(@Param('transactionId') id: string) {
    return this.history.get(uuidSchema.parse(id));
  }
}
