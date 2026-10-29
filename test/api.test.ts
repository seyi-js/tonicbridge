import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';

let app: INestApplication;
beforeAll(async () => {
  app = await createApp();
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
