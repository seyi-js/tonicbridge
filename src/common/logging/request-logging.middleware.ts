import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppLogger } from './app-logger';
import { RequestContext } from './request-context';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(
    @Inject(AppLogger) private readonly logger: AppLogger,
    @Inject(RequestContext) private readonly context: RequestContext,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const trace = { requestId: randomUUID() };
    const started = performance.now();
    let recorded = false;

    const finish = (aborted: boolean) => {
      if (recorded) {
        return;
      }

      recorded = true;

      this.context.run(trace, () => {
        // Route templates are safe to log; raw URLs can contain personal data or credentials.
        const route: unknown = request.route?.path;

        const fields = {
          method: request.method,
          route: typeof route === 'string' ? route : 'unmatched',
          durationMs: Math.round(performance.now() - started),
          ...(aborted ? {} : { statusCode: response.statusCode }),
        };

        if (aborted) {
          this.logger.warn('http.request.aborted', fields);
        } else {
          this.logger.info('http.request.completed', fields);
        }
      });
    };

    this.context.run(trace, () => {
      response.setHeader('X-Request-ID', trace.requestId);
      response.once('finish', () => finish(false));

      response.once('close', () => {
        if (!response.writableFinished) {
          finish(true);
        }
      });

      this.logger.debug('http.request.started', { method: request.method });
      next();
    });
  }
}
