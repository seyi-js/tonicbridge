import { afterEach, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { currencies } from '../src/common/money';
import { database } from './helpers/database';

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
});

it('reads pre-ORM rows after restart and replays a legacy request without crediting it again', async () => {
  app = await createApp();
  const db = database(app);
  const walletId = randomUUID();
  const transactionId = randomUUID();
  const key = randomUUID();
  const amount = '9007199254740993.123456';
  const createdAt = '2026-10-29T12:00:00.000Z';
  const email = `legacy-${randomUUID()}@example.com`;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(['deposit', walletId, walletId, 'USDx', 'USDx', amount]))
    .digest('hex');
  // Seed the published SQL representation directly, without Sequelize model defaults or mapping.
  await db.query('INSERT INTO wallets(id,email,created_at) VALUES ($1,$2,$3)', [
    walletId,
    email,
    createdAt,
  ]);
  for (const currency of currencies) {
    await db.query('INSERT INTO balances(wallet_id,currency,amount) VALUES ($1,$2,$3)', [
      walletId,
      currency,
      currency === 'USDx' ? amount : '0',
    ]);
  }
  await db.query(
    `INSERT INTO transactions(id,type,destination_wallet_id,source_currency,destination_currency,source_amount,destination_amount,rate,created_at)
    VALUES ($1,'deposit',$2,'USDx','USDx',$3,$3,1,$4)`,
    [transactionId, walletId, amount, createdAt],
  );
  await db.query(
    'INSERT INTO idempotency_requests(wallet_id,key,fingerprint,transaction_id) VALUES ($1,$2,$3,$4)',
    [walletId, key, fingerprint, transactionId],
  );
  const migrationsBefore = await db.query(
    'SELECT name,applied_at FROM schema_migrations ORDER BY name',
  );
  await app.close();
  app = undefined;

  app = await createApp();
  await app.listen(0, '127.0.0.1');
  const http = request(app.getHttpServer());
  const wallet = await http.get(`/wallets/${walletId}`).expect(200);
  expect(wallet.body).toEqual({ id: walletId, email, phone: null, createdAt });
  const replay = await http
    .post(`/wallets/${walletId}/deposits`)
    .set('Idempotency-Key', key)
    .send({ currency: 'USDx', amount })
    .expect(200);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(replay.body).toMatchObject({
    id: transactionId,
    sourceAmount: amount,
    destinationAmount: amount,
    createdAt,
  });
  const balance = await http.get(`/wallets/${walletId}/balances`).expect(200);
  expect(balance.body.totalUsd).toBe(amount);
  const history = await http.get(`/wallets/${walletId}/transactions`).expect(200);
  expect(history.body.total).toBe(1);
  expect(history.body.items[0]).toEqual(replay.body);
  const migrationsAfter = await database(app).query(
    'SELECT name,applied_at FROM schema_migrations ORDER BY name',
  );
  expect(migrationsAfter.rows).toEqual(migrationsBefore.rows);
});
