import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestTrace {
  requestId: string;

  transactionId?: string;

  journalId?: string;
}

@Injectable()
export class RequestContext {
  private readonly storage = new AsyncLocalStorage<RequestTrace>();

  run<T>(trace: RequestTrace, callback: () => T): T {
    return this.storage.run(trace, callback);
  }

  current(): RequestTrace | undefined {
    return this.storage.getStore();
  }

  identify(ids: Pick<RequestTrace, 'transactionId' | 'journalId'>): void {
    const trace = this.current();

    if (trace) {
      Object.assign(trace, ids);
    }
  }
}
