import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/bootstrap';
import { database } from './helpers/database';

let first: INestApplication;
let second: INestApplication;
beforeAll(async () => {
  // Separate pools and service instances; correctness must not rely on an in-process mutex.
  [first, second] = await Promise.all([createApp(), createApp()]);
  await Promise.all([first.listen(0, '127.0.0.1'), second.listen(0, '127.0.0.1')]);
});
afterAll(async () => {
  await Promise.all([first?.close(), second?.close()]);
});
async function wallet() {
  const response = await request(first.getHttpServer())
    .post('/wallets')
    .send({ email: `${randomUUID()}@example.com` })
    .expect(201);
  return response.body.data.id as string;
}
function write(app: INestApplication, id: string, route: string, body: object, key = randomUUID()) {
  return request(app.getHttpServer())
    .post(`/wallets/${id}/${route}`)
    .set('Idempotency-Key', key)
    .send(body);
}
async function balance(id: string, currency = 'USDx') {
  const rows = await database(first).query(
    'SELECT amount FROM balances WHERE wallet_id=$1 AND currency=$2',
    [id, currency],
  );
  return rows.rows[0]!.amount as string;
}
const move = (recipientWalletId: string, amount = '1') => ({
  recipientWalletId,
  fromCurrency: 'USDx',
  toCurrency: 'USDx',
  amount,
});

describe('financial safety across independent API instances', () => {
  it('prevents mixed swaps and transfers from overspending a shared source balance', async () => {
    const source = await wallet();
    const recipient = await wallet();
    await write(first, source, 'deposits', { currency: 'USDx', amount: '100' }).expect(201);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        i % 2
          ? write(first, source, 'swaps', {
              fromCurrency: 'USDx',
              toCurrency: 'cNGN',
              amount: '30',
            })
          : write(second, source, 'transfers', move(recipient, '30')),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(17);
    expect(await balance(source)).toBe('10.000000');
    const spent = await database(first).query(
      'SELECT sum(source_amount)::text AS amount FROM transactions WHERE source_wallet_id=$1',
      [source],
    );
    expect(spent.rows[0]!.amount).toBe('90.000000');
    // Reconstruct every balance from persisted credits and debits, independently of the service.
    const mismatches = await database(first).query(
      `
      WITH totals AS (
        SELECT a.wallet_id,a.currency,sum(CASE WHEN e.direction='credit' THEN e.amount ELSE -e.amount END) AS amount
        FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id
        WHERE a.kind='wallet' GROUP BY a.wallet_id,a.currency
      )
      SELECT b.* FROM balances b LEFT JOIN totals t USING(wallet_id,currency)
      WHERE b.wallet_id=ANY($1::uuid[]) AND b.amount<>coalesce(t.amount,0)`,
      [[source, recipient]],
    );
    expect(mismatches.rowCount).toBe(0);
    expect(
      (await database(first).query('SELECT * FROM ledger_journal_totals WHERE debits<>credits'))
        .rowCount,
    ).toBe(0);
  });
  it('completes opposing transfers without deadlocks or lost money', async () => {
    const a = await wallet();
    const b = await wallet();
    await write(first, a, 'deposits', { currency: 'USDx', amount: '100' }).expect(201);
    await write(second, b, 'deposits', { currency: 'USDx', amount: '100' }).expect(201);
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        i % 2 ? write(first, a, 'transfers', move(b)) : write(second, b, 'transfers', move(a)),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await balance(a)).toBe('100.000000');
    expect(await balance(b)).toBe('100.000000');
  });
  it('resolves a concurrent same-key conflict consistently across operation types', async () => {
    const a = await wallet();
    const b = await wallet();
    await write(first, a, 'deposits', { currency: 'USDx', amount: '10' }).expect(201);
    const key = randomUUID();
    const results = await Promise.all([
      write(first, a, 'swaps', { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '5' }, key),
      write(second, a, 'transfers', move(b, '5'), key),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await balance(a)).toBe('5.000000');
    const history = await request(second.getHttpServer())
      .get(`/wallets/${a}/transactions`)
      .expect(200);
    expect(history.body.meta.total).toBe(2);
  });
  it('leaves balances unchanged when transaction insertion fails and allows the same key to retry', async () => {
    const a = await wallet();
    const b = await wallet();
    await write(first, a, 'deposits', { currency: 'USDx', amount: '10' }).expect(201);
    const db = database(first);
    const key = randomUUID();
    // A scoped PostgreSQL trigger injects a real transaction storage error.
    await db.query(`CREATE FUNCTION test_reject_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected transaction storage failure'; END $$`);
    try {
      await db.query(`CREATE TRIGGER test_storage_failure BEFORE INSERT ON transactions
        FOR EACH ROW WHEN (NEW.source_wallet_id='${a}'::uuid) EXECUTE FUNCTION test_reject_transaction()`);
      const failed = await write(first, a, 'transfers', move(b, '4'), key).expect(500);
      expect(failed.body).toEqual({
        statusCode: 500,
        message: 'The request could not be completed.',
        data: null,
        meta: {},
        errors: [{ code: 'INTERNAL_ERROR', message: 'The request could not be completed.' }],
      });
      expect(await balance(a)).toBe('10.000000');
      expect(await balance(b)).toBe('0.000000');
      const keys = await db.query(
        'SELECT key FROM idempotency_requests WHERE wallet_id=$1 AND key=$2',
        [a, key],
      );
      expect(keys.rowCount).toBe(0);
      const transactions = await db.query('SELECT id FROM transactions WHERE source_wallet_id=$1', [
        a,
      ]);
      expect(transactions.rowCount).toBe(0);
    } finally {
      await db.query('DROP TRIGGER IF EXISTS test_storage_failure ON transactions');
      await db.query('DROP FUNCTION test_reject_transaction()');
    }
    await write(second, a, 'transfers', move(b, '4'), key).expect(201);
    expect(await balance(a)).toBe('6.000000');
    expect(await balance(b)).toBe('4.000000');
  });
});
