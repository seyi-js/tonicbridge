import { CreationOptional, InferAttributes, InferCreationAttributes, literal } from 'sequelize';
import {
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  Unique,
} from 'sequelize-typescript';
import { WalletTransaction } from '../../transactions/models/transaction.model';

@Table({ tableName: 'ledger_journals', timestamps: false })
export class LedgerJournal extends Model<
  InferAttributes<LedgerJournal>,
  InferCreationAttributes<LedgerJournal>
> {
  @PrimaryKey
  @Default(literal('gen_random_uuid()'))
  @Column({ type: DataType.UUID, allowNull: false })
  declare id: CreationOptional<string>;

  @Unique
  @ForeignKey(() => WalletTransaction)
  @Column({ type: DataType.UUID, field: 'transaction_id', allowNull: false })
  declare transactionId: string;

  @Default(literal('clock_timestamp()'))
  @Column({ type: DataType.DATE, field: 'recorded_at', allowNull: false })
  declare recordedAt: CreationOptional<Date>;
}
