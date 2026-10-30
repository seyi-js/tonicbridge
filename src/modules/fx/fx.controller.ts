import { Controller, Get, Inject } from '@nestjs/common';
import { FxService } from './fx.service';

@Controller('rates')
export class FxController {
  constructor(@Inject(FxService) private readonly fx: FxService) {}

  @Get()
  rates() {
    return this.fx.rates();
  }
}
