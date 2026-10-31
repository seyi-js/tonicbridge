import { HttpException } from '@nestjs/common';
import { ConnectionError, DatabaseError } from 'sequelize';
import { ZodError } from 'zod';
import { DomainError } from '../errors/domain.error';
import { LogFields } from './app-logger';

export function errorFields(
  error: unknown,
): Pick<LogFields, 'errorCode' | 'dbCode' | 'constraint'> {
  if (error instanceof DomainError) {
    return { errorCode: error.code };
  }

  if (error instanceof ZodError) {
    return { errorCode: 'VALIDATION_ERROR' };
  }

  if (error instanceof DatabaseError) {
    const parent = error.parent as Error & { code?: string; constraint?: string };

    return {
      errorCode: 'DATABASE_ERROR',
      dbCode: /^[0-9A-Z]{5}$/.test(parent.code ?? '') ? parent.code : undefined,
      constraint: /^[a-zA-Z0-9_]{1,128}$/.test(parent.constraint ?? '')
        ? parent.constraint
        : undefined,
    };
  }

  if (error instanceof ConnectionError) {
    return { errorCode: 'DATABASE_CONNECTION_ERROR' };
  }

  if (error instanceof HttpException) {
    return { errorCode: error.getStatus() >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR' };
  }

  return { errorCode: 'INTERNAL_ERROR' };
}
