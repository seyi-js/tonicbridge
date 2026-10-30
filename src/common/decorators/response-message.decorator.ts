import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE = Symbol('response-message');

export function ResponseMessage(message: string): MethodDecorator {
  return SetMetadata(RESPONSE_MESSAGE, message);
}
