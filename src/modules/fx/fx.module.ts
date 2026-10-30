import { Module } from '@nestjs/common';
import { WalletsModule } from '../wallets/wallets.module';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';
@Module({
  imports: [WalletsModule],
  controllers: [FxController],
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}
