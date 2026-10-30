import { Currency } from '../../common/money';
export interface WalletRow {
  id: string;

  email: string | null;

  phone: string | null;

  created_at: Date;
}
export interface BalanceRow {
  currency: Currency;

  amount: string;
}
export const walletView = (row: WalletRow) => ({
  id: row.id,
  email: row.email,
  phone: row.phone,
  createdAt: row.created_at.toISOString(),
});
