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
import { LedgerAccount } from './ledger-account.model';
import { LedgerJournal } from './ledger-journal.model';

@Table({ tableName: 'ledger_entries', timestamps: false })
export class LedgerEntry extends Model<
  InferAttributes<LedgerEntry>,
  InferCreationAttributes<LedgerEntry>
> {
  @PrimaryKey
  @Default(literal('gen_random_uuid()'))
  @Column({ type: DataType.UUID, allowNull: false })
  declare id: CreationOptional<string>;

  @ForeignKey(() => LedgerJournal)
  @Column({ type: DataType.UUID, field: 'journal_id', allowNull: false })
  declare journalId: string;

  @Column({ type: DataType.SMALLINT, field: 'line_number', allowNull: false })
  declare lineNumber: number;

  @ForeignKey(() => LedgerAccount)
  @Column({ type: DataType.UUID, field: 'account_id', allowNull: false })
  declare accountId: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare currency: Currency;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare direction: 'debit' | 'credit';

  @Column({ type: DataType.DECIMAL(24, 6), allowNull: false })
  declare amount: string;
}
