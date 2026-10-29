import { Controller, Get, Inject, Injectable, Logger, Param } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from './config';
import { currencies, Currency, D, money, uuidSchema } from './money';
import { WalletsService } from './wallets';

export interface RateSnapshot {
  source: 'live' | 'fixed';

  updatedAt: string;

  perUsd: Record<Currency, string>;
}
// Explicit synthetic assumptions, published with this prototype; not historical market quotes.
export const FIXED_RATES: RateSnapshot = {
  source: 'fixed',
  updatedAt: '2026-10-29T00:00:00.000Z',
  perUsd: { cNGN: '1600', cGHS: '15', cXAF: '600', USDx: '1', EURx: '0.9' },
};
const value = z.number().finite().min(0.000001).max(1e9);
const providerSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  usd: z.object({ ngn: value, ghs: value, xaf: value, usd: z.literal(1), eur: value }),
});

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  private cached?: { snapshot: RateSnapshot; expiresAt: number };

  private pending?: Promise<RateSnapshot>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  rate(snapshot: RateSnapshot, from: Currency, to: Currency): string {
    return new D(snapshot.perUsd[to]).div(snapshot.perUsd[from]).toFixed(12);
  }

  async snapshot(): Promise<RateSnapshot> {
    if (this.config.FX_MODE === 'fixed') return FIXED_RATES;
    if (
      this.cached &&
      Date.now() < this.cached.expiresAt &&
      (this.cached.snapshot.source === 'fixed' ||
        Date.now() - Date.parse(this.cached.snapshot.updatedAt) <= 3 * 86400000)
    )
      return this.cached.snapshot;
    if (!this.pending)
      this.pending = this.refresh().finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async refresh(): Promise<RateSnapshot> {
    try {
      const response = await fetch(
        `${this.config.FX_BASE_URL.replace(/\/$/, '')}/v1/currencies/usd.json`,
        {
          signal: AbortSignal.timeout(this.config.FX_TIMEOUT_MS),
          redirect: 'error',
          headers: { Accept: 'application/json' },
        },
      );
      if (!response.ok) throw new Error('FX provider status');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('FX body missing');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 262144) {
          await reader.cancel();
          throw new Error('FX body too large');
        }
        chunks.push(chunk.value);
      }
      const data = providerSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const timestamp = Date.parse(`${data.date}T00:00:00.000Z`);
      if (
        !Number.isFinite(timestamp) ||
        new Date(timestamp).toISOString().slice(0, 10) !== data.date ||
        timestamp > Date.now() + 300000 ||
        Date.now() - timestamp > 3 * 86400000
      )
        throw new Error('FX publication date invalid or stale');
      const snapshot: RateSnapshot = {
        source: 'live',
        updatedAt: new Date(timestamp).toISOString(),
        perUsd: {
          cNGN: String(data.usd.ngn),
          cGHS: String(data.usd.ghs),
          cXAF: String(data.usd.xaf),
          USDx: '1',
          EURx: String(data.usd.eur),
        },
      };
      this.cached = { snapshot, expiresAt: Date.now() + this.config.FX_CACHE_SECONDS * 1000 };
      return snapshot;
    } catch {
      this.logger.warn(
        'FX provider unavailable or invalid; using explicitly labelled fixed sandbox rates.',
      );
      // Short cooldown prevents request storms while allowing recovery on the next refresh.
      this.cached = { snapshot: FIXED_RATES, expiresAt: Date.now() + 60000 };
      return FIXED_RATES;
    }
  }

  async rates() {
    const snapshot = await this.snapshot();
    return {
      source: snapshot.source,
      updatedAt: snapshot.updatedAt,
      rates: currencies.flatMap((from) =>
        currencies.map((to) => ({
          from,
          to,
          rate: this.rate(snapshot, from, to),
          updatedAt: snapshot.updatedAt,
        })),
      ),
    };
  }
}

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
