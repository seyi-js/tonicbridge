import { expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { database } from './helpers/database';

it('preserves wallets, exact balances, journals and idempotent retries across an application restart', async () => {
  let app: INestApplication | undefined;

  try {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    const http = request(app.getHttpServer());

    const wallet = await http
      .post('/wallets')
      .send({ email: `${randomUUID()}@example.com` })
      .expect(201);

    const walletId = wallet.body.data.id as string;
    const key = randomUUID();
    const amount = '9007199254740993.123456';

    const deposit = await http
      .post(`/wallets/${walletId}/deposits`)
      .set('Idempotency-Key', key)
      .send({ currency: 'USDx', amount })
      .expect(201);

    const transactionId = deposit.body.data.id as string;
    const journal = await http.get(`/transactions/${transactionId}/ledger`).expect(200);

    expect(journal.body.data.entries).toHaveLength(2);
    expect(journal.body.data.entries[0].amount).toBe(amount);
    const balances = await http.get(`/wallets/${walletId}/balances`).expect(200);
    const migrations = await database(app).query('SELECT * FROM schema_migrations ORDER BY name');

    expect(migrations.rows.map((row) => row.name)).toEqual(['001-initial.sql']);

    await app.close();
    app = undefined;
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    const restarted = request(app.getHttpServer());

    expect((await restarted.get(`/wallets/${walletId}`).expect(200)).body.data).toEqual(
      wallet.body.data,
    );

    expect((await restarted.get(`/transactions/${transactionId}`).expect(200)).body.data).toEqual(
      deposit.body.data,
    );

    const replay = await restarted
      .post(`/wallets/${walletId}/deposits`)
      .set('Idempotency-Key', key)
      .send({ currency: 'USDx', amount })
      .expect(200);

    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toEqual(deposit.body.data);

    expect((await restarted.get(`/wallets/${walletId}/balances`).expect(200)).body.data).toEqual(
      balances.body.data,
    );

    expect(
      (await restarted.get(`/transactions/${transactionId}/ledger`).expect(200)).body.data,
    ).toEqual(journal.body.data);

    expect(
      (await database(app).query('SELECT * FROM schema_migrations ORDER BY name')).rows,
    ).toEqual(migrations.rows);

    expect(
      (
        await database(app).query('SELECT id FROM transactions WHERE destination_wallet_id=$1', [
          walletId,
        ])
      ).rows,
    ).toEqual([{ id: transactionId }]);
  } finally {
    await app?.close();
  }
});
