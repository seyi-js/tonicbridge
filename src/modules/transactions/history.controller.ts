import { Controller, Get, Inject } from '@nestjs/common';
import { UuidParam, ValidatedQuery } from '../../common/decorators/validation.decorators';
import { ControllerContract } from '../../common/responses/controller-response';
import { historySchema, HistoryQueryDto } from './dto/history-query.dto';
import { HistoryService } from './history.service';

@Controller()
export class HistoryController implements ControllerContract<HistoryController> {
  constructor(@Inject(HistoryService) private readonly history: HistoryService) {}

  @Get('wallets/:walletId/transactions')
  async list(
    @UuidParam('walletId') walletId: string,
    @ValidatedQuery(historySchema) query: HistoryQueryDto,
  ) {
    const { items, total, limit, offset } = await this.history.list(walletId, query);
    return {
      data: items,
      message: 'Transactions retrieved successfully.',
      meta: { total, limit, offset },
    };
  }

  @Get('transactions/:transactionId')
  async get(@UuidParam('transactionId') id: string) {
    const data = await this.history.get(id);
    return { data, message: 'Transaction retrieved successfully.' };
  }
}
