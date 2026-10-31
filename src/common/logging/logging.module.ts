import { Global, Module } from '@nestjs/common';
import { AppLogger } from './app-logger';
import { RequestContext } from './request-context';
import { RequestLoggingMiddleware } from './request-logging.middleware';

@Global()
@Module({
  providers: [AppLogger, RequestContext, RequestLoggingMiddleware],
  exports: [AppLogger, RequestContext, RequestLoggingMiddleware],
})
export class LoggingModule {}
