import { WalletTransaction } from './models/transaction.model';

export const transactionView = (row: WalletTransaction) => ({
  id: row.id,
  type: row.type,
  sourceWalletId: row.sourceWalletId,
  destinationWalletId: row.destinationWalletId,
  sourceCurrency: row.sourceCurrency,
  destinationCurrency: row.destinationCurrency,
  sourceAmount: row.sourceAmount,
  destinationAmount: row.destinationAmount,
  rate: row.rate,
  rateSource: row.rateSource,
  rateUpdatedAt: row.rateUpdatedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});
