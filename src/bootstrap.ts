import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { SwaggerModule, OpenAPIObject } from '@nestjs/swagger';
import { readFile } from 'node:fs/promises';
import { AppModule } from './app.module';
import { ErrorFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    logger: ['warn', 'error'],
    abortOnError: false,
  });
  app.useGlobalFilters(new ErrorFilter());
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
  const spec = JSON.parse(await readFile('docs/openapi.json', 'utf8')) as OpenAPIObject;
  SwaggerModule.setup('docs', app, spec, { jsonDocumentUrl: 'openapi.json' });
  app.enableShutdownHooks();
  await app.init();
  return app;
}
