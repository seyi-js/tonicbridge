import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { readConfig } from '../src/config/app-config';
import { FxService } from '../src/modules/fx/fx.service';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0)) {
    await close();
  }
});

const valid = () => ({
  date: new Date().toISOString().slice(0, 10),
  usd: { usd: 1, ngn: 1500, ghs: 12, xaf: 580, eur: 0.92 },
});

async function provider(body: unknown, status = 200, delay = 0, timeout = 1000) {
  let calls = 0;

  const server = createServer((req, res) => {
    calls++;

    if (req.url !== '/v1/currencies/usd.json') {
      res.writeHead(501).end();

      return;
    }

    setTimeout(() => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    }, delay);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );

  const config = {
    ...readConfig({}),
    FX_MODE: 'live' as const,
    FX_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    FX_TIMEOUT_MS: timeout,
  };

  return { service: new FxService(config), calls: () => calls };
}

describe('FX HTTP adapter', () => {
  it('parses a real HTTP response, shares concurrent refreshes and caches all 25 directed pairs', async () => {
    const { service, calls } = await provider(valid());
    const results = await Promise.all(Array.from({ length: 10 }, () => service.rates()));

    expect(calls()).toBe(1);
    expect(results[0]!.source).toBe('live');
    expect(results[0]!.rates).toHaveLength(25);

    expect(results[0]!.rates.find((r) => r.from === 'USDx' && r.to === 'cNGN')!.rate).toBe(
      '1500.000000000000',
    );

    expect(results[0]!.rates.find((r) => r.from === 'cNGN' && r.to === 'USDx')!.rate).toBe(
      '0.000666666666',
    );

    await service.snapshot();
    expect(calls()).toBe(1);
  });

  it('falls back on unavailable, malformed, incomplete, nonpositive, stale and future data', async () => {
    const cases: Array<[unknown, number]> = [
      [{ error: 'unavailable' }, 503],
      ['<html>Unavailable</html>', 200],
      [{ ...valid(), usd: { usd: 1 } }, 200],
      [{ ...valid(), usd: { ...valid().usd, ngn: 0 } }, 200],
      [{ ...valid(), usd: { ...valid().usd, ngn: 1e9, eur: 0.000001 } }, 200],
      [{ ...valid(), date: '2001-01-01' }, 200],
      [{ ...valid(), date: '2099-01-01' }, 200],
    ];

    for (const [data, status] of cases) {
      const { service, calls } = await provider(data, status);

      expect((await service.rates()).source).toBe('fixed');

      expect(
        (await service.rates()).rates.find((r) => r.from === 'USDx' && r.to === 'cNGN')!.rate,
      ).toBe('1600.000000000000');

      expect(calls()).toBe(1);
    }
  });

  it('bounds time spent waiting for the provider', async () => {
    const { service } = await provider(valid(), 200, 300, 80);
    const start = Date.now();

    expect((await service.snapshot()).source).toBe('fixed');
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('supports fixed mode without any network access', async () => {
    const service = new FxService({
      ...readConfig({}),
      FX_MODE: 'fixed',
      FX_BASE_URL: 'http://127.0.0.1:1',
    });

    expect((await service.snapshot()).source).toBe('fixed');
  });
});
