import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { uuidSchema } from '../../common/money';
import { WalletsService } from './wallets.service';
@Controller('wallets')
export class WalletsController {
  constructor(@Inject(WalletsService) private readonly wallets: WalletsService) {}

  @Post()
  create(@Body() body: unknown) {
    return this.wallets.create(body);
  }

  @Get(':walletId')
  get(@Param('walletId') id: string) {
    return this.wallets.get(uuidSchema.parse(id));
  }
}
