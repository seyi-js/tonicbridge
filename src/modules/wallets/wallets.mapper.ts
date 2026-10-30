import { Wallet } from './models/wallet.model';

export const walletView = (wallet: Wallet) => ({
  id: wallet.id,
  email: wallet.email,
  phone: wallet.phone,
  createdAt: wallet.createdAt.toISOString(),
});
