# FX source and adapter contract

The public adapter reads `GET /v1/currencies/usd.json` relative to `FX_BASE_URL`. Default: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest`.

Provider: [Fawaz Ahmed's currency API](https://github.com/fawazahmed0/exchange-api). Its documented CDN endpoint is public, needs no credentials, updates daily, and the repository is [CC0-1.0](https://github.com/fawazahmed0/exchange-api/blob/main/LICENSE). We use only the five relevant currencies. Live smoke check on 2026-10-29 returned all of them. These are indicative daily fiat reference rates, not executable market quotes or stablecoin prices.

Required response shape:

```json
{
  "date": "2026-10-29",
  "usd": { "usd": 1, "ngn": 1500, "ghs": 12, "xaf": 580, "eur": 0.92 }
}
```

The numbers above are synthetic test values. Additional currency keys are ignored. All required values must be finite, positive, within 0.000001–1000000000, and USD must equal 1. Every derived pair must remain positive at the supported 12-place rate precision. Dates must be valid UTC dates, no more than three days old or five minutes into the future. Responses are capped at 256 KiB and requests (including response bodies) time out after 2.5 seconds by default. Redirects are rejected. `FX_BASE_URL` is administrator configuration, never client request input.

Successful snapshots are shared across concurrent requests and cached for one hour per API process. Failure uses the explicit fixed sandbox table for 60 seconds, then permits a refresh. Fixed rates are documented in `src/fx.ts`; their version date is not a claim of market freshness. No last-good rate is silently relabelled as live. Restarting an API process clears its in-memory cache.

Orbit searches returned other providers rather than this endpoint; implementation follows the provider's published README and a live response. The Postman owner-workspace search was unavailable because the CLI was signed out. Local mock examples follow this documented subset; no credentials or paid service are required.

On 2026-10-29 the full API HTTP walkthrough also passed against this public provider: the stored USDx-to-cNGN rate was `1345.463968880000`, and 10 USDx converted to `13454.639688` cNGN. The separately committed Postman simulation verified the success, HTTP 503, and timeout paths against real PostgreSQL; see `postman/simulations/fx.context.md`. These checks establish adapter behavior, not ongoing provider availability or market accuracy.
