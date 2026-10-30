import { Body, Controller, Headers, Inject, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { uuidSchema } from '../../common/money';
import { TransactionsService } from './transactions.service';
@Controller('wallets/:walletId')
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly transactions: TransactionsService) {}

  @Post('deposits')
  async deposit(
    @Param('walletId') walletId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.transactions.deposit(uuidSchema.parse(walletId), body, key);
    response
      .status(result.replayed ? 200 : 201)
      .setHeader('Idempotency-Replayed', String(result.replayed));
    return result.transaction;
  }

  @Post('swaps')
  async swap(
    @Param('walletId') walletId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.transactions.swap(uuidSchema.parse(walletId), body, key);
    response
      .status(result.replayed ? 200 : 201)
      .setHeader('Idempotency-Replayed', String(result.replayed));
    return result.transaction;
  }

  @Post('transfers')
  async transfer(
    @Param('walletId') walletId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.transactions.transfer(uuidSchema.parse(walletId), body, key);
    response
      .status(result.replayed ? 200 : 201)
      .setHeader('Idempotency-Replayed', String(result.replayed));
    return result.transaction;
  }
}
