import { afterAll, beforeAll, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import SwaggerParser from '@apidevtools/swagger-parser';
import { OpenAPIV3 } from 'openapi-types';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import request, { Response } from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/bootstrap';

let app: INestApplication;
let spec: OpenAPIV3.Document;
const ajv = addFormats(new Ajv({ strict: false, allErrors: true }));
const validators = new Map<string, ValidateFunction>();
beforeAll(async () => {
  spec = (await SwaggerParser.dereference('docs/openapi.json')) as OpenAPIV3.Document;
  app = await createApp();
  await app.listen(0, '127.0.0.1');
});
afterAll(async () => {
  await app?.close();
});
function contract(path: string, method: 'get' | 'post', response: Response) {
  const key = `${method} ${path} ${response.status}`;
  const operation = spec.paths[path]![method]!;
  const schema = (operation.responses[String(response.status)] as OpenAPIV3.ResponseObject)
    ?.content?.['application/json']?.schema;
  expect(schema, `Missing response contract for ${key}`).toBeDefined();
  const validate = validators.get(key) ?? ajv.compile(schema!);
  validators.set(key, validate);
  expect(validate(response.body), `${key}: ${JSON.stringify(validate.errors)}`).toBe(true);
}

it('keeps real endpoint responses compatible with the committed OpenAPI contract', async () => {
  const http = request(app.getHttpServer());
  contract('/health', 'get', await http.get('/health').expect(200));
  const created = await http
    .post('/wallets')
    .send({ email: `${randomUUID()}@example.com` })
    .expect(201);
  contract('/wallets', 'post', created);
  const id = created.body.id as string;
  const recipient = await http
    .post('/wallets')
    .send({ email: `${randomUUID()}@example.com` })
    .expect(201);
  contract('/wallets/{walletId}', 'get', await http.get(`/wallets/${id}`).expect(200));
  contract('/wallets', 'post', await http.post('/wallets').send({}).expect(400));
  contract(
    '/wallets',
    'post',
    await http.post('/wallets').send({ email: created.body.email }).expect(409),
  );
  const key = randomUUID();
  const deposit = await http
    .post(`/wallets/${id}/deposits`)
    .set('Idempotency-Key', key)
    .send({ currency: 'USDx', amount: '10' })
    .expect(201);
  contract('/wallets/{walletId}/deposits', 'post', deposit);
  contract(
    '/wallets/{walletId}/deposits',
    'post',
    await http
      .post(`/wallets/${id}/deposits`)
      .set('Idempotency-Key', key)
      .send({ currency: 'USDx', amount: '10' })
      .expect(200),
  );
  const swap = await http
    .post(`/wallets/${id}/swaps`)
    .set('Idempotency-Key', randomUUID())
    .send({ fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '1' })
    .expect(201);
  contract('/wallets/{walletId}/swaps', 'post', swap);
  for (const toCurrency of ['USDx', 'EURx']) {
    const transfer = await http
      .post(`/wallets/${id}/transfers`)
      .set('Idempotency-Key', randomUUID())
      .send({ recipientWalletId: recipient.body.id, fromCurrency: 'USDx', toCurrency, amount: '1' })
      .expect(201);
    contract('/wallets/{walletId}/transfers', 'post', transfer);
  }
  contract(
    '/wallets/{walletId}/balances',
    'get',
    await http.get(`/wallets/${id}/balances`).expect(200),
  );
  contract('/rates', 'get', await http.get('/rates').expect(200));
  contract(
    '/wallets/{walletId}/transactions',
    'get',
    await http.get(`/wallets/${id}/transactions`).expect(200),
  );
  contract(
    '/transactions/{transactionId}',
    'get',
    await http.get(`/transactions/${swap.body.id}`).expect(200),
  );
  contract(
    '/transactions/{transactionId}',
    'get',
    await http.get(`/transactions/${randomUUID()}`).expect(404),
  );
});
