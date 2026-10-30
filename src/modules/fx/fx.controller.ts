import { Controller, Get, Inject } from '@nestjs/common';
import { ControllerContract } from '../../common/responses/controller-response';
import { FxService } from './fx.service';

@Controller('rates')
export class FxController implements ControllerContract<FxController> {
  constructor(@Inject(FxService) private readonly fx: FxService) {}

  @Get()
  async rates() {
    const data = await this.fx.rates();

    return { data, message: 'Exchange rates retrieved successfully.' };
  }
}
