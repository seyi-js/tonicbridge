import { Controller, Get, Inject, Post } from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { UuidParam, ValidatedBody } from '../../common/decorators/validation.decorators';
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
  @ResponseMessage('Wallet created successfully.')
  create(@ValidatedBody(createWalletSchema) body: CreateWalletDto) {
    return this.wallets.create(body);
  }

  @Get(':walletId')
  @ResponseMessage('Wallet retrieved successfully.')
  get(@UuidParam('walletId') id: string) {
    return this.wallets.get(id);
  }

  @Get(':walletId/balances')
  @ResponseMessage('Wallet balances retrieved successfully.')
  getBalances(@UuidParam('walletId') id: string) {
    return this.balances.get(id);
  }
}
