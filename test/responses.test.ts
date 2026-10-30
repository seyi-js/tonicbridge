import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import SwaggerParser from '@apidevtools/swagger-parser';
import { OpenAPIV3 } from 'openapi-types';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import request, { Response } from 'supertest';
import { randomUUID } from 'node:crypto';
import { Sequelize } from 'sequelize-typescript';
import { createApp } from '../src/bootstrap';
import { ResponseError } from '../src/common/responses/api-response';

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
  const schema = (
    (operation.responses[String(response.status)] ??
      operation.responses.default) as OpenAPIV3.ResponseObject
  )?.content?.['application/json']?.schema;
  expect(schema, `Missing response contract for ${key}`).toBeDefined();
  const validate = validators.get(key) ?? ajv.compile(schema!);
  validators.set(key, validate);
  expect(validate(response.body), `${key}: ${JSON.stringify(validate.errors)}`).toBe(true);
  expect(response.body.statusCode).toBe(response.status);
}

it('keeps real endpoint responses compatible with the committed OpenAPI contract', async () => {
  const http = request(app.getHttpServer());
  contract('/health', 'get', await http.get('/health').expect(200));
  const created = await http
    .post('/wallets')
    .send({ email: `${randomUUID()}@example.com` })
    .expect(201);
  contract('/wallets', 'post', created);
  const id = created.body.data.id as string;
  const recipient = await http
    .post('/wallets')
    .send({ email: `${randomUUID()}@example.com` })
    .expect(201);
  contract('/wallets/{walletId}', 'get', await http.get(`/wallets/${id}`).expect(200));
  contract('/wallets', 'post', await http.post('/wallets').send({}).expect(400));
  contract(
    '/wallets',
    'post',
    await http.post('/wallets').send({ email: created.body.data.email }).expect(409),
  );
  const key = randomUUID();
  const deposit = await http
    .post(`/wallets/${id}/deposits`)
    .set('Idempotency-Key', key)
    .send({ currency: 'USDx', amount: '10' })
    .expect(201);
  contract('/wallets/{walletId}/deposits', 'post', deposit);
  const replay = await http
    .post(`/wallets/${id}/deposits`)
    .set('Idempotency-Key', key)
    .send({ currency: 'USDx', amount: '10' })
    .expect(200);
  contract('/wallets/{walletId}/deposits', 'post', replay);
  expect(deposit.headers['idempotency-replayed']).toBe('false');
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(replay.body.data).toEqual(deposit.body.data);
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
      .send({
        recipientWalletId: recipient.body.data.id,
        fromCurrency: 'USDx',
        toCurrency,
        amount: '1',
      })
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
    await http.get(`/transactions/${swap.body.data.id}`).expect(200),
  );
  contract(
    '/transactions/{transactionId}',
    'get',
    await http.get(`/transactions/${randomUUID()}`).expect(404),
  );
  const insufficient = await http
    .post(`/wallets/${id}/swaps`)
    .set('Idempotency-Key', randomUUID())
    .send({ fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '100' })
    .expect(422);
  contract('/wallets/{walletId}/swaps', 'post', insufficient);
  expect(insufficient.body.errors[0].code).toBe('INSUFFICIENT_FUNDS');
});

it('returns separate validation errors with body, query, parameter, and header locations', async () => {
  const http = request(app.getHttpServer());
  const invalid = await http
    .post('/wallets')
    .send({ email: 'bad', phone: 'bad', admin: true })
    .expect(400);
  contract('/wallets', 'post', invalid);
  expect(invalid.body).toMatchObject({
    statusCode: 400,
    message: 'Invalid request.',
    data: null,
    meta: {},
  });
  expect(invalid.body.errors.map((error: ResponseError) => error.field).sort()).toEqual([
    'body.admin',
    'body.email',
    'body.phone',
  ]);
  expect(
    invalid.body.errors.every(
      (error: ResponseError) => error.code === 'VALIDATION_ERROR' && error.message.length > 0,
    ),
  ).toBe(true);

  const id = randomUUID();
  const query = await http.get(`/wallets/${id}/transactions?limit=0&offset=-1`).expect(400);
  contract('/wallets/{walletId}/transactions', 'get', query);
  expect(query.body.errors.map((error: ResponseError) => error.field).sort()).toEqual([
    'query.limit',
    'query.offset',
  ]);

  const param = await http.get('/wallets/invalid').expect(400);
  contract('/wallets/{walletId}', 'get', param);
  expect(param.body.errors[0].field).toBe('walletId');

  const header = await http
    .post(`/wallets/${id}/deposits`)
    .send({ currency: 'USDx', amount: '1' })
    .expect(400);
  contract('/wallets/{walletId}/deposits', 'post', header);
  expect(header.body.errors[0].field).toBe('idempotency-key');
});

it('uses the same error format for malformed JSON and unknown routes without echoing input', async () => {
  const http = request(app.getHttpServer());
  const invalid = await http
    .post('/wallets')
    .set('Content-Type', 'application/json')
    .send('{"private-payload":')
    .expect(400);
  contract('/wallets', 'post', invalid);
  expect(invalid.body).toEqual({
    statusCode: 400,
    message: 'Bad Request',
    data: null,
    meta: {},
    errors: [{ code: 'HTTP_ERROR', message: 'Bad Request' }],
  });
  const missing = await http.get('/unknown-route').expect(404);
  const validate = ajv.compile(spec.components!.schemas!.Error!);
  expect(validate(missing.body)).toBe(true);
  expect(missing.body).toEqual({
    statusCode: 404,
    message: 'Not Found',
    data: null,
    meta: {},
    errors: [{ code: 'HTTP_ERROR', message: 'Not Found' }],
  });
});

it('preserves the unavailable status and error code when database readiness fails', async () => {
  const authenticate = vi
    .spyOn(app.get(Sequelize), 'authenticate')
    .mockRejectedValueOnce(new Error('private-database-error'));
  try {
    const response = await request(app.getHttpServer()).get('/health').expect(503);
    contract('/health', 'get', response);
    expect(response.body).toEqual({
      statusCode: 503,
      message: 'Database is unavailable.',
      data: null,
      meta: {},
      errors: [{ code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable.' }],
    });
  } finally {
    authenticate.mockRestore();
  }
});

it('keeps Swagger and the OpenAPI document in their native formats', async () => {
  const http = request(app.getHttpServer());
  const docs = await http.get('/openapi.json').expect(200);
  expect(docs.body.openapi).toBe('3.0.3');
  expect(docs.body.data).toBeUndefined();
  const ui = await http.get('/docs').expect(200).expect('Content-Type', /html/);
  expect(ui.text).toContain('swagger-ui');
});

it('publishes response examples that match the response schemas', () => {
  for (const path of Object.values(spec.paths)) {
    for (const operation of [path?.get, path?.post]) {
      for (const response of Object.values(operation?.responses ?? {})) {
        const media = (response as OpenAPIV3.ResponseObject).content?.['application/json'];
        if (media?.example) {
          const validate = ajv.compile(media.schema!);
          expect(validate(media.example), JSON.stringify(validate.errors)).toBe(true);
        }
      }
    }
  }
});
