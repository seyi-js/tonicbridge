import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { ZodError } from 'zod';

import { AppLogger } from '../logging/app-logger';
import { errorFields } from '../logging/error-fields';
import { DomainError } from '../errors/domain.error';
import { ApiResponse, ResponseError } from '../responses/api-response';

@Catch()
export class ErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let statusCode = 500;
    let message = 'The request could not be completed.';
    let errors: ResponseError[] = [{ code: 'INTERNAL_ERROR', message }];

    if (error instanceof DomainError) {
      statusCode = error.status;
      message = error.message;
      errors = [{ code: error.code, message }];
    } else if (error instanceof ZodError) {
      statusCode = 400;
      message = 'Invalid request.';

      errors = error.issues.flatMap((issue) => {
        if (issue.code === 'unrecognized_keys') {
          return issue.keys.map((key) => ({
            code: 'VALIDATION_ERROR',
            field: [...issue.path, key].join('.'),
            message: 'Unknown field.',
          }));
        }

        return [
          {
            code: 'VALIDATION_ERROR',
            field: issue.path.join('.') || 'request',
            message: issue.message,
          },
        ];
      });
    } else if (error instanceof HttpException) {
      statusCode = error.getStatus();
      // Framework errors can include raw JSON input or internal exception details.
      message = statusCode >= 500 ? message : (STATUS_CODES[statusCode] ?? 'Request failed.');
      errors = [{ code: statusCode >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR', message }];
    }

    const fields = { statusCode, ...errorFields(error) };

    if (statusCode >= 500) {
      this.logger.error('http.request.failed', fields);
    } else {
      this.logger.warn('http.request.failed', fields);
    }

    const body: ApiResponse<never> = { statusCode, message, data: null, meta: {}, errors };

    res.status(statusCode).json(body);
  }
}
