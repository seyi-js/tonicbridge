# Double-entry ledger

`ledger_accounts`, `ledger_journals`, and `ledger_entries` are the authoritative accounting record. The `balances` table is a projection used for fast balance checks and reads. PostgreSQL verifies that it agrees with wallet postings at commit.

## Accounts and postings

Each wallet has one liability account per currency. Credits increase the balance owed to that wallet; debits decrease it. There is also one funding account and one FX clearing account per currency. Funding represents simulated deposits, not verified external cash settlement. Clearing accounts record the position created by exchanges and can have a net debit or credit balance.

| Operation                          | Debit                  | Credit                      |
| ---------------------------------- | ---------------------- | --------------------------- |
| Deposit 10 USDx                    | Funding, 10 USDx       | Recipient wallet, 10 USDx   |
| Transfer 10 USDx                   | Sender wallet, 10 USDx | Recipient wallet, 10 USDx   |
| Swap 2 USDx to 3200 cNGN: USDx leg | Sender wallet, 2 USDx  | FX clearing, 2 USDx         |
| Same swap: cNGN leg                | FX clearing, 3200 cNGN | Recipient wallet, 3200 cNGN |

For a swap, sender and recipient are the same wallet. Cross-currency transfers use the same four-entry pattern with different wallets. Every journal balances within each currency: values in different currencies are never added together to claim a balanced journal. Entry amounts retain the exact six-decimal representation used by the transaction; the actual applied rate remains on that transaction.

## Posting and concurrency

`TransactionsService` validates the idempotency key, checks for a replay, fetches any required FX quote, and then acquires ordered wallet locks. It checks idempotency again under the lock and creates the transaction summary.

`LedgerService.post` constructs the debit/credit postings, checks the resulting wallet balances, creates the journal and entries, and updates the balance projection from those same postings. The transaction summary, journal, entries, balance updates, and request key all commit in one managed Sequelize transaction. An error at any stage rolls all of them back. A replay returns the original transaction and creates no new journal.

The source and destination wallet locks prevent overspending and deadlocks. System accounts do not have mutable running balances, so unrelated deposits do not serialize on one shared funding balance.

## Database guarantees

The initial schema in `migrations/001-initial.sql` installs the following guarantees in PostgreSQL:

- Every transaction must have exactly one journal. The transaction reference is unique, and a deferred constraint requires the journal before commit.
- Journals cannot be empty, and total debits must equal total credits for every currency.
- Journal entries must match the transaction's exact participants, currencies, amounts, and posting directions. A balanced journal describing a different movement is rejected.
- Entry currency must match its account through a composite foreign key.
- Wallet balances must equal credits minus debits on their ledger accounts. Checks run for both entry inserts and balance writes, including direct SQL.
- Accounts, journals, entries, and transaction summaries reject updates, deletions, and truncation. Entries may only be inserted in the same database transaction that created their journal. A committed journal cannot accept additional postings.

These checks are deferred where multiple rows must be present before the complete journal can be evaluated. The API only reports success after the enclosing transaction commits. Sequelize models handle normal reads and writes; SQL migrations own cross-row constraints and immutable-record triggers.

Financial corrections require new journaled movements. A reversal/refund API is not part of this change, and existing entries are never rewritten to implement a correction.

## Initialization

`migrations/001-initial.sql` creates the wallet, transaction, and ledger tables together and seeds one funding account and one FX clearing account for each of the five currencies. Creating a wallet adds its five liability accounts and zero balance projections atomically. All money movements are journaled from the first request.

The migration runner records applied files in `schema_migrations`; restarting the application leaves the stored accounts, journals, and balances intact.

## Inspection and reconciliation

Use the normal response envelope to inspect a transaction:

```http
GET /transactions/:transactionId/ledger
```

`data` contains the journal ID, transaction ID, recording time, and ordered entries. Every entry includes its account kind, wallet ID (null for system accounts), currency, debit/credit direction, and exact amount. This endpoint is documented in Swagger and follows the same controller return contract as other endpoints.

Two database views support independent reconciliation. Both queries should return no rows:

```sql
SELECT * FROM ledger_reconciliation WHERE NOT matches;
SELECT * FROM ledger_journal_totals WHERE debits <> credits;
```

To inspect the net system position by account:

```sql
SELECT a.kind, a.currency,
  sum(CASE WHEN e.direction = 'debit' THEN e.amount ELSE -e.amount END) AS net_debits
FROM ledger_accounts a
JOIN ledger_entries e ON e.account_id = a.id
WHERE a.wallet_id IS NULL
GROUP BY a.kind, a.currency;
```

These are internal accounting checks. Reconciliation with a bank, payment processor, or blockchain remains a separate integration.

## Verification

`test/ledger.test.ts` checks exact postings, per-currency balancing, concurrent retries, immutable records, sealed journals, raw SQL constraint failures at commit, and rollback after the final idempotency insert fails. `test/safety.test.ts` reconstructs wallet balances from actual ledger entries after concurrent spending.

`test/persistence.test.ts` creates a wallet and deposit through the API, restarts the application, and verifies that the wallet, exact balance, journal, and idempotent replay remain unchanged. The default suite initializes the complete schema in a fresh PostgreSQL Testcontainer.

Verified on 2026-10-30: `yarn run check` passed all 47 tests, formatting, lint, strict type checking, and the production build. The Docker API initialized an empty database with `001-initial.sql` and ten system accounts. Its HTTP walkthrough and the normal/error/timeout FX simulations passed; reconciliation found no balance differences, unbalanced journals, or transactions without journals.
