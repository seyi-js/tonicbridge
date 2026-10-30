import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { database } from './helpers/database';
import { LedgerService } from '../src/modules/ledger/ledger.service';

let app: INestApplication;
beforeAll(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
});
afterAll(async () => {
  await app?.close();
});

async function wallet() {
  const response = await request(app.getHttpServer())
    .post('/wallets')
    .send({ email: `${randomUUID()}@example.com` })
    .expect(201);
  return response.body.data.id as string;
}
function write(id: string, route: string, body: object, key = randomUUID()) {
  return request(app.getHttpServer())
    .post(`/wallets/${id}/${route}`)
    .set('Idempotency-Key', key)
    .send(body);
}
async function journal(id: string) {
  const response = await request(app.getHttpServer()).get(`/transactions/${id}/ledger`).expect(200);
  expect(response.body.message).toBe('Ledger journal retrieved successfully.');
  return response.body.data as Awaited<ReturnType<LedgerService['get']>>;
}

describe('double-entry postings', () => {
  it('posts deposits and same-currency transfers with balanced funding and wallet entries', async () => {
    const a = await wallet();
    const b = await wallet();
    const deposit = await write(a, 'deposits', { currency: 'USDx', amount: '10.1' }).expect(201);
    const deposited = await journal(deposit.body.data.id);
    expect(
      deposited.entries.map(({ accountKind, walletId, currency, direction, amount }) => ({
        accountKind,
        walletId,
        currency,
        direction,
        amount,
      })),
    ).toEqual([
      {
        accountKind: 'funding',
        walletId: null,
        currency: 'USDx',
        direction: 'debit',
        amount: '10.100000',
      },
      {
        accountKind: 'wallet',
        walletId: a,
        currency: 'USDx',
        direction: 'credit',
        amount: '10.100000',
      },
    ]);
    const transfer = await write(a, 'transfers', {
      recipientWalletId: b,
      fromCurrency: 'USDx',
      toCurrency: 'USDx',
      amount: '3',
    }).expect(201);
    const sent = await journal(transfer.body.data.id);
    expect(sent.entries).toHaveLength(2);
    expect(sent.entries[0]).toMatchObject({ walletId: a, direction: 'debit', amount: '3.000000' });
    expect(sent.entries[1]).toMatchObject({ walletId: b, direction: 'credit', amount: '3.000000' });
    expect(
      (await database(app).query('SELECT * FROM ledger_reconciliation WHERE NOT matches')).rows,
    ).toEqual([]);
  });

  it('balances swaps and cross-currency transfers separately in both currencies', async () => {
    const a = await wallet();
    const b = await wallet();
    await write(a, 'deposits', { currency: 'USDx', amount: '10' }).expect(201);
    for (const [route, recipient] of [
      ['swaps', a],
      ['transfers', b],
    ] as const) {
      const response = await write(a, route, {
        ...(route === 'transfers' ? { recipientWalletId: recipient } : {}),
        fromCurrency: 'USDx',
        toCurrency: 'cNGN',
        amount: '2',
      }).expect(201);
      const result = await journal(response.body.data.id);
      expect(
        result.entries.map(({ accountKind, walletId, currency, direction, amount }) => ({
          accountKind,
          walletId,
          currency,
          direction,
          amount,
        })),
      ).toEqual([
        {
          accountKind: 'wallet',
          walletId: a,
          currency: 'USDx',
          direction: 'debit',
          amount: '2.000000',
        },
        {
          accountKind: 'fx',
          walletId: null,
          currency: 'USDx',
          direction: 'credit',
          amount: '2.000000',
        },
        {
          accountKind: 'fx',
          walletId: null,
          currency: 'cNGN',
          direction: 'debit',
          amount: '3200.000000',
        },
        {
          accountKind: 'wallet',
          walletId: recipient,
          currency: 'cNGN',
          direction: 'credit',
          amount: '3200.000000',
        },
      ]);
      const totals = await database(app).query(
        'SELECT currency,debits::text,credits::text FROM ledger_journal_totals WHERE journal_id=$1 ORDER BY currency',
        [result.id],
      );
      expect(totals.rows).toEqual([
        { currency: 'USDx', debits: '2.000000', credits: '2.000000' },
        { currency: 'cNGN', debits: '3200.000000', credits: '3200.000000' },
      ]);
    }
  });

  it('creates only one journal across concurrent retries and preserves exact decimal amounts', async () => {
    const id = await wallet();
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        write(id, 'deposits', { currency: 'USDx', amount: '9007199254740993.123456' }, key),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      200, 200, 200, 200, 200, 200, 200, 201,
    ]);
    const transactionId = results[0]!.body.data.id;
    const found = await database(app).query(
      'SELECT id FROM ledger_journals WHERE transaction_id=$1',
      [transactionId],
    );
    expect(found.rows).toHaveLength(1);
    const entries = await journal(transactionId);
    expect(entries.entries.map((entry) => entry.amount)).toEqual([
      '9007199254740993.123456',
      '9007199254740993.123456',
    ]);
  });

  it('rejects malformed and missing journal identifiers', async () => {
    await request(app.getHttpServer()).get('/transactions/invalid/ledger').expect(400);
    await request(app.getHttpServer()).get(`/transactions/${randomUUID()}/ledger`).expect(404);
  });
});

async function rawDeposit(
  id: string,
  transaction: Transaction,
  lines: Array<{ kind: string; currency: string; direction: string; amount: string }>,
) {
  const sql = (text: string, bind: unknown[]) =>
    app.get(Sequelize).query(text, { bind, transaction });
  const transactionId = randomUUID();
  const journalId = randomUUID();
  await sql(
    "INSERT INTO transactions(id,type,destination_wallet_id,source_currency,destination_currency,source_amount,destination_amount,rate) VALUES ($1,'deposit',$2,'USDx','USDx',1,1,1)",
    [transactionId, id],
  );
  await sql('INSERT INTO ledger_journals(id,transaction_id) VALUES ($1,$2)', [
    journalId,
    transactionId,
  ]);
  for (const [index, line] of lines.entries()) {
    await sql(
      `INSERT INTO ledger_entries(journal_id,line_number,account_id,currency,direction,amount)
      SELECT $1,$2,id,$3,$4,$5 FROM ledger_accounts WHERE kind=$6 AND currency=$3 AND wallet_id IS NOT DISTINCT FROM $7::uuid`,
      [
        journalId,
        index + 1,
        line.currency,
        line.direction,
        line.amount,
        line.kind,
        line.kind === 'wallet' ? id : null,
      ],
    );
  }
  return transactionId;
}

describe('database ledger constraints', () => {
  it('rejects empty, unbalanced, cross-currency-offset, and transaction-mismatched journals at commit', async () => {
    const id = await wallet();
    for (const lines of [
      [],
      [{ kind: 'funding', currency: 'USDx', direction: 'debit', amount: '1' }],
      [
        { kind: 'funding', currency: 'USDx', direction: 'debit', amount: '1' },
        { kind: 'wallet', currency: 'EURx', direction: 'credit', amount: '1' },
      ],
      [
        { kind: 'funding', currency: 'USDx', direction: 'debit', amount: '2' },
        { kind: 'wallet', currency: 'USDx', direction: 'credit', amount: '2' },
      ],
    ]) {
      await expect(
        app.get(Sequelize).transaction(async (transaction) => {
          await rawDeposit(id, transaction, lines);
        }),
      ).rejects.toMatchObject({ original: { code: '23514' } });
    }
    expect(
      (
        await database(app).query('SELECT id FROM transactions WHERE destination_wallet_id=$1', [
          id,
        ])
      ).rows,
    ).toEqual([]);
  });

  it('rejects unjournaled transactions and balance changes that disagree with ledger postings', async () => {
    const id = await wallet();
    await expect(
      database(app).query(
        "INSERT INTO transactions(type,destination_wallet_id,source_currency,destination_currency,source_amount,destination_amount,rate) VALUES ('deposit',$1,'USDx','USDx',1,1,1)",
        [id],
      ),
    ).rejects.toMatchObject({ original: { constraint: 'transaction_requires_journal' } });
    await expect(
      database(app).query("UPDATE balances SET amount=1 WHERE wallet_id=$1 AND currency='USDx'", [
        id,
      ]),
    ).rejects.toMatchObject({ original: { constraint: 'wallet_balance_matches_ledger' } });
    await expect(
      app.get(Sequelize).transaction(async (transaction) => {
        await rawDeposit(id, transaction, [
          { kind: 'funding', currency: 'USDx', direction: 'debit', amount: '1' },
          { kind: 'wallet', currency: 'USDx', direction: 'credit', amount: '1' },
        ]);
      }),
    ).rejects.toMatchObject({ original: { constraint: 'wallet_balance_matches_ledger' } });
  });

  it('prevents changes, deletions, truncation, and additional entries in committed journals', async () => {
    const id = await wallet();
    const deposited = await write(id, 'deposits', { currency: 'USDx', amount: '1' }).expect(201);
    const result = await journal(deposited.body.data.id);
    const db = database(app);
    for (const [sql, bind] of [
      ['UPDATE ledger_entries SET amount=2 WHERE journal_id=$1', [result.id]],
      ['DELETE FROM ledger_entries WHERE journal_id=$1', [result.id]],
      ['UPDATE ledger_journals SET recorded_at=clock_timestamp() WHERE id=$1', [result.id]],
      ['DELETE FROM ledger_journals WHERE id=$1', [result.id]],
      ["UPDATE ledger_accounts SET currency='EURx' WHERE id=$1", [result.entries[0]!.accountId]],
      ['DELETE FROM ledger_accounts WHERE id=$1', [result.entries[0]!.accountId]],
      ['UPDATE transactions SET source_amount=2 WHERE id=$1', [result.transactionId]],
      ['DELETE FROM transactions WHERE id=$1', [result.transactionId]],
      ['TRUNCATE ledger_entries', []],
    ] as Array<[string, unknown[]]>) {
      await expect(db.query(sql, bind)).rejects.toMatchObject({
        original: { constraint: 'ledger_append_only' },
      });
    }
    await expect(
      db.query(
        "INSERT INTO ledger_entries(journal_id,line_number,account_id,currency,direction,amount) VALUES ($1,3,$2,'USDx','debit',1)",
        [result.id, result.entries[0]!.accountId],
      ),
    ).rejects.toMatchObject({ original: { constraint: 'ledger_journal_sealed' } });
    expect(await journal(result.transactionId)).toEqual(result);
  });

  it('rolls back journals, entries, balances and transactions when the final idempotency write fails', async () => {
    const id = await wallet();
    const key = randomUUID();
    const db = database(app);
    await db.query(
      "CREATE FUNCTION test_ledger_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected final write failure'; END $$",
    );
    try {
      await db.query(
        `CREATE TRIGGER test_ledger_late_failure BEFORE INSERT ON idempotency_requests FOR EACH ROW WHEN (NEW.key='${key}') EXECUTE FUNCTION test_ledger_late_failure()`,
      );
      await write(id, 'deposits', { currency: 'USDx', amount: '10' }, key).expect(500);
      expect(
        (await db.query('SELECT id FROM transactions WHERE destination_wallet_id=$1', [id])).rows,
      ).toEqual([]);
      expect(
        (
          await db.query(
            'SELECT e.id FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id WHERE a.wallet_id=$1',
            [id],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (await db.query('SELECT key FROM idempotency_requests WHERE wallet_id=$1', [id])).rows,
      ).toEqual([]);
      expect(
        (
          await db.query(
            'SELECT stored_balance::text FROM ledger_reconciliation WHERE wallet_id=$1',
            [id],
          )
        ).rows.every((row) => row.stored_balance === '0.000000'),
      ).toBe(true);
    } finally {
      await db.query('DROP TRIGGER IF EXISTS test_ledger_late_failure ON idempotency_requests');
      await db.query('DROP FUNCTION test_ledger_late_failure()');
    }
    const retry = await write(id, 'deposits', { currency: 'USDx', amount: '10' }, key).expect(201);
    expect((await journal(retry.body.data.id)).entries).toHaveLength(2);
  });
});
