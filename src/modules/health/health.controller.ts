import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DomainError } from '../../common/errors/domain.error';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  @Get()
  @ResponseMessage('Service is healthy.')
  async health() {
    try {
      await this.sequelize.authenticate();
    } catch {
      throw new DomainError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable.');
    }
    return { status: 'ok' };
  }
}
