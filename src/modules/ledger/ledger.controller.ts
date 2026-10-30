import { Controller, Get, Inject } from '@nestjs/common';
import { UuidParam } from '../../common/decorators/validation.decorators';
import { ControllerContract } from '../../common/responses/controller-response';
import { LedgerService } from './ledger.service';

@Controller('transactions')
export class LedgerController implements ControllerContract<LedgerController> {
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService) {}

  @Get(':transactionId/ledger')
  async get(@UuidParam('transactionId') transactionId: string) {
    const data = await this.ledger.get(transactionId);
    return { data, message: 'Ledger journal retrieved successfully.' };
  }
}
