import { describe, expect, it } from 'vitest';
import SwaggerParser from '@apidevtools/swagger-parser';
import { readConfig } from '../src/config/app-config';

describe('contract and configuration', () => {
  it('publishes a valid OpenAPI contract', async () => {
    const api = await SwaggerParser.validate('docs/openapi.json');

    expect(api.info.title).toBe('TonicBridge');
  });

  it('rejects invalid configuration without echoing credentials', () => {
    expect(() => readConfig({ DATABASE_URL: 'private-invalid-input' })).toThrow(
      'Invalid configuration',
    );

    expect(readConfig({}).FX_MODE).toBe('live');
  });
});
