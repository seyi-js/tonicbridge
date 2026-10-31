import { Module } from '@nestjs/common';
import { LoggingModule } from './common/logging/logging.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { FxModule } from './modules/fx/fx.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    WalletsModule,
    FxModule,
    TransactionsModule,
    HealthModule,
  ],
})
export class AppModule {}
