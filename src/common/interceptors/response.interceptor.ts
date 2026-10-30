import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { map, Observable } from 'rxjs';
import { PAGINATED_RESPONSE } from '../decorators/paginated-response.decorator';
import { RESPONSE_MESSAGE } from '../decorators/response-message.decorator';
import { ApiResponse, PaginatedResult } from '../responses/api-response';

@Injectable()
export class ResponseInterceptor implements NestInterceptor<unknown, ApiResponse<unknown>> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<ApiResponse<unknown>> {
    const response = context.switchToHttp().getResponse<Response>();
    const paginated = this.reflector.get<boolean>(PAGINATED_RESPONSE, context.getHandler());
    const message = this.reflector.get<string>(RESPONSE_MESSAGE, context.getHandler());

    if (!message?.trim()) {
      throw new Error('The endpoint must define a success response message.');
    }

    return next.handle().pipe(
      map((result) => {
        let data = result ?? null;
        let meta: ApiResponse<unknown>['meta'] = {};

        if (paginated) {
          const page = result as PaginatedResult<unknown>;
          data = page.items;
          meta = { total: page.total, limit: page.limit, offset: page.offset };
        }

        return {
          statusCode: response.statusCode,
          message,
          data,
          meta,
          errors: [],
        };
      }),
    );
  }
}
