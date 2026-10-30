import { CreationOptional, InferAttributes, InferCreationAttributes, literal } from 'sequelize';
import {
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

@Table({ tableName: 'ledger_accounts', timestamps: false })
export class LedgerAccount extends Model<
  InferAttributes<LedgerAccount>,
  InferCreationAttributes<LedgerAccount>
> {
  @PrimaryKey
  @Default(literal('gen_random_uuid()'))
  @Column({ type: DataType.UUID, allowNull: false })
  declare id: CreationOptional<string>;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare kind: 'wallet' | 'funding' | 'fx';

  @ForeignKey(() => Wallet)
  @Column({ type: DataType.UUID, field: 'wallet_id', allowNull: true })
  declare walletId: string | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare currency: Currency;

  @Default(literal('clock_timestamp()'))
  @Column({ type: DataType.DATE, field: 'created_at', allowNull: false })
  declare createdAt: CreationOptional<Date>;
}
