import { Inject, Injectable } from '@nestjs/common';
import { currencies, D, money } from '../../common/money';
import { FxService } from '../fx/fx.service';
import { WalletsService } from './wallets.service';

@Injectable()
export class BalancesService {
  constructor(
    @Inject(WalletsService) private readonly wallets: WalletsService,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  async get(id: string) {
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
