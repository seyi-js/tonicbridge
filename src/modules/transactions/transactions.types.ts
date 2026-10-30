import { Currency } from '../../common/money';
import { WalletTransaction } from './models/transaction.model';

export interface Movement {
  type: WalletTransaction['type'];

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
