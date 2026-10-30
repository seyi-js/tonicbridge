import { Controller, Get, Inject } from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { FxService } from './fx.service';

@Controller('rates')
export class FxController {
  constructor(@Inject(FxService) private readonly fx: FxService) {}

  @Get()
  @ResponseMessage('Exchange rates retrieved successfully.')
  rates() {
    return this.fx.rates();
  }
}
