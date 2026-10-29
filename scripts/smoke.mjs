import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function smoke(baseUrl) {
  async function call(path, status, body, key) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    assert.equal(response.status, status, `${path}: ${JSON.stringify(data)}`);
    return data;
  }
  assert.deepEqual(await call('/health', 200), { status: 'ok' });
  const a = await call('/wallets', 201, { email: `${randomUUID()}@example.com` });
  const b = await call('/wallets', 201, { email: `${randomUUID()}@example.com` });
  const key = randomUUID();
  const deposit = await call(
    `/wallets/${a.id}/deposits`,
    201,
    { currency: 'USDx', amount: '100' },
    key,
  );
  const replay = await call(
    `/wallets/${a.id}/deposits`,
    200,
    { currency: 'USDx', amount: '100.000000' },
    key,
  );
  assert.deepEqual(replay, deposit);
  const swap = await call(
    `/wallets/${a.id}/swaps`,
    201,
    {
      fromCurrency: 'USDx',
      toCurrency: 'cNGN',
      amount: '10',
    },
    randomUUID(),
  );
  const transfer = await call(
    `/wallets/${a.id}/transfers`,
    201,
    {
      recipientWalletId: b.id,
      fromCurrency: 'USDx',
      toCurrency: 'EURx',
      amount: '5',
    },
    randomUUID(),
  );
  const balances = await call(`/wallets/${a.id}/balances`, 200);
  assert.equal(balances.balances.find((row) => row.currency === 'USDx').amount, '85.000000');
  assert.equal(
    balances.balances.find((row) => row.currency === 'cNGN').amount,
    swap.destinationAmount,
  );
  const received = await call(`/wallets/${b.id}/balances`, 200);
  assert.equal(
    received.balances.find((row) => row.currency === 'EURx').amount,
    transfer.destinationAmount,
  );
  const history = await call(
    `/wallets/${a.id}/transactions?type=transfer&currency=EURx&limit=1`,
    200,
  );
  assert.equal(history.total, 1);
  assert.deepEqual(history.items[0], transfer);
  assert.deepEqual(await call(`/transactions/${transfer.id}`, 200), transfer);
  const rates = await call('/rates', 200);
  assert.equal(rates.rates.length, 25);
  assert.equal(rates.source, swap.rateSource);
  const docs = await call('/openapi.json', 200);
  assert.equal(docs.info.title, 'TonicBridge');
  return { rateSource: swap.rateSource, rate: swap.rate, convertedAmount: swap.destinationAmount };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await smoke(process.env.BASE_URL ?? 'http://localhost:3000');
  console.log('HTTP smoke passed:', result);
}
