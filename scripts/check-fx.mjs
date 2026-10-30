import assert from 'node:assert/strict';
import { createApp } from '../dist/bootstrap.js';
import { smoke } from './smoke.mjs';

// Requires the local Postman simulation and PostgreSQL. Uses the real API and its native fetch adapter.
const simulation = process.env.SIMULATION_URL ?? 'http://127.0.0.1:4900';
for (const [route, expectedSource, expectedRate, expectedAmount] of [
  ['fx', 'live', '1500.000000000000', '15000.000000'],
  ['fx-error', 'fixed', '1600.000000000000', '16000.000000'],
  ['fx-slow', 'fixed', '1600.000000000000', '16000.000000'],
]) {
  process.env.FX_MODE = 'live';
  process.env.FX_BASE_URL = `${simulation}/${route}`;
  process.env.FX_TIMEOUT_MS = '250';
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    console.log(`${route}: API listening at ${url}`);
    const start = Date.now();
    const result = await smoke(url);
    assert.equal(result.rateSource, expectedSource);
    assert.equal(result.rate, expectedRate);
    assert.equal(result.convertedAmount, expectedAmount);
    assert.ok(
      Date.now() - start < 2000,
      'Provider delay must be bounded by the configured timeout',
    );
    console.log(
      `${route}: passed; source=${result.rateSource}, received=${result.convertedAmount}`,
    );
  } finally {
    await app.close();
  }
}
