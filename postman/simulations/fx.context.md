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

2026-10-29: `yarn check:fx` passed with real PostgreSQL. `fx` received the documented GET and the application stored the fixture rate. `fx-error` and `fx-slow` injected failures before the member handler, so they emitted no member request event; both API runs committed labelled fixed-rate conversions within the time bound. No other dependencies are modelled.

<!-- end:observations -->
