# KAYAN k6 test kit (load / stress / spike) + synthetic data

Written from a read-only look at https://github.com/ahmadtefa/ERP_KAYAN (backend/src/modules/*). Nothing was pushed or changed in the repo. Use a TEST copy of the server and database only.

## Files
- `load.js`   100 concurrent sessions: ramp 1m, hold 5m, down 30s (~7 min). Env: VUS, RAMP, HOLD, P95_MS.
- `stress.js` steps 50 > 100 > 200 > 300 > 400 sessions, 2m each, then recovery probe on /health (~13 min). Env: STEPS, STEP_DURATION.
- `spike.js`  baseline 10, jump to 100 in 10s, hold 2m, drop, recover 2m, second spike (~9 min). Env: BASELINE_VUS, SPIKE_VUS.
- `lib/common.js` shared login, requests, checks, thresholds.
- `gen-data.mjs` synthetic data generator (see below).
- `mock/server.mjs` tiny fake API used only to check the scripts execute. Not the real server.

## What a "session" does (all GET, real routes)
/auth/me, /dashboard/summary, /dashboard/monthly, /parties/customers (+ one detail), /inventory/items (+ one detail), /inventory/stock, /inventory/warehouses, /sales/invoices, /sales/quotations, /search. Some iterations also call report routes (/reports/trial-balance, profit-and-loss, balance-sheet, receivables-aging, customer-balances, /inventory/reports/valuation). `WRITES=1` (load.js only) also creates one synthetic customer (code `K6-<run>-...`) and deactivates it.

## Before you run: server settings (important)
The API has an in-memory rate limit (backend/src/common/guards/rate-limit.guard.ts): 10 login/refresh per minute and 300 other requests per minute per client IP. 100 sessions from one machine will hit 429 within seconds, which measures the limiter, not the app. On the TEST server set in backend/.env:
- `RATE_LIMIT_ENABLED=false` (or `RATE_LIMIT_MAX=1000000`)
- `JWT_ACCESS_TTL=3600` (default 900s; the scripts log in once in setup() and share the token, so runs longer than 15 min would get 401s. Counter `kayan_http_401` shows it.)
Also run k6 from a different machine than the server if you want honest CPU numbers.

## Run
```
k6 run -e BASE_URL=http://TEST-HOST:3000/api/v1 -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='...' load.js
k6 run ... stress.js
k6 run ... spike.js
```
ADMIN_PASSWORD has no default on purpose. The account needs reports.read, parties.customers.read, inventory.*.read, sales.*.read (the admin has them). The seeded DB should hold some data, otherwise detail calls are skipped and lists are empty (use gen-data.mjs).
Custom metrics: kayan_http_429, kayan_http_401, kayan_http_5xx, kayan_checks_ok, kayan_report_duration. Thresholds are starting points (p95 < 1.5s load, 2.5s spike, 3s stress); change them to your target.

## Synthetic data (gen-data.mjs, Node 18+)
- `node gen-data.mjs` writes data/customers.json|csv, items.json|csv, invoice-templates.json. Fake names (Arabic + English, marked "TEST"), phones 000..., emails @example.invalid, prefix `SYN-`. Deterministic via SEED_NUMBER. Touches nothing else.
- `SEED=1 ADMIN_PASSWORD=... node gen-data.mjs` creates them on the TEST server through POST /parties/customers, /inventory/items, and DRAFT /sales/invoices (never posted, no stock tracking, so no journal entries). Writes data/seeded-ids.json.
- `CLEANUP=1 ...` deactivates the created customers and items. Draft invoices cannot be deleted through the routes I read; reset the test DB to remove them.
- Counts: CUSTOMERS=200 ITEMS=300 INVOICES=100 (defaults). DELAY_MS=250 keeps under the 300/min limit.

## What was verified, and what was not
Verified: load.js ran end to end (5 sessions, 15s, WRITES=1) against the local mock with all checks passing; stress.js and spike.js load and start executing without script errors against the mock (they were cut off by my time limit, I did not watch them finish); gen-data.mjs offline output generated, and SEED/CLEANUP ran against the mock (3 customers, 3 items, 2 invoices). Route paths, auth flow (POST /auth/login returns accessToken), DTO field names and the rate limit were read from the repo source.
NOT verified: no run against the real KAYAN API or database (none available to me), so response shapes on real data, the p95 thresholds, real capacity numbers, and whether the seeded payloads are accepted by server validation (they match the DTOs I read, but unrun) are unconfirmed. k6 version used for checks: 0.54.0. The report routes used take optional from/to parameters (defaults: start of year to today, per PeriodQueryDto), so they are called without parameters.
