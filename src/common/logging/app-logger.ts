import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { RequestContext } from './request-context';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Only operational metadata belongs here: no request bodies, keys, SQL, or raw exceptions.
export interface LogFields {
  transactionId?: string;

  journalId?: string;

  walletId?: string;

  operation?: string;

  method?: string;

  route?: string;

  statusCode?: number;

  durationMs?: number;

  waitMs?: number;

  walletCount?: number;

  entryCount?: number;

  balanceCount?: number;

  rateSource?: 'live' | 'fixed' | null;

  phase?: 'begin' | 'work' | 'commit';

  outcome?: 'rollback_attempted' | 'unknown';

  errorCode?: string;

  dbCode?: string;

  constraint?: string;

  reason?: string;
}

const priorities = { debug: 10, info: 20, warn: 30, error: 40, silent: 50 };

@Injectable()
export class AppLogger {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RequestContext) private readonly context: RequestContext,
  ) {}

  debug(event: string, fields: LogFields = {}): void {
    this.write('debug', event, fields);
  }

  info(event: string, fields: LogFields = {}): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.write('error', event, fields);
  }

  private write(level: LogLevel, event: string, fields: LogFields): void {
    if (priorities[level] < priorities[this.config.LOG_LEVEL]) {
      return;
    }

    try {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          event,
          ...this.context.current(),
          ...fields,
        }),
      );
    } catch {
      // A logging failure must never change the result of a financial operation.
    }
  }
}
