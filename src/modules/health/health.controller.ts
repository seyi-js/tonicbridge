import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { DomainError } from '../../common/errors/domain.error';
import { ControllerContract } from '../../common/responses/controller-response';

@Controller('health')
export class HealthController implements ControllerContract<HealthController> {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  @Get()
  async health() {
    try {
      await this.sequelize.authenticate();
    } catch {
      throw new DomainError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable.');
    }

    return { data: { status: 'ok' }, message: 'Service is healthy.' };
  }
}
