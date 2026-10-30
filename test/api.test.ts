import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../src/bootstrap';
import { database } from './helpers/database';
import { randomInt, randomUUID } from 'node:crypto';

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

    expect(result.body.data.email).toBe(email);

    const stored = await database(app).query('SELECT amount FROM balances WHERE wallet_id=$1', [
      result.body.data.id,
    ]);

    expect(stored.rows).toHaveLength(5);
    expect(stored.rows.every((r) => r.amount === '0.000000')).toBe(true);
    await request(app.getHttpServer()).get(`/wallets/${result.body.data.id}`).expect(200);
    await request(app.getHttpServer()).post('/wallets').send({ email }).expect(409);
  });

  it('protects email and phone uniqueness under concurrent creation', async () => {
    const phone = `+2348${randomInt(100000000, 1000000000)}`;

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
    ]) {
      await request(app.getHttpServer()).post('/wallets').send(body).expect(400);
    }

    await request(app.getHttpServer()).get('/wallets/not-a-uuid').expect(400);
    await request(app.getHttpServer()).get(`/wallets/${randomUUID()}`).expect(404);
  });
});

async function wallet() {
  const res = await request(app.getHttpServer())
    .post('/wallets')
    .send({ email: `${randomUUID()}@example.com` })
    .expect(201);

  return res.body.data.id as string;
}

async function amount(walletId: string, currency = 'USDx') {
  const res = await database(app).query(
    'SELECT amount FROM balances WHERE wallet_id=$1 AND currency=$2',
    [walletId, currency],
  );

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
    expect(new Set(responses.map((r) => r.body.data.id)).size).toBe(1);
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

    for (const value of ['abc', 1, '-1', '0', '1e3', '1.0000001']) {
      await deposit(id, value).expect(400);
    }

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

    const records = await database(app).query(
      'SELECT * FROM idempotency_requests WHERE wallet_id=$1 AND key=$2',
      [id, key],
    );

    expect(records.rowCount).toBe(0);
  });
});

describe('rates and balances', () => {
  it('returns exact balances and USD valuation from one labelled rate snapshot', async () => {
    const id = await wallet();

    await deposit(id, '1600', randomUUID(), 'cNGN').expect(201);
    await deposit(id, '2').expect(201);
    const response = await request(app.getHttpServer()).get(`/wallets/${id}/balances`).expect(200);

    expect(response.body.data.totalUsd).toBe('3.000000');
    expect(response.body.data.balances).toHaveLength(5);
    expect(response.body.data.rateSource).toBe('fixed');

    expect(
      response.body.data.balances.find((b: { currency: string }) => b.currency === 'cNGN').usdValue,
    ).toBe('1.000000');

    const rates = await request(app.getHttpServer()).get('/rates').expect(200);

    expect(rates.body.data.rates).toHaveLength(25);
    await request(app.getHttpServer()).get(`/wallets/${randomUUID()}/balances`).expect(404);
  });
});

afterAll(async () => {
  await app?.close();
});

describe('application startup', () => {
  it('starts against real PostgreSQL and publishes the API contract', async () => {
    const health = await request(app.getHttpServer()).get('/health').expect(200);

    expect(health.body.data).toEqual({ status: 'ok' });
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
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);

    expect(results[0]!.body.data).toMatchObject({
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

    expect(failed.body.errors[0].code).toBe('INSUFFICIENT_FUNDS');
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

    expect(result.body.data.destinationAmount).toBe('0.000771');
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

    expect(result.body.errors[0].code).toBe('BALANCE_LIMIT');
    expect(await amount(id)).toBe('1.000000');
    expect(await amount(id, 'cNGN')).toBe('999999999999999999.999999');

    const records = await database(app).query(
      'SELECT * FROM idempotency_requests WHERE wallet_id=$1 AND key=$2',
      [id, key],
    );

    expect(records.rowCount).toBe(0);
  });
});

function transfer(
  id: string,
  recipientWalletId: string,
  value: string,
  from = 'USDx',
  to = 'USDx',
  key = randomUUID(),
) {
  return request(app.getHttpServer())
    .post(`/wallets/${id}/transfers`)
    .set('Idempotency-Key', key)
    .send({ recipientWalletId, fromCurrency: from, toCurrency: to, amount: value });
}

describe('transfers', () => {
  it('moves same-currency funds once and scopes keys to the sending wallet', async () => {
    const sender = await wallet();
    const recipient = await wallet();

    await deposit(sender, '10').expect(201);
    const key = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => transfer(sender, recipient, '3', 'USDx', 'USDx', key)),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(7);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);

    expect(results[0]!.body.data).toMatchObject({
      type: 'transfer',
      sourceWalletId: sender,
      destinationWalletId: recipient,
      sourceAmount: '3.000000',
      destinationAmount: '3.000000',
      rate: '1.000000000000',
      rateSource: null,
      rateUpdatedAt: null,
    });

    expect(await amount(sender)).toBe('7.000000');
    expect(await amount(recipient)).toBe('3.000000');
    await transfer(sender, recipient, '4', 'USDx', 'USDx', key).expect(409);
    // The other wallet can independently use the same key.
    await transfer(recipient, sender, '1', 'USDx', 'USDx', key).expect(201);
    expect(await amount(sender)).toBe('8.000000');
    expect(await amount(recipient)).toBe('2.000000');
  });

  it('stores both participants, currencies, amounts and rate in a cross-currency transfer', async () => {
    const sender = await wallet();
    const recipient = await wallet();

    await deposit(sender, '1600', randomUUID(), 'cNGN').expect(201);
    const response = await transfer(sender, recipient, '1600', 'cNGN', 'cGHS').expect(201);

    expect(response.body.data).toMatchObject({
      sourceWalletId: sender,
      destinationWalletId: recipient,
      sourceCurrency: 'cNGN',
      destinationCurrency: 'cGHS',
      sourceAmount: '1600.000000',
      destinationAmount: '15.000000',
      rate: '0.009375000000',
      rateSource: 'fixed',
      rateUpdatedAt: '2026-10-29T00:00:00.000Z',
    });

    expect(Date.parse(response.body.data.createdAt)).toBeGreaterThan(0);
    expect(await amount(sender, 'cNGN')).toBe('0.000000');
    expect(await amount(recipient, 'cGHS')).toBe('15.000000');
  });

  it('rejects insufficient funds, unknown recipients and self-transfers without changing balances', async () => {
    const sender = await wallet();
    const recipient = await wallet();

    await deposit(sender, '1').expect(201);
    await transfer(sender, recipient, '2').expect(422);
    await transfer(sender, randomUUID(), '1').expect(404);
    await transfer(sender, sender, '1').expect(400);
    await transfer(sender, recipient, '1', 'USDx', 'BTC').expect(400);
    expect(await amount(sender)).toBe('1.000000');
    expect(await amount(recipient)).toBe('0.000000');
  });

  it('rolls back the sender debit and leaves no transfer record on recipient overflow', async () => {
    const sender = await wallet();
    const recipient = await wallet();

    await deposit(sender, '1').expect(201);
    await deposit(recipient, '999999999999999999.999999').expect(201);
    const key = randomUUID();

    await transfer(sender, recipient, '1', 'USDx', 'USDx', key).expect(422);
    expect(await amount(sender)).toBe('1.000000');
    expect(await amount(recipient)).toBe('999999999999999999.999999');

    const result = await database(app).query(
      'SELECT id FROM transactions WHERE source_wallet_id=$1',
      [sender],
    );

    expect(result.rowCount).toBe(0);
    // Free capacity and retry the failed key: rollback did not consume it.
    await transfer(recipient, sender, '1').expect(201);
    await transfer(sender, recipient, '1', 'USDx', 'USDx', key).expect(201);
  });
});

describe('transaction history', () => {
  it('includes incoming and outgoing activity once, with filtering and stable page order', async () => {
    const id = await wallet();
    const other = await wallet();
    const funded = await deposit(id, '10').expect(201);
    const exchanged = await swap(id, '2').expect(201);
    const sent = await transfer(id, other, '1').expect(201);
    const received = await transfer(other, id, '0.5', 'USDx', 'EURx').expect(201);

    const read = (query = '') =>
      request(app.getHttpServer()).get(`/wallets/${id}/transactions${query}`);

    const all = await read().expect(200);

    expect(all.body.meta.total).toBe(4);

    expect(all.body.data.map((t: { id: string }) => t.id)).toEqual([
      received.body.data.id,
      sent.body.data.id,
      exchanged.body.data.id,
      funded.body.data.id,
    ]);

    const page = await read('?limit=2&offset=1').expect(200);

    expect(page.body.meta).toMatchObject({ total: 4, limit: 2, offset: 1 });

    expect(page.body.data.map((t: { id: string }) => t.id)).toEqual([
      sent.body.data.id,
      exchanged.body.data.id,
    ]);

    const filtered = await read('?type=transfer&currency=EURx').expect(200);

    expect(filtered.body.meta.total).toBe(1);
    expect(filtered.body.data[0].id).toBe(received.body.data.id);
    const sourceCurrency = await read('?type=transfer&currency=USDx').expect(200);

    expect(sourceCurrency.body.meta.total).toBe(2);
    const beyond = await read('?offset=100').expect(200);

    expect(beyond.body).toMatchObject({ data: [], meta: { total: 4 } });

    const recipientHistory = await request(app.getHttpServer())
      .get(`/wallets/${other}/transactions`)
      .expect(200);

    expect(recipientHistory.body.data.map((t: { id: string }) => t.id)).toEqual([
      received.body.data.id,
      sent.body.data.id,
    ]);

    const detail = await request(app.getHttpServer())
      .get(`/transactions/${received.body.data.id}`)
      .expect(200);

    expect(detail.body.data).toEqual(received.body.data);
  });

  it('breaks timestamp ties by transaction ID descending', async () => {
    const id = await wallet();
    const db = database(app);

    await db.query(`CREATE FUNCTION test_transaction_time() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.created_at := '2026-10-01T00:00:00Z'; RETURN NEW; END $$`);

    let results;

    try {
      await db.query(`CREATE TRIGGER test_transaction_time BEFORE INSERT ON transactions
        FOR EACH ROW WHEN (NEW.destination_wallet_id='${id}'::uuid) EXECUTE FUNCTION test_transaction_time()`);

      results = await Promise.all(Array.from({ length: 3 }, () => deposit(id, '1')));
    } finally {
      await db.query('DROP TRIGGER IF EXISTS test_transaction_time ON transactions');
      await db.query('DROP FUNCTION test_transaction_time()');
    }

    const read = await request(app.getHttpServer())
      .get(`/wallets/${id}/transactions?limit=2&offset=1`)
      .expect(200);

    const ids = results
      .map((r) => r.body.data.id as string)
      .sort()
      .reverse()
      .slice(1);

    expect(read.body.data.map((t: { id: string }) => t.id)).toEqual(ids);
  });

  it('returns an empty history and rejects malformed queries or unknown records', async () => {
    const id = await wallet();

    const response = await request(app.getHttpServer())
      .get(`/wallets/${id}/transactions`)
      .expect(200);

    expect(response.body).toMatchObject({ data: [], meta: { total: 0, limit: 20, offset: 0 } });

    for (const query of [
      'limit=0',
      'limit=101',
      'offset=-1',
      'offset=1e3',
      'limit=2.5',
      'limit=1&limit=2',
      'offset=2147483648',
      'currency=BTC',
      'type=withdrawal',
      'sort=asc',
    ]) {
      await request(app.getHttpServer()).get(`/wallets/${id}/transactions?${query}`).expect(400);
    }

    await request(app.getHttpServer()).get(`/wallets/${randomUUID()}/transactions`).expect(404);
    await request(app.getHttpServer()).get(`/transactions/${randomUUID()}`).expect(404);
    await request(app.getHttpServer()).get('/transactions/invalid').expect(400);
  });
});
