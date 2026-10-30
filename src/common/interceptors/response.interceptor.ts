import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { map, Observable } from 'rxjs';
import { ApiResponse } from '../responses/api-response';
import { ControllerResponse } from '../responses/controller-response';

@Injectable()
export class ResponseInterceptor implements NestInterceptor<
  ControllerResponse,
  ApiResponse<unknown>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<ControllerResponse>,
  ): Observable<ApiResponse<unknown>> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((result) => ({
        statusCode: response.statusCode,
        message: result.message,
        data: result.data,
        meta: result.meta ?? {},
        errors: [],
      })),
    );
  }
}
