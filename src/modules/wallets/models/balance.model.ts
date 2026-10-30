import {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
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
import { Wallet } from './wallet.model';

@Table({ tableName: 'balances', timestamps: false })
export class Balance extends Model<InferAttributes<Balance>, InferCreationAttributes<Balance>> {
  @PrimaryKey
  @ForeignKey(() => Wallet)
  @Column({ type: DataType.UUID, field: 'wallet_id', allowNull: false })
  declare walletId: string;

  @PrimaryKey
  @Column({ type: DataType.TEXT, allowNull: false })
  declare currency: Currency;

  @Default('0.000000')
  @Column({ type: DataType.DECIMAL(24, 6), allowNull: false })
  declare amount: CreationOptional<string>;

  @BelongsTo(() => Wallet)
  declare wallet?: NonAttribute<Wallet>;
}
