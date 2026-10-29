import 'reflect-metadata';
import { Controller, Get, Inject, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, OpenAPIObject } from '@nestjs/swagger';
import { readFile } from 'node:fs/promises';
import { APP_CONFIG, readConfig } from './config';
import { Database } from './database';
import { DomainError, ErrorFilter } from './errors';
import { WalletsController, WalletsService } from './wallets';
import { TransactionsController, TransactionsService } from './transactions';
import { FxController, FxService } from './fx';
import { HistoryController, HistoryService } from './history';

@Controller()
class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get('health')
  async health() {
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new DomainError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable.');
    }
    return { status: 'ok' };
  }
}

@Module({
  controllers: [
    HealthController,
    WalletsController,
    TransactionsController,
    FxController,
    HistoryController,
  ],
  providers: [
    { provide: APP_CONFIG, useFactory: () => readConfig() },
    Database,
    WalletsService,
    TransactionsService,
    FxService,
    HistoryService,
  ],
})
export class AppModule {}

export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    logger: ['warn', 'error'],
    abortOnError: false,
  });
  app.useGlobalFilters(new ErrorFilter());
  const spec = JSON.parse(await readFile('docs/openapi.json', 'utf8')) as OpenAPIObject;
  SwaggerModule.setup('docs', app, spec, { jsonDocumentUrl: 'openapi.json' });
  app.enableShutdownHooks();
  await app.init();
  return app;
}
