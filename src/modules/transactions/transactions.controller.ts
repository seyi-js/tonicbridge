import { Controller, Headers, Inject, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { UuidParam, ValidatedBody } from '../../common/decorators/validation.decorators';
import { depositSchema, DepositDto } from './dto/deposit.dto';
import { swapSchema, SwapDto } from './dto/swap.dto';
import { transferSchema, TransferDto } from './dto/transfer.dto';
import { TransactionsService } from './transactions.service';

@Controller('wallets/:walletId')
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly transactions: TransactionsService) {}

  @Post('deposits')
  @ResponseMessage('Deposit completed successfully.')
  async deposit(
    @UuidParam('walletId') walletId: string,
    @ValidatedBody(depositSchema) body: DepositDto,
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
  @ResponseMessage('Swap completed successfully.')
  async swap(
    @UuidParam('walletId') walletId: string,
    @ValidatedBody(swapSchema) body: SwapDto,
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
  @ResponseMessage('Transfer completed successfully.')
  async transfer(
    @UuidParam('walletId') walletId: string,
    @ValidatedBody(transferSchema) body: TransferDto,
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
