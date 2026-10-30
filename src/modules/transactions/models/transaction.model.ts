import {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  literal,
  NonAttribute,
} from 'sequelize';
import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { Currency } from '../../../common/money';
import { Wallet } from '../../wallets/models/wallet.model';

@Table({ tableName: 'transactions', timestamps: false })
export class WalletTransaction extends Model<
  InferAttributes<WalletTransaction>,
  InferCreationAttributes<WalletTransaction>
> {
  @PrimaryKey
  @Default(literal('gen_random_uuid()'))
  @Column({ type: DataType.UUID, allowNull: false })
  declare id: CreationOptional<string>;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare type: 'deposit' | 'swap' | 'transfer';

  @ForeignKey(() => Wallet)
  @Column({ type: DataType.UUID, field: 'source_wallet_id', allowNull: true })
  declare sourceWalletId: string | null;

  @ForeignKey(() => Wallet)
  @Column({ type: DataType.UUID, field: 'destination_wallet_id', allowNull: false })
  declare destinationWalletId: string;

  @Column({ type: DataType.TEXT, field: 'source_currency', allowNull: false })
  declare sourceCurrency: Currency;

  @Column({ type: DataType.TEXT, field: 'destination_currency', allowNull: false })
  declare destinationCurrency: Currency;

  @Column({ type: DataType.DECIMAL(24, 6), field: 'source_amount', allowNull: false })
  declare sourceAmount: string;

  @Column({ type: DataType.DECIMAL(24, 6), field: 'destination_amount', allowNull: false })
  declare destinationAmount: string;

  @Column({ type: DataType.DECIMAL(32, 12), allowNull: false })
  declare rate: string;

  @Column({ type: DataType.TEXT, field: 'rate_source', allowNull: true })
  declare rateSource: 'live' | 'fixed' | null;

  @Column({ type: DataType.DATE, field: 'rate_updated_at', allowNull: true })
  declare rateUpdatedAt: Date | null;

  @Default(literal('clock_timestamp()'))
  @Column({ type: DataType.DATE, field: 'created_at', allowNull: false })
  declare createdAt: CreationOptional<Date>;

  @BelongsTo(() => Wallet, 'sourceWalletId')
  declare sourceWallet?: NonAttribute<Wallet>;

  @BelongsTo(() => Wallet, 'destinationWalletId')
  declare destinationWallet?: NonAttribute<Wallet>;
}
