import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { uuidSchema } from '../../common/money';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { historySchema, HistoryQueryDto } from './dto/history-query.dto';
import { HistoryService } from './history.service';

@Controller()
export class HistoryController {
  constructor(@Inject(HistoryService) private readonly history: HistoryService) {}

  @Get('wallets/:walletId/transactions')
  list(
    @Param('walletId', new ZodValidationPipe(uuidSchema)) walletId: string,
    @Query(new ZodValidationPipe(historySchema)) query: HistoryQueryDto,
  ) {
    return this.history.list(walletId, query);
  }

  @Get('transactions/:transactionId')
  get(@Param('transactionId', new ZodValidationPipe(uuidSchema)) id: string) {
    return this.history.get(id);
  }
}
