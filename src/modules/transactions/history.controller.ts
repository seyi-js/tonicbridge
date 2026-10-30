import { Controller, Get, Inject } from '@nestjs/common';
import { PaginatedResponse } from '../../common/decorators/paginated-response.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { UuidParam, ValidatedQuery } from '../../common/decorators/validation.decorators';
import { historySchema, HistoryQueryDto } from './dto/history-query.dto';
import { HistoryService } from './history.service';

@Controller()
export class HistoryController {
  constructor(@Inject(HistoryService) private readonly history: HistoryService) {}

  @Get('wallets/:walletId/transactions')
  @ResponseMessage('Transactions retrieved successfully.')
  @PaginatedResponse()
  list(
    @UuidParam('walletId') walletId: string,
    @ValidatedQuery(historySchema) query: HistoryQueryDto,
  ) {
    return this.history.list(walletId, query);
  }

  @Get('transactions/:transactionId')
  @ResponseMessage('Transaction retrieved successfully.')
  get(@UuidParam('transactionId') id: string) {
    return this.history.get(id);
  }
}
