# FX simulation

Local fixture created 2026-10-29 from the provider subset documented in `docs/fx-provider.md`.

## Purpose

Run TonicBridge against a normal daily FX response, HTTP 503, and a provider slower than its timeout. The API and PostgreSQL run for real; only the FX dependency is simulated.

## Execution

From the repository root, with PostgreSQL running:

```bash
postman simulation run postman/simulations/fx.sim.yaml --port 4900 --output ndjson --no-history
```

In another terminal:

```bash
DATABASE_URL=postgresql://tonic:tonic_local@localhost:55432/tonicbridge yarn check:fx
```

Wait for the `listening` event before running the check. `SIMULATION_URL` overrides the simulation address. The check starts and closes its own API instances and leaves synthetic wallets in the selected database. Stop the simulation with Ctrl-C.

## Assumptions

- Owner lookup was unavailable while signed out; the local fixture uses the documented public response shape and synthetic values. It does not establish the provider's uptime or accuracy. (observed 2026-10-29)
- The fixture stamps today's UTC date so it exercises the live adapter rather than stale-date fallback. Real provider date validation also has HTTP tests in `test/fx.test.ts`. (observed 2026-10-29)

## Observations

<!-- begin:observations -->

2026-10-30: The compiled API passed the normal, HTTP 503, and timeout walkthroughs against PostgreSQL initialized from `001-initial.sql`. The walkthrough verifies response messages, pagination, idempotent replays, and exact per-currency debit/credit totals for deposit, swap, and transfer journals. The normal fixture logged its expected GET; injected failures answered before their handlers and produced labelled fixed-rate conversions. Reconciliation found no balance differences, unbalanced journals, or transactions without journals. These results establish behavior against the local fixtures.

2026-10-31: The tracing implementation based on `8ab8e14` passed the three compiled walkthroughs with `LOG_LEVEL=debug`. Logs contained nine `transaction.committed` events, each carrying its request, transaction, and journal IDs after ledger preparation and before HTTP completion. The 503 and timeout scenarios emitted `fx.fallback` with `http_status` and `network_or_timeout` respectively, and still committed the expected fixed-rate movements. The normal fixture logged its expected GET; injected failures answered before their handlers. The application also passed 55 tests, including concurrent request isolation, duplicate retries, sensitive-input omission, and a real deferred constraint rejecting COMMIT without any success event. This verifies caller logging and behavior against the local fixtures.

<!-- end:observations -->
