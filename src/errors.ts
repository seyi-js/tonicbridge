import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ZodError } from 'zod';

export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof DomainError) {
      res.status(error.status).json({ code: error.code, message: error.message });
    } else if (error instanceof ZodError) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message:
          'Invalid request: ' +
          error.issues.map((i) => `${i.path.join('.') || 'body'} ${i.message}`).join('; '),
      });
    } else if (error instanceof HttpException) {
      res.status(error.getStatus()).json({ code: 'HTTP_ERROR', message: error.message });
    } else {
      this.logger.error(
        'Unexpected request failure; no request payload or database credentials logged.',
      );
      res
        .status(500)
        .json({ code: 'INTERNAL_ERROR', message: 'The request could not be completed.' });
    }
  }
}
