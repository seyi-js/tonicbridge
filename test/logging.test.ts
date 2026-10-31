import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Request, Response } from 'express';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { AppLogger, LogFields } from '../src/common/logging/app-logger';
import { RequestContext } from '../src/common/logging/request-context';
import { RequestLoggingMiddleware } from '../src/common/logging/request-logging.middleware';
import { readConfig } from '../src/config/app-config';
import { database } from './helpers/database';

interface LogEntry extends LogFields {
  event: string;

  level: string;

  requestId?: string;
}

let app: INestApplication;
const lines: string[] = [];

beforeAll(async () => {
  const previous = process.env.LOG_LEVEL;

  process.env.LOG_LEVEL = 'debug';

  try {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
  } finally {
    process.env.LOG_LEVEL = previous;
  }
});

beforeEach(() => {
  lines.length = 0;
  vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(line));
});

afterEach(() => vi.restoreAllMocks());
afterAll(async () => app?.close());

function logs(requestId?: string): LogEntry[] {
  const entries = lines.map((line) => JSON.parse(line) as LogEntry);

  return requestId ? entries.filter((entry) => entry.requestId === requestId) : entries;
}

async function wallet() {
  const response = await request(app.getHttpServer())
    .post('/wallets')
    .send({ email: `${randomUUID()}@example.com` })
    .expect(201);

  return response.body.data.id as string;
}

function deposit(id: string, key = randomUUID(), amount = '10') {
  return request(app.getHttpServer())
    .post(`/wallets/${id}/deposits`)
    .set('Idempotency-Key', key)
    .send({ currency: 'USDx', amount });
}

it('correlates cross-currency posting, commit and HTTP completion with the persisted journal', async () => {
  const sender = await wallet();
  const recipient = await wallet();

  await deposit(sender).expect(201);
  lines.length = 0;

  const response = await request(app.getHttpServer())
    .post(`/wallets/${sender}/transfers`)
    .set('Idempotency-Key', randomUUID())
    .send({ recipientWalletId: recipient, fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '2' })
    .expect(201);

  const trace = logs(response.headers['x-request-id']);
  const events = trace.map((entry) => entry.event);
  const prepared = trace.find((entry) => entry.event === 'ledger.posting.prepared')!;
  const committed = trace.find((entry) => entry.event === 'transaction.committed')!;

  expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  expect(events[0]).toBe('http.request.started');

  expect(prepared).toMatchObject({
    transactionId: response.body.data.id,
    entryCount: 4,
    balanceCount: 2,
  });

  expect(committed).toMatchObject({
    transactionId: response.body.data.id,
    journalId: prepared.journalId,
  });

  expect(events.indexOf('ledger.posting.prepared')).toBeLessThan(
    events.indexOf('transaction.committed'),
  );

  expect(events.indexOf('transaction.committed')).toBeLessThan(
    events.indexOf('http.request.completed'),
  );

  expect(trace.at(-1)).toMatchObject({
    event: 'http.request.completed',
    statusCode: 201,
    route: '/wallets/:walletId/transfers',
    journalId: prepared.journalId,
  });

  expect(trace.find((entry) => entry.event === 'wallet.locks_acquired')).toMatchObject({
    walletCount: 2,
    waitMs: expect.any(Number),
  });

  const journal = await request(app.getHttpServer())
    .get(`/transactions/${response.body.data.id}/ledger`)
    .expect(200);

  expect(journal.body.data.id).toBe(prepared.journalId);
  expect(app.get(RequestContext).current()).toBeUndefined();
});

it('isolates concurrent requests and records duplicate retries without another committed posting', async () => {
  const a = await wallet();
  const b = await wallet();
  const key = randomUUID();

  lines.length = 0;

  const responses = await Promise.all([
    deposit(a, key),
    deposit(a, key),
    deposit(a, key),
    deposit(b),
  ]);

  expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 201, 201]);
  expect(new Set(responses.map((response) => response.headers['x-request-id'])).size).toBe(4);

  for (const response of responses) {
    const trace = logs(response.headers['x-request-id']);

    expect(
      trace
        .filter((entry) => entry.transactionId)
        .every((entry) => entry.transactionId === response.body.data.id),
    ).toBe(true);

    expect(trace.filter((entry) => entry.event === 'http.request.completed')).toHaveLength(1);

    if (response.status === 200) {
      expect(trace.some((entry) => entry.event === 'transaction.replayed')).toBe(true);
      expect(trace.some((entry) => entry.event === 'ledger.posting.started')).toBe(false);
      expect(trace.some((entry) => entry.event === 'transaction.committed')).toBe(false);
      expect(trace.every((entry) => entry.journalId === undefined)).toBe(true);
    }
  }

  expect(logs().filter((entry) => entry.event === 'transaction.committed')).toHaveLength(2);
});

it('logs an idempotency conflict without exposing the request key', async () => {
  const id = await wallet();
  const key = randomUUID();
  const original = await deposit(id, key).expect(201);

  lines.length = 0;

  const response = await deposit(id, key, '11').expect(409);

  expect(logs(response.headers['x-request-id'])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: 'transaction.idempotency_conflict',
        transactionId: original.body.data.id,
      }),
      expect.objectContaining({ event: 'http.request.failed', errorCode: 'IDEMPOTENCY_CONFLICT' }),
    ]),
  );

  expect(lines.join('\n')).not.toContain(key);
  expect(logs().some((entry) => entry.event === 'transaction.committed')).toBe(false);
});

it('records a rollback attempt on a final-write failure without logging a committed transaction', async () => {
  const id = await wallet();
  const key = randomUUID();
  const db = database(app);

  await db.query(
    "CREATE FUNCTION trace_reject_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-database-details'; END $$",
  );

  try {
    await db.query(
      `CREATE TRIGGER trace_reject_write BEFORE INSERT ON idempotency_requests FOR EACH ROW WHEN (NEW.key='${key}') EXECUTE FUNCTION trace_reject_write()`,
    );

    lines.length = 0;
    const response = await deposit(id, key).expect(500);
    const trace = logs(response.headers['x-request-id']);

    expect(trace.some((entry) => entry.event === 'ledger.posting.prepared')).toBe(true);
    expect(trace.some((entry) => entry.event === 'transaction.committed')).toBe(false);

    expect(trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'transaction.failed',
          phase: 'work',
          outcome: 'rollback_attempted',
          errorCode: 'DATABASE_ERROR',
          dbCode: 'P0001',
        }),
      ]),
    );

    expect(
      (await db.query('SELECT id FROM transactions WHERE destination_wallet_id=$1', [id])).rows,
    ).toEqual([]);

    expect(
      (await db.query('SELECT amount FROM balances WHERE wallet_id=$1', [id])).rows.every(
        (row) => row.amount === '0.000000',
      ),
    ).toBe(true);

    expect(lines.join('\n')).not.toContain('private-database-details');
    expect(lines.join('\n')).not.toContain(key);
  } finally {
    await db.query('DROP TRIGGER IF EXISTS trace_reject_write ON idempotency_requests');
    await db.query('DROP FUNCTION trace_reject_write()');
  }
});

it('never emits commit success when a deferred database constraint rejects COMMIT', async () => {
  const id = await wallet();
  const db = database(app);

  await db.query(
    "CREATE FUNCTION trace_reject_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected commit rejection' USING ERRCODE='23514', CONSTRAINT='trace_commit_constraint'; END $$",
  );

  try {
    await db.query(
      `CREATE CONSTRAINT TRIGGER trace_reject_commit AFTER INSERT ON transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.destination_wallet_id='${id}'::uuid) EXECUTE FUNCTION trace_reject_commit()`,
    );

    lines.length = 0;
    const response = await deposit(id).expect(500);
    const trace = logs(response.headers['x-request-id']);

    expect(trace.some((entry) => entry.event === 'ledger.posting.prepared')).toBe(true);
    expect(trace.some((entry) => entry.event === 'transaction.committed')).toBe(false);

    expect(trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'transaction.failed',
          phase: 'commit',
          outcome: 'unknown',
          dbCode: '23514',
          constraint: 'trace_commit_constraint',
        }),
      ]),
    );

    expect(
      (await db.query('SELECT id FROM transactions WHERE destination_wallet_id=$1', [id])).rows,
    ).toEqual([]);
  } finally {
    await db.query('DROP TRIGGER IF EXISTS trace_reject_commit ON transactions');
    await db.query('DROP FUNCTION trace_reject_commit()');
  }
});

it('correlates malformed JSON and unmatched routes without logging bodies, URLs, or arbitrary request IDs', async () => {
  const http = request(app.getHttpServer());
  const secret = 'private-contact@example.com';

  const malformed = await http
    .post('/wallets')
    .set('Content-Type', 'application/json')
    .set('X-Request-ID', secret)
    .send(`{"${secret}":`)
    .expect(400);

  const unknown = await http.get(`/unknown/${secret}?token=private-token`).expect(404);

  for (const response of [malformed, unknown]) {
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const trace = logs(response.headers['x-request-id']);

    expect(trace.some((entry) => entry.event === 'http.request.started')).toBe(true);

    expect(trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'http.request.failed', statusCode: response.status }),
      ]),
    );

    expect(trace.at(-1)?.event).toBe('http.request.completed');
  }

  expect(lines.join('\n')).not.toContain(secret);
  expect(lines.join('\n')).not.toContain('private-token');
});

it('filters detailed logs at info level and keeps successful money writes independent of log output', async () => {
  const logger = new AppLogger(readConfig({ LOG_LEVEL: 'info' }), new RequestContext());

  logger.debug('debug-hidden');
  logger.info('info-visible');
  expect(logs().map((entry) => entry.event)).toEqual(['info-visible']);

  const id = await wallet();

  vi.mocked(console.log).mockImplementation(() => {
    throw new Error('log sink unavailable');
  });

  const response = await deposit(id).expect(201);

  expect(
    (await database(app).query('SELECT id FROM transactions WHERE id=$1', [response.body.data.id]))
      .rows,
  ).toHaveLength(1);
});

it('records a prematurely closed response once without claiming the transaction rolled back', () => {
  const response = Object.assign(new EventEmitter(), {
    setHeader: vi.fn(),
    writableFinished: false,
    statusCode: 200,
  });

  app
    .get(RequestLoggingMiddleware)
    .use({ method: 'POST' } as Request, response as unknown as Response, () => {});

  response.emit('close');
  response.emit('finish');

  expect(logs().map((entry) => entry.event)).toEqual([
    'http.request.started',
    'http.request.aborted',
  ]);

  expect(logs()[1]?.statusCode).toBeUndefined();
  expect(app.get(RequestContext).current()).toBeUndefined();
});
