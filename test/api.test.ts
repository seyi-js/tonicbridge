import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';
import { Database } from '../src/database';
import { randomUUID } from 'node:crypto';

let app: INestApplication;
beforeAll(async () => {
  app = await createApp();
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
