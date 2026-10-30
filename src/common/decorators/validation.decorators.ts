import { Body, Param, Query } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';
import { uuidSchema } from '../money';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

export function ValidatedBody<T>(schema: ZodType<T, ZodTypeDef, unknown>): ParameterDecorator {
  return Body(new ZodValidationPipe(schema));
}

export function ValidatedQuery<T>(schema: ZodType<T, ZodTypeDef, unknown>): ParameterDecorator {
  return Query(new ZodValidationPipe(schema));
}

export function UuidParam(name: string): ParameterDecorator {
  return Param(name, new ZodValidationPipe(uuidSchema));
}
