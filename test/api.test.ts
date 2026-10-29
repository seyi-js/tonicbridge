import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';
import { Database } from '../src/database';
import { randomUUID } from 'node:crypto';

let app: INestApplication;
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
});

describe('wallets', () => {
  it('normalizes email and creates all five zero balances atomically', async () => {
    const email = `${randomUUID()}@example.com`;
    const result = await request(app.getHttpServer())
      .post('/wallets')
      .send({ email: ` ${email.toUpperCase()} ` })
      .expect(201);
    expect(result.body.email).toBe(email);
    const stored = await app
      .get(Database)
      .query('SELECT amount FROM balances WHERE wallet_id=$1', [result.body.id]);
    expect(stored.rows).toHaveLength(5);
    expect(stored.rows.every((r) => r.amount === '0.000000')).toBe(true);
    await request(app.getHttpServer()).get(`/wallets/${result.body.id}`).expect(200);
    await request(app.getHttpServer()).post('/wallets').send({ email }).expect(409);
  });
  it('protects email and phone uniqueness under concurrent creation', async () => {
    const phone = '+2348012345678';
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer()).post('/wallets').send({ phone }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    await request(app.getHttpServer())
      .post('/wallets')
      .send({ email: `${randomUUID()}@example.com`, phone })
      .expect(409);
  });
  it('validates identities, unknown properties and UUIDs', async () => {
    for (const body of [
      {},
      { email: 'bad' },
      { phone: '08012345678' },
      { email: 'a@example.com', admin: true },
    ])
      await request(app.getHttpServer()).post('/wallets').send(body).expect(400);
    await request(app.getHttpServer()).get('/wallets/not-a-uuid').expect(400);
    await request(app.getHttpServer()).get(`/wallets/${randomUUID()}`).expect(404);
  });
});

async function wallet() {
  const res = await request(app.getHttpServer())
    .post('/wallets')
    .send({ email: `${randomUUID()}@example.com` })
    .expect(201);
  return res.body.id as string;
}
async function amount(walletId: string, currency = 'USDx') {
  const res = await app
    .get(Database)
    .query('SELECT amount FROM balances WHERE wallet_id=$1 AND currency=$2', [walletId, currency]);
  return res.rows[0]?.amount as string;
}
function deposit(id: string, value: unknown, key = randomUUID(), currency = 'USDx') {
  return request(app.getHttpServer())
    .post(`/wallets/${id}/deposits`)
    .set('Idempotency-Key', key)
    .send({ currency, amount: value });
}
describe('deposits', () => {
  it('credits once across concurrent retries and replays equivalent normalized amounts', async () => {
    const id = await wallet();
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 8 }, () => deposit(id, '10.1', key)));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(7);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await amount(id)).toBe('10.100000');
    const replay = await deposit(id, '10.100000', key).expect(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    await deposit(id, '11', key).expect(409);
    await deposit(id, '10.1', key, 'EURx').expect(409);
  });
  it('does not lose concurrent deposits with different keys', async () => {
    const id = await wallet();
    const results = await Promise.all(Array.from({ length: 12 }, () => deposit(id, '0.1')));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await amount(id)).toBe('1.200000');
  });
  it('rejects invalid money, missing keys, unsupported currencies and unknown wallets', async () => {
    const id = await wallet();
    for (const value of ['abc', 1, '-1', '0', '1e3', '1.0000001'])
      await deposit(id, value).expect(400);
    await request(app.getHttpServer())
      .post(`/wallets/${id}/deposits`)
      .send({ currency: 'USDx', amount: '1' })
      .expect(400);
    await deposit(id, '1', randomUUID(), 'BTC').expect(400);
    await deposit(randomUUID(), '1').expect(404);
    expect(await amount(id)).toBe('0.000000');
  });
  it('keeps values above Number.MAX_SAFE_INTEGER exact and rolls back overflow', async () => {
    const id = await wallet();
    await deposit(id, '999999999999999999.999999').expect(201);
    const key = randomUUID();
    await deposit(id, '0.000001', key).expect(422);
    expect(await amount(id)).toBe('999999999999999999.999999');
    const records = await app
      .get(Database)
      .query('SELECT * FROM idempotency_requests WHERE wallet_id=$1 AND key=$2', [id, key]);
    expect(records.rowCount).toBe(0);
  });
});

describe('rates and balances', () => {
  it('returns exact balances and USD valuation from one labelled rate snapshot', async () => {
    const id = await wallet();
    await deposit(id, '1600', randomUUID(), 'cNGN').expect(201);
    await deposit(id, '2').expect(201);
    const response = await request(app.getHttpServer()).get(`/wallets/${id}/balances`).expect(200);
    expect(response.body.totalUsd).toBe('3.000000');
    expect(response.body.balances).toHaveLength(5);
    expect(response.body.rateSource).toBe('fixed');
    expect(
      response.body.balances.find((b: { currency: string }) => b.currency === 'cNGN').usdValue,
    ).toBe('1.000000');
    const rates = await request(app.getHttpServer()).get('/rates').expect(200);
    expect(rates.body.rates).toHaveLength(25);
    await request(app.getHttpServer()).get(`/wallets/${randomUUID()}/balances`).expect(404);
  });
});
afterAll(async () => {
  await app?.close();
});

describe('application startup', () => {
  it('starts against real PostgreSQL and publishes the API contract', async () => {
    const health = await request(app.getHttpServer()).get('/health').expect(200);
    expect(health.body).toEqual({ status: 'ok' });
    const docs = await request(app.getHttpServer()).get('/openapi.json').expect(200);
    expect(docs.body.info.title).toBe('TonicBridge');
  });
});

function swap(id: string, value: string, from = 'USDx', to = 'cNGN', key = randomUUID()) {
  return request(app.getHttpServer())
    .post(`/wallets/${id}/swaps`)
    .set('Idempotency-Key', key)
    .send({ fromCurrency: from, toCurrency: to, amount: value });
}
describe('swaps', () => {
  it('exchanges once under concurrent retries and persists the applied rate', async () => {
    const id = await wallet();
    await deposit(id, '10').expect(201);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => swap(id, '2.5', 'USDx', 'cNGN', key)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(7);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(results[0]!.body).toMatchObject({
      type: 'swap',
      sourceWalletId: id,
      destinationWalletId: id,
      sourceAmount: '2.500000',
      destinationAmount: '4000.000000',
      rate: '1600.000000000000',
      rateSource: 'fixed',
      rateUpdatedAt: '2026-10-29T00:00:00.000Z',
    });
    expect(await amount(id)).toBe('7.500000');
    expect(await amount(id, 'cNGN')).toBe('4000.000000');
    await swap(id, '2.500000', 'USDx', 'cNGN', key).expect(200);
    await swap(id, '2.5', 'USDx', 'EURx', key).expect(409);
    await deposit(id, '2.5', key).expect(409);
  });
  it('rejects insufficient funds without consuming the key and allows retry after funding', async () => {
    const id = await wallet();
    const key = randomUUID();
    const failed = await swap(id, '2', 'USDx', 'cNGN', key).expect(422);
    expect(failed.body.code).toBe('INSUFFICIENT_FUNDS');
    expect(await amount(id, 'cNGN')).toBe('0.000000');
    await deposit(id, '2').expect(201);
    await swap(id, '2', 'USDx', 'cNGN', key).expect(201);
    expect(await amount(id)).toBe('0.000000');
    expect(await amount(id, 'cNGN')).toBe('3200.000000');
  });
  it('rounds down and rejects sub-minimum conversions and same-currency swaps', async () => {
    const id = await wallet();
    await deposit(id, '2', randomUUID(), 'cNGN').expect(201);
    const result = await swap(id, '1.234567', 'cNGN', 'USDx').expect(201);
    expect(result.body.destinationAmount).toBe('0.000771');
    expect(await amount(id, 'cNGN')).toBe('0.765433');
    await swap(id, '0.000001', 'cNGN', 'USDx').expect(422);
    expect(await amount(id, 'cNGN')).toBe('0.765433');
    await swap(id, '1', 'cNGN', 'cNGN').expect(400);
    await swap(randomUUID(), '1').expect(404);
  });
  it('rolls back the debit when the destination balance would overflow', async () => {
    const id = await wallet();
    await deposit(id, '999999999999999999.999999', randomUUID(), 'cNGN').expect(201);
    await deposit(id, '1').expect(201);
    const key = randomUUID();
    const result = await swap(id, '1', 'USDx', 'cNGN', key).expect(422);
    expect(result.body.code).toBe('BALANCE_LIMIT');
    expect(await amount(id)).toBe('1.000000');
    expect(await amount(id, 'cNGN')).toBe('999999999999999999.999999');
    const records = await app
      .get(Database)
      .query('SELECT * FROM idempotency_requests WHERE wallet_id=$1 AND key=$2', [id, key]);
    expect(records.rowCount).toBe(0);
  });
});
