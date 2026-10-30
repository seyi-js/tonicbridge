import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
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
    assert.equal(data.statusCode, response.status);
    assert.equal(typeof data.message, 'string');
    assert.ok(data.message.length > 0);
    assert.deepEqual(data.errors, []);
    assert.deepEqual(Object.keys(data).sort(), ['data', 'errors', 'message', 'meta', 'statusCode']);
    return data;
  }
  assert.deepEqual((await call('/health', 200)).data, { status: 'ok' });
  const a = await call('/wallets', 201, { email: `${randomUUID()}@example.com` });
  const b = await call('/wallets', 201, { email: `${randomUUID()}@example.com` });
  const key = randomUUID();
  const deposit = await call(
    `/wallets/${a.data.id}/deposits`,
    201,
    { currency: 'USDx', amount: '100' },
    key,
  );
  const replay = await call(
    `/wallets/${a.data.id}/deposits`,
    200,
    { currency: 'USDx', amount: '100.000000' },
    key,
  );
  assert.deepEqual(replay.data, deposit.data);
  assert.equal(deposit.message, 'Deposit completed successfully.');
  assert.equal(replay.message, deposit.message);
  const swap = await call(
    `/wallets/${a.data.id}/swaps`,
    201,
    {
      fromCurrency: 'USDx',
      toCurrency: 'cNGN',
      amount: '10',
    },
    randomUUID(),
  );
  const transfer = await call(
    `/wallets/${a.data.id}/transfers`,
    201,
    {
      recipientWalletId: b.data.id,
      fromCurrency: 'USDx',
      toCurrency: 'EURx',
      amount: '5',
    },
    randomUUID(),
  );
  assert.equal(swap.message, 'Swap completed successfully.');
  assert.equal(transfer.message, 'Transfer completed successfully.');
  for (const movement of [deposit, swap, transfer]) {
    const journal = await call(`/transactions/${movement.data.id}/ledger`, 200);
    assert.equal(journal.data.transactionId, movement.data.id);
    assert.equal(journal.message, 'Ledger journal retrieved successfully.');
    const totals = new Map();
    for (const entry of journal.data.entries) {
      const amount = BigInt(entry.amount.replace('.', ''));
      const delta = entry.direction === 'debit' ? amount : -amount;
      totals.set(entry.currency, (totals.get(entry.currency) ?? 0n) + delta);
    }
    assert.ok(journal.data.entries.length >= 2);
    for (const total of totals.values()) assert.equal(total, 0n);
  }
  const balances = await call(`/wallets/${a.data.id}/balances`, 200);
  assert.equal(balances.data.balances.find((row) => row.currency === 'USDx').amount, '85.000000');
  assert.equal(
    balances.data.balances.find((row) => row.currency === 'cNGN').amount,
    swap.data.destinationAmount,
  );
  const received = await call(`/wallets/${b.data.id}/balances`, 200);
  assert.equal(
    received.data.balances.find((row) => row.currency === 'EURx').amount,
    transfer.data.destinationAmount,
  );
  const history = await call(
    `/wallets/${a.data.id}/transactions?type=transfer&currency=EURx&limit=1`,
    200,
  );
  assert.equal(history.meta.total, 1);
  assert.equal(history.message, 'Transactions retrieved successfully.');
  assert.deepEqual(history.data[0], transfer.data);
  assert.deepEqual((await call(`/transactions/${transfer.data.id}`, 200)).data, transfer.data);
  const rates = await call('/rates', 200);
  assert.equal(rates.data.rates.length, 25);
  assert.equal(rates.data.source, swap.data.rateSource);
  const docsResponse = await fetch(`${baseUrl}/openapi.json`, {
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(docsResponse.status, 200);
  const docs = await docsResponse.json();
  assert.equal(docs.info.title, 'TonicBridge');
  return {
    rateSource: swap.data.rateSource,
    rate: swap.data.rate,
    convertedAmount: swap.data.destinationAmount,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const result = await smoke(process.env.BASE_URL ?? 'http://localhost:3000');
  console.log('HTTP smoke passed:', result);
}
