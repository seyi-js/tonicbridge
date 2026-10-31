import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { AppLogger } from './common/logging/app-logger';
import { RequestLoggingMiddleware } from './common/logging/request-logging.middleware';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, OpenAPIObject } from '@nestjs/swagger';
import { readFile } from 'node:fs/promises';
import { AppModule } from './app.module';
import { ErrorFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: true, logLevels: ['warn', 'error'] }),
    abortOnError: false,
  });

  const requestLogging = app.get(RequestLoggingMiddleware);

  // Register before Nest's body parser so malformed JSON also has a request ID.
  app.use(requestLogging.use.bind(requestLogging));
  app.useGlobalFilters(new ErrorFilter(app.get(AppLogger)));

  app.useGlobalInterceptors(new ResponseInterceptor());

  const spec = JSON.parse(await readFile('docs/openapi.json', 'utf8')) as OpenAPIObject;

  SwaggerModule.setup('docs', app, spec, { jsonDocumentUrl: 'openapi.json' });

  app.enableShutdownHooks();

  await app.init();

  return app;
}
