import { Controller, Get, Inject, Param } from '@nestjs/common';
import { currencies, D, money, uuidSchema } from '../../common/money';
import { WalletsService } from '../wallets/wallets.service';
import { FxService } from './fx.service';
@Controller()
export class FxController {
  constructor(
    @Inject(FxService) private readonly fx: FxService,
    @Inject(WalletsService) private readonly wallets: WalletsService,
  ) {}

  @Get('rates')
  rates() {
    return this.fx.rates();
  }

  @Get('wallets/:walletId/balances')
  async balances(@Param('walletId') walletId: string) {
    const id = uuidSchema.parse(walletId);
    const rows = await this.wallets.balances(id);
    const snapshot = await this.fx.snapshot();
    const balances = currencies.map((currency) => {
      const amount = rows.find((row) => row.currency === currency)!.amount;
      return {
        currency,
        amount,
        usdValue: money(new D(amount).times(this.fx.rate(snapshot, currency, 'USDx'))),
      };
    });
    return {
      walletId: id,
      balances,
      totalUsd: money(balances.reduce((sum, row) => sum.plus(row.usdValue), new D(0))),
      rateSource: snapshot.source,
      rateUpdatedAt: snapshot.updatedAt,
    };
  }
}
