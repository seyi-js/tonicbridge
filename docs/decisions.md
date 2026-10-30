# TonicBridge: contract and financial invariants

TonicBridge is a simulated stablecoin wallet API for Operation Borderless. No blockchain, real deposits, fees, full authentication, or asynchronous money movement is involved. Endpoint definitions live in `docs/openapi.json`.

## Scope

- Five mock assets: cNGN, cGHS, cXAF, USDx, EURx, each assumed to track its named fiat currency 1:1.
- One wallet per normalized email or E.164 phone number. At least one identifier is required; both may be supplied. Emails are trimmed and lowercased; phone numbers must already be international E.164. A wallet starts with five zero balances.
- No authentication is required by the brief. Wallet and transaction IDs are identifiers, not authorization. This deliberately open sandbox must not hold real funds or personal customer information.

## NestJS modules and Sequelize

- Feature modules separate wallet, transaction/history, FX, and health controllers and services. Typed DTO schemas are validated and normalized by a Nest Zod pipe before reaching services.
- Sequelize models define column types, keys, and associations. Injected repositories handle application reads/writes; managed Sequelize transactions own commit/rollback. Repository mode isolates model bindings across independent Nest application instances.
- Sequelize's `NO_KEY_UPDATE` lock option produces the same ordered PostgreSQL wallet locks used by the financial design. Money writes use `READ COMMITTED`; history uses `REPEATABLE READ` for a consistent count and page.
- Automatic schema synchronization is disabled. Existing SQL migrations, constraint definitions, and `schema_migrations` records are retained; the migration runner uses Sequelize's connection and transaction management. Existing data and idempotency fingerprints require no conversion.
- `pg` remains the PostgreSQL dialect driver. Application services use Sequelize models; raw SQL is limited to schema migrations/advisory locking and independent database assertions/fault injection in tests.

## Money and rates

- Amounts are JSON strings with up to six fractional digits, no signs or exponent notation. Positive amounts only. PostgreSQL stores `NUMERIC(24,6)` and the API returns fixed six-place strings. Maximum stored amount: 999999999999999999.999999.
- Calculations use decimal arithmetic, never JavaScript floating-point balances. Currency conversion uses a rate rounded down to 12 fractional places, then rounds the destination amount down to six places. Reject a conversion that rounds to zero or exceeds the amount/balance limit.
- No fees. Same-currency transfers use exactly 1.000000000000 without a rate-provider request. Same-wallet transfers and same-currency swaps are rejected.
- USD valuation converts each balance with the same rate snapshot and sums its six-place, rounded-down USD values. It is an indicative valuation, not a guaranteed quote.
- A rate snapshot contains units of each fiat per USD. Pair rate = destination units / source units. The public FX provider and a versioned fixed table are interchangeable. Live rates are preferred; provider errors use a clearly labelled fixed fallback. `updatedAt` identifies the provider's publication time or the fixed table's version date, not a fabricated live timestamp.
- Each swap/cross-currency transfer persists the applied rate, its source, its timestamp, and the resulting amounts. Later rate changes do not change historical records.

## Transactions, concurrency, and idempotency

- Deposit, swap, and transfer requests require `Idempotency-Key` (8–128 characters: letters, digits, `_`, `.`, `:`, `-`). Scope is the source/owning wallet across all money endpoints.
- Fingerprints use normalized operation, wallets, currencies, and fixed-place amounts. Equivalent amount strings have the same meaning. Same key and fingerprint returns the original transaction with HTTP 200 and `Idempotency-Replayed: true`; first execution returns HTTP 201 and `false`. Different contents return HTTP 409. Failed operations do not consume a key.
- Wallet rows are locked in UUID order with `FOR NO KEY UPDATE`; all balance updates, the transaction record, and the idempotency record commit atomically. This serializes activity per wallet and prevents conflicting two-wallet transfers from taking locks in different orders.
- Network requests for FX occur before acquiring database locks. Idempotency is checked again inside the transaction. Database nonnegative constraints and uniqueness constraints remain independent safeguards.
- Idempotency records are retained indefinitely in this sandbox. There is no claim of a distributed exactly-once protocol; all financial effects occur in one PostgreSQL transaction.

## Reads and errors

- Wallet history includes deposits, swaps, and transfers where the wallet is sender or receiver. A currency filter matches either side. A transfer has one shared transaction ID and appears once in each participating wallet's history.
- Pagination uses `limit` (1–100, default 20) and `offset` (default 0); ordering is `createdAt DESC, id DESC`. New writes can shift offset pages; cursor pagination is a future improvement.
- Transaction details are immutable API records. No deletion/edit endpoints exist.
- Validation: HTTP 400. Unknown wallet/transaction: 404. Duplicate identity or reused key with changed contents: 409. Insufficient funds, conversion below minimum, or balance overflow: 422. Unexpected storage failure: sanitized 500/503, never raw SQL or credentials.

## Verification targets

Tests must prove persisted/reconstructed balances, duplicate identities, exact rounding, idempotent retries and conflicts, rejected negative/invalid amounts, insufficient funds, wallet-not-found behavior, atomic transfers, concurrent overspending protection, opposing transfers, live FX parsing and fallback, history filtering/pagination, and reproducible Docker startup. A fixed FX mode keeps the full test suite independent of the public provider.

## Sequelize migration verification (2026-10-30)

`yarn run check` passed all 34 tests, including concurrent requests across independent API instances, rollback on an injected storage failure, and a restart test that reads pre-ORM rows and replays their existing request key. The production Docker image was also started against the existing database: wallet identities, balances, histories, transaction details, and an old idempotency key matched the responses captured before the upgrade. No schema migration or data conversion was needed. The Postman FX success/error/timeout walkthrough passed with the compiled Sequelize implementation; its observations are in `postman/simulations/fx.context.md`.
