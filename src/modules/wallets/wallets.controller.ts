import { Controller, Get, Inject, Post } from '@nestjs/common';
import { UuidParam, ValidatedBody } from '../../common/decorators/validation.decorators';
import { ControllerContract } from '../../common/responses/controller-response';
import { createWalletSchema, CreateWalletDto } from './dto/create-wallet.dto';
import { WalletsService } from './wallets.service';
import { BalancesService } from './balances.service';

@Controller('wallets')
export class WalletsController implements ControllerContract<WalletsController> {
  constructor(
    @Inject(WalletsService) private readonly wallets: WalletsService,
    @Inject(BalancesService) private readonly balances: BalancesService,
  ) {}

  @Post()
  async create(@ValidatedBody(createWalletSchema) body: CreateWalletDto) {
    const data = await this.wallets.create(body);

    return { data, message: 'Wallet created successfully.' };
  }

  @Get(':walletId')
  async get(@UuidParam('walletId') id: string) {
    const data = await this.wallets.get(id);

    return { data, message: 'Wallet retrieved successfully.' };
  }

  @Get(':walletId/balances')
  async getBalances(@UuidParam('walletId') id: string) {
    const data = await this.balances.get(id);

    return { data, message: 'Wallet balances retrieved successfully.' };
  }
}
