import {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  literal,
  NonAttribute,
} from 'sequelize';
import {
  Column,
  DataType,
  Default,
  HasMany,
  Model,
  PrimaryKey,
  Table,
  Unique,
} from 'sequelize-typescript';
import { Balance } from './balance.model';

@Table({ tableName: 'wallets', timestamps: false })
export class Wallet extends Model<InferAttributes<Wallet>, InferCreationAttributes<Wallet>> {
  @PrimaryKey
  @Default(literal('gen_random_uuid()'))
  @Column({ type: DataType.UUID, allowNull: false })
  declare id: CreationOptional<string>;

  @Unique
  @Column({ type: DataType.TEXT, allowNull: true })
  declare email: string | null;

  @Unique
  @Column({ type: DataType.TEXT, allowNull: true })
  declare phone: string | null;

  @Default(literal('now()'))
  @Column({ type: DataType.DATE, field: 'created_at', allowNull: false })
  declare createdAt: CreationOptional<Date>;

  @HasMany(() => Balance)
  declare balances?: NonAttribute<Balance[]>;
}
