import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AppConfigModule } from '../config/app-config.module';
import { MigrationsService } from './migrations.service';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        dialect: 'postgres',
        uri: config.DATABASE_URL,
        autoLoadModels: true,
        // Versioned migrations own the schema, including financial constraints and ledger triggers.
        synchronize: false,
        // Each Nest application gets independent model repositories and its own connection pool.
        repositoryMode: true,
        logging: false,
        retryAttempts: 1,
        pool: { max: 12, min: 0, acquire: 5000, idle: 10000 },
        dialectOptions: { connectionTimeoutMillis: 5000, statement_timeout: 10000 },
      }),
    }),
  ],
  providers: [MigrationsService],
})
export class DatabaseModule {}
