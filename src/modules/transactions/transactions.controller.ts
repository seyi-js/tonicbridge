import { Controller, Headers, Inject, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { UuidParam, ValidatedBody } from '../../common/decorators/validation.decorators';
import { ControllerContract } from '../../common/responses/controller-response';
import { depositSchema, DepositDto } from './dto/deposit.dto';
import { swapSchema, SwapDto } from './dto/swap.dto';
import { transferSchema, TransferDto } from './dto/transfer.dto';
import { TransactionsService } from './transactions.service';

@Controller('wallets/:walletId')
export class TransactionsController implements ControllerContract<TransactionsController> {
  constructor(@Inject(TransactionsService) private readonly transactions: TransactionsService) {}

  @Post('deposits')
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

    return { data: result.transaction, message: 'Deposit completed successfully.' };
  }

  @Post('swaps')
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

    return { data: result.transaction, message: 'Swap completed successfully.' };
  }

  @Post('transfers')
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

    return { data: result.transaction, message: 'Transfer completed successfully.' };
  }
}
