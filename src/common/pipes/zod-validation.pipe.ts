import { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): T {
    return this.schema.parse(value, { path: [metadata.data ?? metadata.type] });
  }
}
