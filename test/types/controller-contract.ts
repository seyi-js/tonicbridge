import { ControllerContract } from '../../src/common/responses/controller-response';

// These fixtures are checked by tsc, not executed by Vitest.
// An unused @ts-expect-error fails typecheck if the contract stops rejecting invalid returns.
export class ValidController implements ControllerContract<ValidController> {
  get(id: string) {
    return { data: { id }, message: 'Retrieved successfully.' };
  }

  async list(limit: number) {
    const items = this.items();

    return {
      data: items,
      message: 'Retrieved successfully.',
      meta: { total: items.length, limit, offset: 0 },
    };
  }

  private items() {
    return [{ id: 'example' }];
  }
}

export class InvalidController implements ControllerContract<InvalidController> {
  // @ts-expect-error Every public endpoint must return a message.
  missingMessage() {
    return { data: [] };
  }

  // @ts-expect-error Every public endpoint must return data.
  missingData() {
    return { message: 'Retrieved successfully.' };
  }

  // @ts-expect-error New async methods cannot return raw service results.
  async newEndpoint() {
    return [{ id: 'example' }];
  }

  // @ts-expect-error The response message must be a string.
  invalidMessage() {
    return { data: [], message: 200 };
  }

  // @ts-expect-error Pagination metadata must have correctly typed attributes.
  invalidMeta() {
    return { data: [], message: 'Retrieved successfully.', meta: { total: 'one' } };
  }

  // @ts-expect-error All successful return branches must satisfy the response contract.
  incompleteBranch(found: boolean) {
    if (found) {
      return { data: { id: 'example' }, message: 'Retrieved successfully.' };
    }

    return { data: null };
  }
}
