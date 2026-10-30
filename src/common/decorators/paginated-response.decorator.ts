import { SetMetadata } from '@nestjs/common';

export const PAGINATED_RESPONSE = Symbol('paginated-response');

export function PaginatedResponse(): MethodDecorator {
  return SetMetadata(PAGINATED_RESPONSE, true);
}
