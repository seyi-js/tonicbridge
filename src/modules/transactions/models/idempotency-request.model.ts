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
  Unique,
} from 'sequelize-typescript';
import { Wallet } from '../../wallets/models/wallet.model';
import { WalletTransaction } from './transaction.model';

@Table({ tableName: 'idempotency_requests', timestamps: false })
export class IdempotencyRequest extends Model<
  InferAttributes<IdempotencyRequest>,
  InferCreationAttributes<IdempotencyRequest>
> {
  @PrimaryKey
  @ForeignKey(() => Wallet)
  @Column({ type: DataType.UUID, field: 'wallet_id', allowNull: false })
  declare walletId: string;

  @PrimaryKey
  @Column({ type: DataType.TEXT, allowNull: false })
  declare key: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare fingerprint: string;

  @Unique
  @ForeignKey(() => WalletTransaction)
  @Column({ type: DataType.UUID, field: 'transaction_id', allowNull: false })
  declare transactionId: string;

  @Default(literal('now()'))
  @Column({ type: DataType.DATE, field: 'created_at', allowNull: false })
  declare createdAt: CreationOptional<Date>;

  @BelongsTo(() => Wallet)
  declare wallet?: NonAttribute<Wallet>;

  @BelongsTo(() => WalletTransaction)
  declare transaction?: NonAttribute<WalletTransaction>;
}
