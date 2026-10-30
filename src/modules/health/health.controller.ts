import { Controller, Get, Inject } from '@nestjs/common';
import { Database } from '../../database/database.service';
import { DomainError } from '../../common/errors/domain.error';
@Controller()
export class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get('health')
  async health() {
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new DomainError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable.');
    }
    return { status: 'ok' };
  }
}
