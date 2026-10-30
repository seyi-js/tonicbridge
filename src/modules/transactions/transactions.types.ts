import { Currency } from '../../common/money';
export interface TransactionRow {
  id: string;

  type: 'deposit' | 'swap' | 'transfer';

  source_wallet_id: string | null;

  destination_wallet_id: string;

  source_currency: Currency;

  destination_currency: Currency;

  source_amount: string;

  destination_amount: string;

  rate: string;

  rate_source: 'live' | 'fixed' | null;

  rate_updated_at: Date | null;

  created_at: Date;
}
export interface Movement {
  type: TransactionRow['type'];

  walletId: string;

  recipientId: string;

  from: Currency;

  to: Currency;

  amount: string;
}
export interface RateQuote {
  rate: string;

  source: 'live' | 'fixed' | null;

  updatedAt: string | null;
}
export const identityQuote: RateQuote = { rate: '1.000000000000', source: null, updatedAt: null };
export function transactionView(row: TransactionRow) {
  return {
    id: row.id,
    type: row.type,
    sourceWalletId: row.source_wallet_id,
    destinationWalletId: row.destination_wallet_id,
    sourceCurrency: row.source_currency,
    destinationCurrency: row.destination_currency,
    sourceAmount: row.source_amount,
    destinationAmount: row.destination_amount,
    rate: row.rate,
    rateSource: row.rate_source,
    rateUpdatedAt: row.rate_updated_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}
