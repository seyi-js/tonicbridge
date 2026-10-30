import { Body, Controller, Headers, Inject, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { uuidSchema } from '../../common/money';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { depositSchema, DepositDto } from './dto/deposit.dto';
import { swapSchema, SwapDto } from './dto/swap.dto';
import { transferSchema, TransferDto } from './dto/transfer.dto';
import { TransactionsService } from './transactions.service';

@Controller('wallets/:walletId')
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly transactions: TransactionsService) {}

  @Post('deposits')
  async deposit(
    @Param('walletId', new ZodValidationPipe(uuidSchema)) walletId: string,
    @Body(new ZodValidationPipe(depositSchema)) body: DepositDto,
    @Headers('idempotency-key') key: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.transactions.deposit(walletId, body, key);
    response
      .status(result.replayed ? 200 : 201)
      .setHeader('Idempotency-Replayed', String(result.replayed));
    return result.transaction;
  }

  @Post('swaps')
  async swap(
    @Param('walletId', new ZodValidationPipe(uuidSchema)) walletId: string,
    @Body(new ZodValidationPipe(swapSchema)) body: SwapDto,
    @Headers('idempotency-key') key: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.transactions.swap(walletId, body, key);
    response
      .status(result.replayed ? 200 : 201)
      .setHeader('Idempotency-Replayed', String(result.replayed));
    return result.transaction;
  }

  @Post('transfers')
  async transfer(
    @Param('walletId', new ZodValidationPipe(uuidSchema)) walletId: string,
    @Body(new ZodValidationPipe(transferSchema)) body: TransferDto,
    @Headers('idempotency-key') key: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.transactions.transfer(walletId, body, key);
    response
      .status(result.replayed ? 200 : 201)
      .setHeader('Idempotency-Replayed', String(result.replayed));
    return result.transaction;
  }
}
