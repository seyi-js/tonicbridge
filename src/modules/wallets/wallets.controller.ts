import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { uuidSchema } from '../../common/money';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { createWalletSchema, CreateWalletDto } from './dto/create-wallet.dto';
import { WalletsService } from './wallets.service';
import { BalancesService } from './balances.service';

@Controller('wallets')
export class WalletsController {
  constructor(
    @Inject(WalletsService) private readonly wallets: WalletsService,
    @Inject(BalancesService) private readonly balances: BalancesService,
  ) {}

  @Post()
  create(@Body(new ZodValidationPipe(createWalletSchema)) body: CreateWalletDto) {
    return this.wallets.create(body);
  }

  @Get(':walletId')
  get(@Param('walletId', new ZodValidationPipe(uuidSchema)) id: string) {
    return this.wallets.get(id);
  }

  @Get(':walletId/balances')
  getBalances(@Param('walletId', new ZodValidationPipe(uuidSchema)) id: string) {
    return this.balances.get(id);
  }
}
