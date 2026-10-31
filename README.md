# TonicBridge

**Five currencies. One wallet. Borderless transfers.**

TonicBridge is a REST API for Cardtonic's Operation Borderless assessment. It creates wallets, simulates deposits, swaps currencies, and transfers funds with an append-only double-entry ledger and atomic PostgreSQL transactions. Supported assets are **cNGN, cGHS, cXAF, USDx, and EURx**.

Built with Node.js 22 LTS, strict TypeScript, NestJS, Sequelize 6 (`@nestjs/sequelize` and `sequelize-typescript`), PostgreSQL 16, and `decimal.js`. `pg` is Sequelize's PostgreSQL driver. Yarn manages dependencies; ESLint, Prettier, Vitest, and Supertest provide the checks. No frontend, blockchain, or paid API credentials are needed.

## Start with Docker

Prerequisites: Docker Engine/Desktop running and Docker Compose v2.

```bash
docker compose up --build -d --wait
```

- API: <http://localhost:3000>
- Interactive Swagger UI: <http://localhost:3000/docs>
- OpenAPI JSON: <http://localhost:3000/openapi.json>
- Readiness: <http://localhost:3000/health>

PostgreSQL becomes healthy before the API starts. The API automatically applies migrations under a database advisory lock, so concurrent startups do not run a migration twice. Data persists in a named Docker volume. `docker compose down` stops the services and preserves the data.

For reproducible example rates, start with `FX_MODE=fixed docker compose up --build -d --wait`. If a port is occupied, use `API_PORT=3300 DB_PORT=55433 docker compose up --build -d --wait` and adjust URLs accordingly. Initial setup needs internet to download images and dependencies; fixed-mode operation needs no external API.

## Local development

Use Node.js 22 (`nvm use` if available) and Yarn Classic 1.22.22:

```bash
corepack enable
yarn install --frozen-lockfile
cp .env.example .env
docker compose up -d db
yarn dev
```

For a compiled local run, use `yarn build && yarn start`. Run these commands from the repository root so the API can locate its migrations and OpenAPI document. Local development needs only the database container, not a second Docker API on the same port.

| Setting                | Default                          | Purpose                                                         |
| ---------------------- | -------------------------------- | --------------------------------------------------------------- |
| `LOG_LEVEL`            | `info`                           | Application logs: `debug`, `info`, `warn`, `error`, or `silent` |
| `PORT`                 | `3000`                           | Local Node API port                                             |
| `DATABASE_URL`         | Local PostgreSQL on port `55432` | Database connection; see `.env.example`                         |
| `FX_MODE`              | `live`                           | `live` with fallback, or deterministic `fixed`                  |
| `FX_BASE_URL`          | Public currency API CDN          | Administrator-controlled provider base URL                      |
| `FX_TIMEOUT_MS`        | `2500`                           | Complete HTTP request timeout, 50–10000 ms                      |
| `FX_CACHE_SECONDS`     | `3600`                           | Successful snapshot cache, 1–86400 seconds                      |
| `API_PORT` / `DB_PORT` | `3000` / `55432`                 | Docker host ports only                                          |

Compose supplies its own internal database URL. Its credentials are disposable local development values. `.env` is ignored by Git.

## API walkthrough

The complete contract is [docs/openapi.json](docs/openapi.json); it can also be imported into Postman (set the imported `baseUrl` to your running API address). No authentication is required by this sandbox. Use synthetic identities.

| Method | Path                                  | Behavior                                          |
| ------ | ------------------------------------- | ------------------------------------------------- |
| POST   | `/wallets`                            | Create a wallet using email, E.164 phone, or both |
| GET    | `/wallets/:walletId`                  | Wallet identity                                   |
| GET    | `/wallets/:walletId/balances`         | Five balances and total USD valuation             |
| POST   | `/wallets/:walletId/deposits`         | Simulated deposit                                 |
| POST   | `/wallets/:walletId/swaps`            | Convert within the wallet                         |
| POST   | `/wallets/:walletId/transfers`        | Same/cross-currency transfer to another wallet    |
| GET    | `/wallets/:walletId/transactions`     | Paginated, filtered history                       |
| GET    | `/transactions/:transactionId`        | One immutable transaction record                  |
| GET    | `/transactions/:transactionId/ledger` | Inspect the transaction's double-entry journal    |
| GET    | `/rates`                              | All 25 directed pairs, including identity pairs   |
| GET    | `/health`                             | Database readiness                                |

Create two wallets, then copy their returned `data.id` values into the variables below. Change the sample identities if they already exist.

```bash
curl -sS http://localhost:3000/wallets \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com"}'

curl -sS http://localhost:3000/wallets \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+2348012345678"}'

WALLET_ID='paste-first-wallet-id'
RECIPIENT_ID='paste-second-wallet-id'
```

Deposit 100 USDx:

```bash
curl -i "http://localhost:3000/wallets/$WALLET_ID/deposits" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-deposit-001' \
  -d '{"currency":"USDx","amount":"100"}'
```

Repeating this request returns the original record with **HTTP 200** and `Idempotency-Replayed: true`. Its first execution returns **201** and `false`. Reusing the same key with changed contents returns **409**. Use a new key for each intended new operation.

Swap 10 USDx to cNGN, then transfer 5 USDx as EURx to the second wallet:

```bash
curl -sS "http://localhost:3000/wallets/$WALLET_ID/swaps" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-swap-001' \
  -d '{"fromCurrency":"USDx","toCurrency":"cNGN","amount":"10"}'

curl -sS "http://localhost:3000/wallets/$WALLET_ID/transfers" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-transfer-001' \
  -d "{\"recipientWalletId\":\"$RECIPIENT_ID\",\"fromCurrency\":\"USDx\",\"toCurrency\":\"EURx\",\"amount\":\"5\"}"

curl -sS "http://localhost:3000/wallets/$WALLET_ID/balances"
curl -sS "http://localhost:3000/wallets/$WALLET_ID/transactions?type=transfer&currency=EURx&limit=10&offset=0"
curl -sS http://localhost:3000/rates
```

In fixed mode, the first wallet finishes with 85 USDx and 16000 cNGN; the recipient receives 4.5 EURx. Use the same `fromCurrency` and `toCurrency` for a same-currency transfer. History returns the transaction array in `data` in `createdAt DESC, id DESC` order, with `{total, limit, offset}` in `meta`. `currency` matches either side of a transaction; `type` accepts `deposit`, `swap`, or `transfer`. Limit is 1–100, default 20; offset is 0–2147483647, default 0. Unknown query/body fields are rejected.

For an automated walkthrough against a running API:

```bash
yarn smoke
# Or: BASE_URL=http://localhost:3300 yarn smoke
```

This creates synthetic wallets and verifies deposits, retries, swaps, transfers, balances, history, rates, and the published contract URL.

## Response format

Every API response contains `statusCode`, `message`, `data`, `meta`, and `errors`. `statusCode` matches the HTTP status, including 201 for a new money operation and 200 for an idempotent replay. Ordinary successes have `meta: {}` and `errors: []`. Each endpoint returns `{data, message, meta?}` directly; `meta` is optional. Idempotent replays retain the endpoint message; their HTTP status and `Idempotency-Replayed` header identify the replay.

An empty transaction history:

```json
{
  "statusCode": 200,
  "message": "Transactions retrieved successfully.",
  "data": [],
  "meta": { "total": 0, "limit": 20, "offset": 0 },
  "errors": []
}
```

Validation failures report each issue separately, with its location. Body fields use `body.*`, query fields use `query.*`, path parameters use their name, and the request key uses `idempotency-key`:

```json
{
  "statusCode": 400,
  "message": "Invalid request.",
  "data": null,
  "meta": {},
  "errors": [{ "code": "VALIDATION_ERROR", "field": "body.email", "message": "Invalid email" }]
}
```

Domain and framework errors use the same envelope, with code/message entries in `errors`; `field` is present for validation issues. Unknown routes, malformed JSON, and sanitized server errors follow this format. Swagger HTML and `/openapi.json` keep their native formats for tooling.

This changes the earlier response shape: read resources from `data`, history pagination from `meta`, and error codes from `errors[].code`. Request payloads and HTTP status codes are unchanged.

## Project structure

This is a **NestJS backend API**. Features have their own Nest modules, controllers, services, DTOs, and Sequelize models:

```text
src/
  main.ts                         # Process entry point
  bootstrap.ts                    # App creation, response handling, and Swagger
  app.module.ts                   # Root module
  config/                         # Validated environment configuration
  database/                       # Sequelize connection and migration runner
  common/
    decorators/                   # Input validation
    errors/                       # Domain errors
    filters/                      # Uniform HTTP error responses
    interceptors/                 # Uniform success responses
    responses/                    # Controller contract, envelope, and pagination types
    pipes/                        # DTO validation and normalization
    money.ts                      # Decimal arithmetic and shared schemas
  modules/
    wallets/
      dto/
      models/                     # Wallet and Balance
      wallets.module.ts
      wallets.controller.ts
      wallets.service.ts
      balances.service.ts
      wallets.mapper.ts
    transactions/
      dto/
      models/                     # WalletTransaction and IdempotencyRequest
      transactions.module.ts
      transactions.controller.ts
      transactions.service.ts
      history.controller.ts
      history.service.ts
      transactions.mapper.ts
    ledger/                       # Accounts, journals, entries, posting, and inspection
    fx/                           # Rate provider, cache, and fallback
    health/                       # Database readiness
migrations/                       # Versioned SQL schema migrations
test/                             # HTTP, database, and financial-safety tests
```

Controllers use `@ValidatedBody(schema)`, `@ValidatedQuery(schema)`, and `@UuidParam(name)` to validate and normalize inputs through the shared Zod pipe before delegating to services. Services receive Sequelize repositories through `@InjectModel`; mappers produce the public response shapes. Models use explicit column types and map camelCase properties to the existing snake_case database columns. Each controller implements `ControllerContract<ControllerClass>`, which checks the return type of every public method, including methods added later. Methods return `ControllerResponse<T>` (or a promise of it): required `data` and `message`, with optional `meta`. Private helpers are outside that contract. The interceptor adds the HTTP status, defaults missing metadata to `{}`, and supplies `errors: []`; the exception filter formats failures using the same envelope. The history controller returns its transaction array and pagination metadata explicitly.

For example, a controller can return a paginated result directly:

```ts
export class HistoryController implements ControllerContract<HistoryController> {
  // Constructor and route/validation decorators omitted here.
  async list(walletId: string, query: HistoryQueryDto) {
    const { items, total, limit, offset } = await this.history.list(walletId, query);
    return {
      data: items,
      message: 'Transactions retrieved successfully.',
      meta: { total, limit, offset },
    };
  }
}
```

`yarn typecheck` also checks `test/types/controller-contract.ts`: valid synchronous/asynchronous returns compile, while missing data/message, raw results, invalid metadata, and incomplete return branches must produce compiler errors. No separate list of endpoint names needs updating.

## Data model and correctness

| Table                  | Role and constraints                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `wallets`              | UUID identity; unique normalized email and unique international phone; at least one required              |
| `balances`             | Ledger balance projection; one row per wallet/currency; `NUMERIC(24,6)`; nonnegative and bounded          |
| `transactions`         | Deposit/swap/transfer record with both wallet IDs, currencies, amounts, rate, rate source, and timestamps |
| `idempotency_requests` | Unique `(wallet_id, key)`; normalized request fingerprint and unique transaction reference                |
| `ledger_accounts`      | Wallet liabilities, funding accounts, and FX clearing accounts per currency                               |
| `ledger_journals`      | One immutable journal per transaction                                                                     |
| `ledger_entries`       | Positive debit/credit entries that balance per currency                                                   |
| `schema_migrations`    | Applied SQL migration filenames                                                                           |

A transfer has one transaction ID and appears once in each participant's history. A swap uses the same source and destination wallet with different currencies. A deposit has a null source wallet. There are no record edit/delete endpoints.

**Ledger.** Deposits debit funding and credit the wallet; same-currency transfers debit the sender and credit the recipient. Cross-currency movements use two FX clearing legs so every currency balances independently. Deferred database constraints enforce journal completeness, matching transaction amounts, and reconciliation with cached balances. Posted journals, entries, accounts, and transaction summaries are immutable. See [docs/ledger.md](docs/ledger.md) for the posting rules and reconciliation queries.

**Precision.** Amounts must be positive JSON decimal strings, with up to 18 integer and six fractional digits. Numbers, negative amounts, exponent notation, and extra precision are rejected. Maximum stored amount/balance is `999999999999999999.999999`. PostgreSQL returns monetary strings; all arithmetic uses decimal precision rather than JavaScript floating-point balances. Pair rates round down to 12 fractional digits, then destination amounts round down to six. For example, at the fixed rate, `1.234567 cNGN` produces `0.000771 USDx`. Zero-after-rounding and overflow are rejected. USD valuation sums each balance's rounded six-place USD value from one snapshot; it is indicative.

**Atomicity and concurrency.** Money operations use a managed `sequelize.transaction(...)` at `READ COMMITTED` isolation. Each financial write locks the involved wallet rows in sorted UUID order with Sequelize's `transaction.LOCK.NO_KEY_UPDATE` option, which generates `FOR NO KEY UPDATE`. It checks funds, records the transaction and balanced ledger entries, updates the balance projection from those postings, and records the request key inside one PostgreSQL transaction. Any failure rolls everything back. Sorted locks avoid opposing-transfer deadlocks; database constraints independently protect uniqueness and nonnegative balances. The tests exercise two independent API instances against the same database. This conservative per-wallet lock also serializes operations in different currencies for one wallet.

**Models and migrations.** Sequelize owns application reads and writes, connection pooling, and transaction management. Repository mode gives each Nest application its own model repositories. Automatic schema synchronization is disabled (`synchronize: false`); `migrations/001-initial.sql` creates the complete schema, including the ledger and its database constraints. Sequelize runs migrations under an advisory lock and records them in `schema_migrations` so startup only applies each file once. History count and page run in one managed `REPEATABLE READ` transaction.

**Idempotency.** All money endpoints require an 8–128 character `Idempotency-Key` containing letters, digits, dots, colons, underscores, or hyphens. Scope is the owning/sending wallet across all money endpoints. Normalized UUIDs and amounts make `10`, `10.0`, and `10.000000` equivalent. A fast replay lookup avoids unnecessary FX requests; a second lookup under the wallet lock handles races. FX network work happens before locks. Failed operations do not consume a key. A successful retry returns the stored amounts/rate even if current rates have changed. Keys are retained indefinitely in this prototype. After a timeout or uncertain response, retry the same request with the same key.

**Errors.** Responses use the envelope below with `data: null`, `meta: {}`, and a nonempty `errors` array. Stable application codes (for example, `INSUFFICIENT_FUNDS`) are in `errors[].code`. Invalid input is 400, unknown records 404, duplicate identities/key conflicts 409, and insufficient funds/overflow/sub-minimum conversions 422. Unexpected errors return a sanitized 500; readiness returns 503 if PostgreSQL is unavailable. Raw SQL, credentials, and request payloads are not included in unexpected-error logs. Migration failure prevents startup.

## Exchange rates and fallback

The live adapter uses [Fawaz Ahmed's daily currency API](https://github.com/fawazahmed0/exchange-api), a public, credential-free source. Each mock stablecoin is assumed to track its corresponding fiat 1:1. Provider shape, license, date validation, and discovery notes are in [docs/fx-provider.md](docs/fx-provider.md).

Requests have a timeout and body-size limit. Invalid, incomplete, stale, unavailable, or timed-out responses use this explicit **synthetic sandbox table**, versioned **2026-10-29**:

| Asset | Units per USD |
| ----- | ------------: |
| USDx  |             1 |
| cNGN  |          1600 |
| cGHS  |            15 |
| cXAF  |           600 |
| EURx  |           0.9 |

Pair rate = destination units / source units. Successful live data is cached per API instance for one hour by default; fallback has a 60-second retry cooldown. Concurrent requests share a refresh. `/rates` identifies `source` and `updatedAt`; balances and cross-currency transactions expose `rateSource` and `rateUpdatedAt`. Dates are the provider's publication time or the fixed table version date. Historical transactions never recalculate their applied rate. Deposits and same-currency transfers use rate 1 with null rate metadata and make no FX request.

## Request tracing

Application events are JSON lines on stdout. Every HTTP attempt receives a server-generated `X-Request-ID` response header, including validation failures and unknown routes. The same `requestId` follows asynchronous service calls and response completion; financial events also include `transactionId` and `journalId` as they become available. A retry has a new request ID and references the original transaction ID.

The default `LOG_LEVEL=info` includes wallet creation, committed transactions, replays, completed requests, warnings, and errors. For detailed posting and lock events, set `LOG_LEVEL=debug` in `.env`, or run:

```bash
LOG_LEVEL=debug yarn dev
# Docker: recreate the API with the requested logging level
LOG_LEVEL=debug docker compose up -d api
```

A successful money operation can be followed through `http.request.started`, `transaction.started`, `wallet.locks_waiting`, `wallet.locks_acquired`, `ledger.posting.prepared`, `transaction.committed`, and `http.request.completed`. Lock `waitMs` includes the wallet lock query; request and transaction `durationMs` measure their respective lifetimes. Ledger preparation is still uncommitted; `transaction.committed` is emitted only after Sequelize's managed transaction resolves successfully.

`transaction.failed` includes the phase (`begin`, `work`, or `commit`) and safe error codes. Work failures use `outcome: "rollback_attempted"`: Sequelize attempts rollback but suppresses rollback errors, so the application does not claim confirmation. Begin/commit failures use `outcome: "unknown"`. Check the database or retry with the same idempotency key to resolve an uncertain result. A closed HTTP connection produces `http.request.aborted`; that event makes no claim about the financial outcome.

Logs use route templates and operational metadata. Application events omit raw URLs, request/response bodies, email addresses, phone numbers, authorization headers, idempotency keys, SQL, and raw exception messages. Database failures include the SQLSTATE and constraint name when available. FX fallback logs carry a reason category. Nest infrastructure warnings/errors use its JSON console logger separately from application `LOG_LEVEL`. Logs are operational diagnostics; the database ledger remains the accounting record.

## Tests and verification

```bash
yarn test    # Full suite: starts and removes an isolated PostgreSQL Testcontainer
yarn run check # Formatting, lint, strict types, production build, and full tests
```

Docker must be running for the default test suite. It does not require a running application or paid/public provider calls. If Docker is unavailable, supply `TEST_DATABASE_URL` pointing to an existing dedicated PostgreSQL database whose name ends in `_test`. Tests apply migrations and leave synthetic records in that database. Never use a customer database.

The suite covers identity uniqueness, decimal precision, all money operations, concurrent retries and spending, opposing transfers, rollback after an injected database failure, persistence and idempotency across restarts, balanced postings, immutable journals, projection reconciliation, history, real HTTP FX parsing/fallback, and validation of actual responses against OpenAPI. Warnings from deliberate FX failures, rejected commits in constraint tests, and sanitized errors from fault injection are expected. GitHub Actions runs `yarn run check` on pushes and pull requests; no secrets are required.

An optional Postman simulation reproduces healthy FX, HTTP 503, and slow-provider conditions against the actual API and PostgreSQL. It needs Postman CLI 1.73+ and two terminals:

```bash
# Terminal 1
postman simulation run postman/simulations/fx.sim.yaml --port 4900 --output ndjson --no-history

# Terminal 2 (database running on the example port)
DATABASE_URL=postgresql://tonic:tonic_local@localhost:55432/tonicbridge yarn check:fx
```

See [the simulation context](postman/simulations/fx.context.md) for evidence and limits. No Postman sign-in or cloud publication is needed.

## Assumptions, limitations, and next steps

- This is a synchronous simulated wallet. There is no blockchain settlement, authentication, authorization, KYC, fee collection, withdrawal, or real money movement. Wallet IDs are identifiers, not access controls.
- Email identity is case-insensitive and trimmed; phones must already be E.164. Ownership of either identifier is not verified. Same-wallet transfers and same-currency swaps are rejected.
- Daily fiat rates and the fixed fallback are suitable for the assessment. A real financial service would require executable quotes, expiry/slippage controls, a fallback policy that cannot silently trade at synthetic prices, and a separate rounding/fee ledger.
- The double-entry ledger includes simulated funding and FX clearing accounts. External settlement reconciliation and reversal/refund workflows are not implemented. Six-place scale is a documented prototype choice for all five assets.
- Offset pagination can shift when new records arrive between requests. Count and page are internally consistent within one request; cursor pagination would improve long histories.
- Future production work includes authenticated wallet ownership, rate limiting, external settlement reconciliation, reversals, observability, backup/restore procedures, and an explicit idempotency retention policy. An outbox would be appropriate if external notifications or asynchronous settlement were added.

Design decisions and invariants are also recorded in [docs/decisions.md](docs/decisions.md).
