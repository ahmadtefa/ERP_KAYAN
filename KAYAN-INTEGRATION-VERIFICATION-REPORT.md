# KAYAN ERP — Integration Verification Report

**Date:** 2026-10-20 (last code commit `cb81bc3`; the installer is built from it)
**Earlier revisions:** 2026-10-19 (`5da76f2`, `8cdd84d`) — kept as history below
**Repository:** [ahmadtefa/ERP_KAYAN](https://github.com/ahmadtefa/ERP_KAYAN)
**Integration branch:** `arena/a5a099ec-erp-kayan`
**Base:** `main` at `e1a2a7e` (unchanged; nothing was merged into `main`)
**Open pull request:** [#52](https://github.com/ahmadtefa/ERP_KAYAN/pull/52) — **OPEN**, base `main`, head `arena/a5a099ec-erp-kayan`, MERGEABLE, not merged

**Current verification (2026-10-20, head `cb81bc3`):** CI run `39340110065` is green in all four
jobs (Backend with real PostgreSQL and demo restore, Regression scenarios, Flutter Web, Linux
Desktop), and Windows run `39340110060` built and smoke-tested the installer from `cb81bc3`.
**Section 17 is authoritative for the current state.** Sections 1–16 are kept as the historical
record of their own commits; where they say "not implemented yet" or quote an older artifact,
section 17 supersedes them.

**How to read a status:** `DONE` means the backend **and** the Flutter surface the requirement
asks for exist and were exercised; `API ONLY` means the rule exists on the server but the UI is
missing, and is therefore **not complete** against a UI requirement; `NOT VERIFIED` means no test
was run; `LIMITATION` is a documented design boundary.

This report records what was actually verified on this branch, what was not, and the exact
evidence for each claim. A status of **NOT VERIFIED** means no test was run; it is never a
guessed "probably works".

---

## 0. Status at a glance (answer first)

> Superseded by section 17 for the current head. This table is the current answer.

| Question | Answer |
|---|---|
| Is the branch merged into `main`? | **No.** `main` is `e1a2a7e`; PR #52 is open. |
| Is the cost-center module finished end to end? | **Yes in the product surface:** master data with parent hierarchy, single-centre pickers on invoice/journal/cash lines, multi-centre allocations on manual journal lines, report filters, budgets and stock attribution. Visual walkthrough on Windows is **not verified**. |
| Does a Flutter UI exist for the quotations work? | **Yes:** editor, list, detail, subject, per-offer tax switch, column editor with templates, tables, discounts, statuses, conversion and four separate export actions. |
| Are Arabic and English strings complete? | **Yes:** 719 keys in both languages, 1323 usages, `tools/check-l10n-keys.mjs` passes. RTL rendering was **not visually verified**. |
| Are the tests green? | **Yes on `cb81bc3`:** CI `39340110065` — Backend, Regression, Flutter Web and Linux Desktop all **success**. |
| Is the installer built from the current code? | **Yes:** artifact `12228799462` from run `39340110060`, which checked out `cb81bc3` — the last commit that changes code or any packaged file. SHA-256 `3FA4D266…0D00`, 344,698,505 bytes, installed-package smoke test **passed**. Unsigned. |
| Is LAN verified from a second computer? | **No — NOT VERIFIED.** |
| Was a human click-through of the installed UI done? | **No — NOT VERIFIED.** |

## 1. Final state

| Item | Value |
|---|---|
| Branch | `arena/a5a099ec-erp-kayan` |
| Code commit | `cb81bc3` — `Assert the field the API actually receives for the per-offer tax choice` |
| Report commit | the commit that adds this revision (see `git log -1 -- KAYAN-INTEGRATION-VERIFICATION-REPORT.md`) |
| Commits ahead of `main` | 70 |
| Working tree | clean when the verification runs were made |
| `main` | `e1a2a7e`, untouched by this branch |
| Merged into `main`? | **No** |
| New production release published? | **No** (the publish step is restricted to `main`) |
| CI | `39340110065` — four jobs, all success |
| Installer | `12228799462` from run `39340110060` at `cb81bc3`; 344,698,505 bytes; SHA-256 `3FA4D266A65145A1EC50F52A622EFEF120D745669AD5D26604B7B0990C290D00`; smoke test passed |

The installer workflow checked out `cb81bc3`, the last commit that changes application code or
any file the installer packages. The report commits that follow add Markdown only; they are not
packaged, and the installer's `runtime-manifest.json` therefore records `sourceCommit=cb81bc3`.

---

## 2. Source pull requests, branches and integration status

| PR | Branch | Base | Head | Size | State | Really integrated? |
|---|---|---|---|---|---|---|
| [#51](https://github.com/ahmadtefa/ERP_KAYAN/pull/51) | `arena/92b91cee-erp-kayan` | `main` | `7e2514c` | 100 files, +11,487 / −919 | OPEN, MERGEABLE, unmerged | **Yes, into the integration branch.** `7e2514c` is an ancestor of `e3c577d` (`git merge-base --is-ancestor`), so all of its content is in this branch. It is *not* in `main`. |
| [#52](https://github.com/ahmadtefa/ERP_KAYAN/pull/52) | `arena/a5a099ec-erp-kayan` | `main` | **`cb81bc3`** | 204 files, +35,505 / −1,590 | OPEN, MERGEABLE, unmerged, 70 commits | This is the integration branch itself. It contains #51, the cost-center module, invoices and returns discounts, the complete quotation document (subject, per-offer tax flag, editable columns and DB templates, multiple tables, statuses, safe conversion, Arabic print/export), LAN card, per-warehouse stock, and this report. |
| [#50](https://github.com/ahmadtefa/ERP_KAYAN/pull/50) | — | `main` | `e1a2a7e` | — | MERGED | Yes — this is the current `main`. |
| [#49](https://github.com/ahmadtefa/ERP_KAYAN/pull/49) | — | `main` | `935a6a4` | 1 file | CLOSED, unmerged | Its change (`needsSetup` on an existing API) is present in the branch (verified in `lib/core/backend/local_backend_io.dart`), although the commit itself is not an ancestor (divergent history). |

Commit chain on the integration branch (oldest first):

```
e1a2a7e  main
  └─ … 13 commits from PR #51 … 7e2514c
       └─ c69f349  fix: harden auth, permissions, inventory and accounting; add RepairTool.exe
          └─ f3f27ce  test(core): cover the new session-expired and permission failure types
             └─ 856437a  docs(windows): state the real code-signing status
                └─ 2c7ecfd  feat(accounting): cost centers as a real accounting dimension
                   └─ e3c577d  fix(backup): keep cost-centre splits in company JSON backups
                      └─ abb8e3f  docs: integration verification report for PR #52
                         └─ 8aa52e5  feat(accounting): budgets, stock cost-center attribution,
                                     and the cost-center screens
                            └─ 2272580  fix(ui): keep the document forms unchanged when no
                                        cost centre exists
                               └─ 5da76f2  test(ui): assert the cost-center rows by name
                                           (current head)
```

No branch was deleted, no history was rewritten, and `main` was not modified.

The chain above stops at `5da76f2`; the later work (invoices, quotations, LAN, stock split and the CI fixes) is listed in section 17.

---

## 3. What changed, by area

`git diff --stat main..5da76f2` — **155 files, +21,228 / −1,192** (140 files at `e3c577d`).

### Backend (`backend/src`, 77 files)

- **Sessions/auth:** refresh-token rotation with reuse rejection, `tokenVersion`
  invalidation, single-flight-safe refresh contract, new failure types surfaced to the client.
- **Permissions:** live permission checks on every request, `UserPermission` grants,
  Super-Admin handling, permission catalogue additions (`accounting.openingbalances.manage`,
  `cash.accounts.read/manage`, `sales.returns.*`, `purchases.returns.*`,
  `inventory.stock.adjust`, `reports.print`, `admin.*`, `accounting.costcenters.read/manage`).
- **Opening balances:** posting is transactional; a second document for the same branch/period
  is refused; unbalanced documents roll back; import is idempotent; warehouse and landed-cost
  fields are carried.
- **Parties:** `includeInactive` handled so an invoice form can still show a customer that was
  deactivated after the invoice was drafted.
- **Cash & banks:** bank-kind normalization, cash-account `accountId`, transfers, balances.
- **Returns:** first-class sales/purchase returns with links to the original invoice/line,
  cost restoration, reversal parity.
- **Inventory:** item creation writes the `StockMovement`, `StockBalance` and journal entry
  atomically; opening stock via the opening-balance document.
- **Cost centers (new dimension):** see section 5.
- **Backup/restore:** company JSON backup and full PostgreSQL backup/restore; the JSON format
  now carries cost-centre splits (fixed in `e3c577d`).
- **Web root:** the API serves the compiled Flutter web build with SPA fallback when
  `KAYAN_WEB_ROOT`/`build/web` exists; `/api/v1/health` still routes to the API.

### Flutter (`lib/`, 37 files)

- Session recovery (no endless spinners), localized messages, permission-aware navigation,
  opening-balance screens, cash/bank screens, returns screens, LAN access card, export/print
  actions. Arabic RTL and English LTR are both kept.
- **Cost-center screen** (`cost_centers_screen.dart`): tree with depth, search, type/status/
  parent filters, create, edit, activate/deactivate, delete (refused when referenced, with the
  server's own message), details with usage counts.
- **Budget screen** (`budgets_screen.dart`): list, create, edit, retire, gated by
  `accounting.budgets.manage`.
- **Pickers**: one optional centre on a manual-journal line, an invoice line and a cash voucher.
- **Reports**: two new tabs — cost centers (own vs. rolled-up, unallocated bucket, reconciliation
  totals, drill-down) and budget vs. actual (budget, actual, variance, variance %, favourable/
  unfavourable, status).

### Flutter tests (`test/`, 5 files changed/new)

- `test/widget/invoice_cost_center_test.dart` (2 tests), `test/widget/cost_centers_screen_test.dart`
  (3 tests), plus the earlier landed-cost and client smoke tests.

### Windows distribution (`distribution/windows`, 6 files; `scripts/smoke-test-installed-windows.ps1`)

- New `RepairTool.exe` (C#, compiled with the real `csc.exe` during the build), Start-menu
  shortcut, `--diagnose` / `--repair` modes, redacted log.
- Installer stages the backend, the Node runtime, PostgreSQL binaries, the web build and the
  repair tool; the installed-package smoke test exercises service, database preparation,
  client startup, login, backup/restore and the repair tool.

### Migrations (`backend/prisma/migrations`, 27 applied)

- Latest: `20261019120000_cost_centers_hierarchy_allocations`.
- See section 6.

---

## 4. Status of every user-reported problem

The nine issues below are the ones tracked in PR #52; the A–F grouping is the one used in the
request. Evidence is a real API scenario against PostgreSQL unless stated otherwise.

| # | Problem (A–F grouping) | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Expired token / endless loading (A) | **PASS (automated)** | Refresh rotation, reuse rejection, bounded retry; `scenario-accounting` checks session refresh, logout, reuse-after-logout (`401`), and a request without a token (`401`). Flutter analyzer/tests/build pass in CI. A human sitting through an idle timeout in the UI was **NOT VERIFIED**. |
| 2 | Customers/suppliers missing in invoice selection (F) | **PASS (automated)** | `parties.service` honours `includeInactive`; `scenario-regressions` verifies a created customer is returned by the list the invoice form reads (32/32). Manual check of a *deactivated* customer in the Flutter form: **NOT VERIFIED**. |
| 3 | App unusable after idle (A) | **PASS (automated)** | Same session-recovery path as #1; covered by the refresh/retry checks and the Flutter test suite. Human idle test: **NOT VERIFIED**. |
| 4 | Granular admin permissions (F) | **PASS (automated)** | Backend guards plus `UserPermission`; scenarios exercise `403` refusals (read-only user, user without cost-center permission) and immediate grant/revoke effects. Full role × screen matrix on a real installation: **NOT VERIFIED**. |
| 5 | Server address shows no browser UI (E) | **PASS (automated)** | API serves `build/web` with SPA fallback; CI probes `/`, a SPA route and `/api/v1/health`. Manual browser check on Windows: **NOT VERIFIED** (Windows CI starts the installed client and checks the API, not the rendered page). |
| 6 | Opening-balance template download fails (A) | **PASS (automated)** | Short-lived download ticket (`?ticket=`) instead of a bearer token in the URL; `?token=` refused. Unit/scenario coverage; clicking the button in the UI: **NOT VERIFIED**. |
| 7 | Opening-balance posting fails (A) | **PASS (automated)** | `scenario-accounting` posts opening balances, reads them back, and refuses a second set for the same branch/period; unbalanced posting rolls back. |
| 8 | Banks / cash accounts broken (B) | **PASS (automated)** | `scenario-accounting` opens a cash box and a bank account, collects, pays, transfers between them, and checks balances and the ledger. |
| 9 | Item creation + opening stock (D) | **PASS (automated)** | Item, `StockMovement`, `StockBalance` and journal entry are written atomically; opening stock through the opening-balance document; refuses a second opening document. |
| C | Returns (sales & purchase) | **PASS (automated)** | `scenario-returns`: **88 PASS / 0 FAIL**, including original-invoice links, returned cost, VAT/receivable/payable reversal, and double-reversal refusal. |
| E | LAN access from a second computer | **PARTIAL — NOT VERIFIED end-to-end** | Code and docs support it only as an explicit server-mode setup (section 11). A second physical computer was **not** used; no firewall rule is created automatically. |

---

## 5. Cost-center module — what exists and what does not

### Implemented and verified on the server

Everything in this table is a **server** capability, proven through the API. Whether a Flutter
screen exposes it is answered in the next table, and a UI requirement is never satisfied by a
server capability alone.

| Capability | Evidence |
|---|---|
| Master data: `type` (`DEPARTMENT`, `ADMINISTRATIVE_UNIT`, `PROJECT`), parent hierarchy, code/name (AR+EN), description, responsible person, start/end dates, active flag | `scenario-cost-centers` 49/49 |
| Guards: duplicate code `409`, self-parent/cycle `400`, depth limit 12, inactive centre refused for new postings `400` | 49/49 |
| Delete blocked while journal lines, allocations, invoice lines or cash vouchers reference the centre; deactivation available instead | 49/49 (`usage` endpoint reports 7 attributed lines) |
| Manual journal entries: a single centre per line **and** a split across several centres, whose amounts must add up to the line total | 49/49, `journal-entries.service`. **API only:** the Flutter editor sets one centre and edits no splits. |
| Sales and purchase invoice lines carry a centre; revenue, COGS and inventory postings are attributed; sales-return lines inherit the centre | 49/49 |
| Reversals copy the original allocations exactly (no invented or lost amounts) | 49/49 |
| Cash receipts/payments can carry a centre on the counter-account side | exercised through the real API on a disposable database: payment `PV-000002` posted `75.0000`, the expense line (`5101`) carried the centre, the cash line (`1101`) stayed unallocated, and a second post was refused (`400`) |
| Report `GET /reports/cost-centers`: own vs. rolled-up revenue/expenses/result, `unallocated` bucket, reconciliation invariant (`totals + unallocated == ledger`), filters (`from`, `to`, `asOf`, `branchId`, `type`, `costCenterId`, `includeInactive`) | 49/49. The Flutter tab uses `from`/`to`/`includeInactive` only. |
| Drill-down `GET /reports/cost-centers/:id/transactions` (and `/unallocated/transactions`), page ≤ 500 | 49/49 |
| Permissions `accounting.costcenters.read` / `.manage`, ADMIN + ACCOUNTANT grants, `reports.read` roles receive read | 25/25 upgrade test (19/19 at `e3c577d`) |
| Company JSON backup keeps splits and restores them | 2 allocation rows in the file; restore reproduced the report exactly (see section 7) |
| Upgrade from a pre-cost-center database without inventing data | 25/25 upgrade test (19/19 at `e3c577d`) |

Report attribution rule: `COALESCE(allocation.costCenterId, line.costCenterId)` with
`COALESCE(allocation.amount, debit + credit)` over posted/reversed `REVENUE` and `EXPENSE`
accounts; a line with no centre lands in `unallocated`.

### Gap status at `5da76f2`

_This table started as the "missing" list at `e3c577d` and was rewritten in the Final Completion
Pass (section 14) where new evidence exists. Rows that are now covered say so; rows that are not
say so just as plainly._

| Gap | Status now | Detail |
|---|---|---|
| Flutter user interface | **Implemented for master data, budgets, pickers and reports** (`8aa52e5`, `2272580`) | Cost-center screen (tree with depth, search, type/status/parent filters, create, edit, deactivate/reactivate, delete with the server's refusal shown, details with usage), budget screen, pickers on manual-journal lines, invoice lines and cash vouchers, and two report tabs. Evidence: `flutter analyze` + `flutter test` + web/Linux builds in CI; new widget tests (section 14.3); Arabic and English strings in both ARBs. A human click-through on a desktop is **NOT VERIFIED**. |
| Multi-centre allocation editor | **Still missing — API only** | The API accepts `allocations[]` on a journal line and validates that the parts equal the line exactly, but no Flutter screen edits them; the pickers assign one centre per line. **A UI requirement is not met while it is API-only.** |
| Display on document detail | **Partial** | The cost-center report drills into attributed lines. The invoice-detail dialog and the journal-entry detail do not print the centre or its split yet. Historical values are never rewritten. |
| Inventory stock documents | **Server done (`ADJUSTMENT`/`COUNT`), no UI** | The **API** accepts an optional `costCenterId` on an adjustment or a count; the inventory-difference line is attributed and the inventory line stays unallocated. `TRANSFER` refuses a centre with an explicit 400. A reversal keeps the same attribution. Evidence: `scenario-budgets` 29/29. **The stock screen has no picker**, so an operator cannot use it from the program. Opening stock is still created through the opening-balance document and is not attributable. |
| Opening balances | **Still missing** | Opening-balance lines are predominantly balance-sheet lines and are not attributable. |
| Budgets vs. actual | **Implemented end to end** (`8aa52e5`) | `budgets` table, CRUD, retire, permission pair, and `GET /reports/budgets` reading **posted** ledger lines only, per budget's own period. UI screen and report tab. Evidence: `budgets.service.spec` 10/10, `scenario-budgets` 29/29. |
| Bulk reallocation | **Still missing** | No tool to re-attribute historical lines; by design nothing is re-attributed automatically. |
| Export | **Still missing as a template** | The generic report export list has no cost-center or budget template, so the export button is hidden on those two tabs rather than offering an action that would fail. |

---

## 6. Migrations and backward compatibility

- **28 migrations** are applied on a fresh database (**48** public tables) at `5da76f2`. The
  Final Completion Pass adds `20261019160000_budgets_and_stock_cost_centers` (section 14.2).
- The new migration `20261019120000_cost_centers_hierarchy_allocations` is **additive and
  idempotent**:
  - creates the `CostCenterType` enum if absent;
  - adds `cost_centers.type` (default `DEPARTMENT`), `parentId`, `description`,
    `responsiblePerson`, `startDate`, `endDate`;
  - creates `journal_line_allocations` with positive-amount and FK constraints and indexes;
  - adds nullable `costCenterId` to `sales_invoice_lines`, `purchase_invoice_lines` and
    `cash_vouchers` (the cash-voucher block is guarded so re-running is a no-op);
  - adds the `read` permission (and re-adds `manage` only if missing) and grants them to
    `ADMIN`/`ACCOUNTANT`; grants `read` to every role that already has `reports.read`.
- **No historical row is changed, deleted or re-attributed.** Existing centres become
  `DEPARTMENT` with `NULL` parent/dates; existing journal lines keep their single
  `costCenterId`; **zero** allocation rows are invented.
- **Upgrade reproduction** (`backend/scripts/verify-cost-center-upgrade.mjs`): builds a
  26-migration database, seeds it, removes the new permissions, inserts a legacy flat centre
  and a legacy journal line, then applies the migration. **19/19 checks pass**, including:
  legacy centre preserved, legacy line preserved, no invented allocations, permissions and
  grants restored (including a custom `reports.read` role), 3 CHECK constraints, 5 indexes,
  enum present, self-parent/date-window/zero/negative allocation refused with `23514`, second
  run changes nothing.
- **Backup compatibility:** the company JSON format stays at version 1. `journalLineAllocation`
  was added to the backup in `e3c577d`. Old files without the table still restore; if a database
  holds allocation rows and the file does not, the restore is **refused** with an explicit
  message instead of silently moving the amounts to `unallocated`.
- `prepare-database.mjs` runs `migrate deploy` on every start and seeds only an empty database;
  permissions added by migrations are therefore present even when seeding is skipped.

---

## 7. Tests actually run (2026-10-19, this branch)

> **Historical section.** The numbers below belong to `5da76f2`. The current test evidence is in section 17.

Two sets of evidence are recorded, and they are labelled so they cannot be confused:

1. **`e3c577d`** — the integration work before the Final Completion Pass (first table below).
2. **The Final Completion Pass** — a full local re-run **on the exact head `5da76f2`** (second
   table below; how it was reproduced without the Prisma engine CDN is in section 7.1), plus CI
   on the same commit.

Local environment: Linux, Node 22/24, embedded PostgreSQL 18.4 on port 55432, disposable
databases built by applying the migration SQL directly. **No Flutter SDK, Inno Setup or
`csc.exe` is available in this environment**, so Windows/Flutter evidence comes from CI.

| Command | Result |
|---|---|
| `npx tsc --noEmit` (backend) | **CLEAN** |
| `npx jest --runInBand` (backend) | **42 suites / 288 tests PASS** |
| `npm run build` (backend) | **OK** (`dist/src/main.js`, `dist/prisma/seed.js`) |
| `node backend/scripts/scenario-accounting.mjs` (fresh DB) | **79/79 PASS, 3 skipped, exit 0** |
| `node backend/scripts/scenario-cost-centers.mjs` | **49/49 PASS** |
| `node backend/scripts/scenario-regressions.mjs` | **32/32 PASS** |
| `node backend/scripts/scenario-returns.mjs` | **88 PASS / 0 FAIL** |
| `node backend/scripts/scenario-warehouses-orders.mjs` | **35/35 PASS** |
| `node backend/scripts/scenario-imports.mjs` | **13/13 PASS** |
| `node backend/scripts/verify-cost-center-upgrade.mjs` | **19/19 PASS** |
| Cash payment voucher with a cost centre (real API, disposable DB) | post `201`; expense line attributed, cash line unallocated; second post refused `400` |
| Company JSON backup round trip on a database with splits | file contained **2** `journalLineAllocation` rows and **43** tables; restore returned `201`, restored **250** rows, and the cost-center report was **identical** before/after |

#### Final Completion Pass — local re-run on the exact head `5da76f2`

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **CLEAN** |
| `npx jest --runInBand` | **43 suites / 298 tests PASS** (was 42/288; `budgets.service.spec.ts` adds 1 suite / 10 tests) |
| `npm run build` | **OK** |
| `node scripts/verify-cost-center-upgrade.mjs` | **25/25 PASS** (was 19/19; the six new checks cover the budgets table, its two CHECK constraints, the one-active-definition index, both budget permissions and their grants, and the stock-document column) |
| `node scripts/scenario-budgets.mjs` (new) | **29/29 PASS** — budgets CRUD/validation, duplicate period, inactive centre, balance-sheet account, `403` for a restricted user, posted-only actuals, variance, retire-and-recreate, stock-adjustment attribution, transfer refusal, reversal attribution |
| `node scripts/scenario-cost-centers.mjs` | **49/49 PASS** |
| `node scripts/scenario-regressions.mjs` | **32/32 PASS** |
| `node scripts/scenario-returns.mjs` | **88 PASS / 0 FAIL** |
| `node scripts/scenario-warehouses-orders.mjs` | **35/35 PASS** |
| `node scripts/scenario-imports.mjs` | **13/13 PASS** |
| `node scripts/scenario-accounting.mjs` | **79/79 PASS, 3 skipped, exit 0** |

The Flutter suite could not be run locally (no SDK). CI ran it on `5da76f2` and both Flutter
jobs are green; the expanded reporter in the preceding run counted **130** test cases
(128 passed, 2 failed — and those two assertions are exactly what `5da76f2` fixes, with the
job green afterwards). Five of the 130 are new: two in
`test/widget/invoice_cost_center_test.dart` and three in
`test/widget/cost_centers_screen_test.dart`. The static count in `test/` is 127 declared
`test`/`testWidgets` cases across 25 files; the difference is generated cases in loops.

#### 7.1 How the backend evidence was reproduced on the exact head

The workspace had been reset, which removed `node_modules`, `dist`, the database cluster and the
toolchains. The backend was rebuilt without network access to the Prisma engine CDN:

1. `npm ci` (734 packages, npm registry) — the only registry this sandbox can reach.
2. The Prisma **client** was generated offline from the real `prisma/schema.prisma` with
   `@prisma/internals`' `getGenerators` + the bundled `@prisma/client/generator-build`
   generator (no schema/query-engine binary is needed because the schema declares
   `engineType = "client"` and a driver adapter). 48 models, 8.1 MB of client.
3. `npx tsc --noEmit` → clean; `npx jest --runInBand` → **43 suites / 298 tests**;
   `npm run build` → `dist/src/main.js` + `dist/prisma/seed.js`.
4. A disposable PostgreSQL 18.4 (`embedded-postgres`) on `127.0.0.1:55432`; a fresh database
   per scenario, built by applying the **28 migration SQL files** in order (**48** tables),
   then `dist/prisma/seed.js`.
5. The API was started from the **built** `dist/` on a separate port per scenario, and each
   scenario was run against it. Results in the table above.

**Still not runnable here:** `flutter analyze` / `flutter test` / `flutter build` (no Dart/Flutter
SDK, and the SDK host is outside this sandbox's egress allowlist), Inno Setup and `csc.exe`.
Those come from CI only, and the CI run on this exact commit is green.

### CI evidence

| Run | Result |
|---|---|
| [ERP KAYAN CI run 39246795396](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39246795396) on `e3c577d` | **SUCCESS** — all four jobs: Flutter Web (analyze, test, build), Linux Desktop (analyze, test, build), Backend (real Prisma + PostgreSQL), Regression scenario (issues 1–9, 32 checks) |
| [Windows Installer run 39246795416](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39246795416) on `e3c577d` | **SUCCESS** — 32m56s (11:45:07Z → 12:18:03Z) |
| [ERP KAYAN CI run 39260659445](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39260659445) on `5da76f2` | **SUCCESS** — all four jobs, including Flutter Web and Linux Desktop (analyze, 130 tests, build) |
| [Windows Installer run 39260659483](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39260659483) on `5da76f2` | **SUCCESS** — 30m50s (13:29:57Z → 14:00:47Z); artifact `12192261692` |
| [ERP KAYAN CI run 39276354174](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39276354174) on `8cdd84d` (report commit) | **SUCCESS** — same four jobs |
| [Windows Installer run 39276354529](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39276354529) on `8cdd84d` | **SUCCESS** — artifact `12199953707`, smoke test passed |

The Windows job also runs the backend test suite, `flutter analyze`, `flutter test` and the
Flutter web build before packaging, so the installer is built from a tree that passed the same
checks as the Linux CI run. Step-level logs could not be downloaded in this sandbox
(`results-receiver.actions.githubusercontent.com` is outside the allowed egress), so the
evidence used here is the job conclusion plus the check-run annotations quoted in section 8.

---

## 8. Installer build status and provenance

> **Historical section.** The current installer is in section 17; the artifacts below are not deliverables of the current head.

[Windows Installer run 39260659483](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39260659483)
built the installer from **`5da76f2`** and **succeeded** in 30m50s. The job:

- ran the backend test suite (`Test backend`), `flutter analyze`, `flutter test` and the Flutter
  web build before packaging;
- compiled `RepairTool.exe` early with `csc.exe` (`Compile RepairTool.exe (early check)`);
- generated the platform icons, built the Flutter Windows release, installed Inno Setup 6 and
  built `KAYAN-ERP-Setup.exe`, then printed its SHA-256 (`Verify installer artifact` — success);
- installed the package and ran `scripts/smoke-test-installed-windows.ps1` against it
  (`Smoke-test the actual installed Windows application` — success).

Check-run annotations on that job, quoted verbatim:

> Windows installer smoke test passed: service, database preparation, client startup on port
> 3000, login, company JSON and full PostgreSQL backup/restore all verified.

> Installed Windows PostgreSQL backup/restore passed: real archive, mutation, checked restore,
> safety copy, re-login and original sentinel verified.

> Installed Windows company JSON backup/restore passed: snapshot, mutation, restore, re-login
> and original sentinel verified.

> `KAYAN-ERP-Setup.exe` SHA256=2B0560CD16135D18FF4F12B2303660DE5B36B286BDD76C9D09489A2CE6AE8EFA

What the smoke script actually exercises on the installed package (read from
`scripts/smoke-test-installed-windows.ps1`, all steps succeeded in this run):

| Step | Evidence in the run |
|---|---|
| Bundled PostgreSQL service runs, `initdb` used the restricted token | job success; the script fails the job otherwise |
| Database prepared, migration/seed, credentials preserved from a deliberately broken `kayan.env` DACL | job success |
| Upgrading over the previous installation keeps the company-data probe | job success |
| Installed client starts a healthy local API on a free port (3000) | annotation above |
| Login against the bundled database returns a token | annotation above |
| Company JSON backup → mutate → restore → re-login → sentinel verified | annotation above |
| Full PostgreSQL backup → mutate → checked restore → re-login → sentinel verified | annotation above |
| `RepairTool.exe --diagnose` detects a stopped service, `--repair` fixes it, `--diagnose` is healthy afterwards, `KAYAN-REPAIR-OK` logged, company data preserved | `Smoke-test…` step success (the script `Fail`s if any of these assertions does not hold) |

**A second, identical build from the report commit.**
[Run 39276354529](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39276354529) rebuilt the
installer from **`8cdd84d`** — the commit that adds this report — when that commit was pushed.
It succeeded (all five checks green, smoke test `15:42:23Z → 15:47:29Z`) and produced artifact
`12199953707`, 344,516,260 bytes, `KAYAN-ERP-Setup.exe` SHA-256
`E08B3BCD0F9E179AFBB1CE7B9065F7E89AD9E5BB23A18E59E42948BF8AB0BAD6`, expiring
2026-11-02T15:47:30Z. The same three notices were emitted.

That build is the strongest provenance statement available: the package was produced from a
commit whose tree differs from `5da76f2` only by this markdown file, and it passed the same
installed-package checks. Any further edit to this file cannot change the package, because
`build-installer.ps1` packages `backend/{dist,prisma,scripts,…}`, `build/web`, `distribution`
files and the runtimes — not repository documentation.

**Code signing: none.** There is no Authenticode signing step in `build-installer.ps1` or the
workflow. Windows SmartScreen will warn on first run. This is stated in the Windows guide rather
than claimed otherwise.

## 9. `KAYAN-ERP-Setup.exe` — location, size, hash, expiration

> **Historical section.** Sizes and hashes below belong to earlier commits. The current artifact is recorded in section 17.

### Current artifact — built from `5da76f2`

| Item | Value |
|---|---|
| Artifact | [`KAYAN-ERP-Windows-x64-Installer`](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39260659483/artifacts/12192261692) (GitHub login required) |
| Artifact id | `12192261692` |
| Size | **344,523,931 bytes** (ZIP containing `KAYAN-ERP-Setup.exe`) |
| Created | 2026-10-19T14:00:19Z |
| Expires | **2026-11-02T14:00:08Z** (14-day retention) |
| `KAYAN-ERP-Setup.exe` SHA-256 | `2B0560CD16135D18FF4F12B2303660DE5B36B286BDD76C9D09489A2CE6AE8EFA` |
| Source commit | `5da76f2` |
| Workflow run | `39260659483` (success, 30m50s) |
| Public direct link | **None.** The release-publishing step only runs on `main`; it was skipped for this pull request. |
| Code signing | **Unsigned** (no Authenticode); SmartScreen will warn |

The value above is the hash printed by the workflow itself
(`::notice Installer SHA256::KAYAN-ERP-Setup.exe SHA256=2B0560CD…`) and is attached to the run's
check-run annotation, not computed on this machine (the ZIP is not downloaded here).

### The latest build — from `8cdd84d`, the commit that carries this report

| Item | Value |
|---|---|
| Artifact | [`KAYAN-ERP-Windows-x64-Installer`](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39276354529/artifacts/12199953707) (GitHub login required) |
| Artifact id | `12199953707` |
| Size | **344,516,260 bytes** |
| Expires | **2026-11-02T15:47:30Z** |
| `KAYAN-ERP-Setup.exe` SHA-256 | `E08B3BCD0F9E179AFBB1CE7B9065F7E89AD9E5BB23A18E59E42948BF8AB0BAD6` |
| Source commit | `8cdd84d` (report-only commit; program files identical to `5da76f2`) |
| Workflow run | `39276354529` — success; smoke test `Smoke-test the actual installed Windows application` passed |
| Important caveat | **NOT a byte-identical copy of the `5da76f2` build.** Inno Setup embeds a build timestamp, so the EXE hash differs even though the program files and the source are the same. Never mix the two hashes. |

### All artifacts of this branch

| Artifact | Commit | Size | Expires | `KAYAN-ERP-Setup.exe` SHA-256 | Status |
|---|---|---|---|---|---|
| `12199953707` | `8cdd84d` | 344,516,260 B | 2026-11-02T15:47:30Z | `E08B3BCD0F9E179AFBB1CE7B9065F7E89AD9E5BB23A18E59E42948BF8AB0BAD6` | **latest** |
| `12192261692` | `5da76f2` | 344,523,931 B | 2026-11-02T14:00:08Z | `2B0560CD16135D18FF4F12B2303660DE5B36B286BDD76C9D09489A2CE6AE8EFA` | valid, same program files |
| `12187281839` | `abb8e3f` | 344,481,622 B | 2026-11-02T12:41:09Z | `C2A4783F302C014DA4FDB96D24C38B71B8066984CE1D1D3E68A9666901951A2D` | superseded (pre-Final-Pass) |
| `12184754202` | `e3c577d` | 344,471,902 B | 2026-11-02T12:17:26Z | `7507EFE8E9FA9D7237BDBED4D06944942A32F80A6D1261360BA5B220F85C61B8` | superseded |

The permanent release asset `KAYAN-ERP-Setup.exe` under
[`windows-v0.1.1`](https://github.com/ahmadtefa/ERP_KAYAN/releases/tag/windows-v0.1.1)
(338,342,527 bytes, uploaded 2026-10-18) is an **older `main` build from before the integration
work**; it is *not* the artifact of this branch and must not be presented as one. The workflow
only publishes a release on `main`, so a permanent download link can only exist after an
authorized merge — which has not happened.

## 10. `RepairTool.exe` — packaging and verification

| Item | Detail |
|---|---|
| Source | `distribution/windows/RepairTool.cs` (C#/WinForms, ~23 KB) |
| Build | `build-repair-tool.ps1` compiles it with the Windows SDK `csc.exe`; the workflow compiles it **early** so a C# error fails in seconds |
| Packaging | Bundled at `{app}\RepairTool.exe`, Start-menu shortcut **Repair KAYAN ERP**; listed in the installer's required-file check |
| Modes | `--diagnose` (exit 0 = healthy) and `--repair` / `--repair --quiet` (exit 0 = nothing left to fix) |
| Log | `%ProgramData%\KAYAN-ERP\logs\repairtool.log`, secrets redacted |
| Safety | It reports what it detected, asks before changing anything, then re-checks. It does **not** reset/drop the database, overwrite DB files, delete configuration or backups, change credentials, or expose ports. |
| Verification | The installed-app smoke test stops `KayanERPPostgreSQL`, corrupts `kayan.env` (0-ACE), asserts `--diagnose` detects the problem, runs `--repair --quiet`, asserts `--diagnose` is healthy, the service is running, `KAYAN-REPAIR-OK` is in the log, and the company-data probe still reads `preserved`. See section 8 for the CI result. |
| Not verified | A human running the GUI and reading the Arabic/English messages on a physical Windows desktop — **NOT VERIFIED**. |

---

## 11. LAN access — exact status

| Aspect | Fact |
|---|---|
| Server mode | `backend/src/main.ts` defaults to `HOST=0.0.0.0`, prints each LAN URL, and exposes `GET /api/v1/health/network` with the addresses and port. |
| Service installation | `scripts/manage-kayan-db.ps1` writes `HOST=0.0.0.0`, `PORT=3000` and a `CORS_ORIGINS` value for the Windows **service** installation. |
| Desktop installation | `lib/core/backend/local_backend_io.dart` starts the bundled server with `HOST=127.0.0.1`; the desktop program is intentionally local-only, and the settings card says so. |
| CORS | `private` ranges (10/8, 192.168/16, 172.16/12), `localhost`, `127.0.0.1` and `*.local` are allowed; other origins are allowed only outside production. |
| Firewall | **No firewall rule is created by the installer.** `docs/DESKTOP_WINDOWS.md` tells the operator to add the inbound rule for the private profile manually. |
| Second computer test | **NOT VERIFIED.** No second physical machine was available. Nothing in this report is based on a real remote client. |
| Cosmetic defect | The service installer's default `CORS_ORIGINS` ends with the literal token `lan`, which the CORS matcher does not interpret (private ranges are allowed anyway). It is harmless but should be removed or implemented. |

To verify LAN in a real environment: install the service variant (or start the API with
`HOST=0.0.0.0`), add the firewall rule for the private profile, open
`http://<server-ip>:3000` from a second computer on the same subnet, sign in, and confirm the
settings card shows the LAN address. That test has **not** been performed.

---

## 12. Remaining defects, blocked work, and manual tests

1. **Multi-centre allocation has no editor** in Flutter. A line can name one centre from the
   pickers; the API's `allocations[]` split is only reachable through the API. The
   multi-allocation requirement is **not complete**.
2. **The stock screen has no cost-center picker**, so the server-side attribution of stock
   adjustments and counts cannot be used from the program.
3. **The cost-center report tab offers no centre/type/active filter** (the API supports them)
   and there is no separate multi-centre comparison view. The two new tabs are also visible to
   `reports.read` users who lack `accounting.costcenters.read` / `accounting.budgets.read`; the
   API refuses them with `403`, so this is presentation, not a permission hole.
4. **Centres are not printed on document detail** (invoice dialog, journal-entry detail); the
   report drill-down is the only place a posted attribution is shown in the UI.
5. **Stock attribution covers adjustments and counts only**; transfers refuse a centre by
   design, and opening stock (opening-balance document) is not attributable.
6. **No LAN verification** from a second computer; no automatic firewall rule (manual by design).
7. **Unsigned installer** — SmartScreen will warn; no certificate is available in this
   environment.
8. **No local Windows/Flutter/Inno toolchain** — Windows behavior is verified only through the
   CI build and installed-app smoke test, not by a human on a desktop.
9. **Artifact retention** — GitHub keeps the installer artifact for 14 days; there is no
   permanent download until an authorized `main` merge publishes a release.
10. **Local backup/restore of the full database** could not be run (no `pg_dump`); it is covered
   by CI and the installed-app smoke test.
11. **Budget actuals are not prorated** across a partial date range: each row compares its own
   budget period with the ledger, and the report says which period it used. A monthly plan
   cannot be compared to a single week by this report.
12. **Cost-center and budget tabs have no export/print template**; the button is hidden rather
    than offering an action that fails.
13. **Legacy demo JSON** (`demo-data/kayan-company-backup-full.json`) predates splits and has no
    `journalLineAllocation`; it restores on a database without allocations and is refused, by
    design, where allocation rows exist.
14. **Stale schema comment** in `backend/prisma/schema.prisma` still describes cost centers as
    "flat by design" above the hierarchy fields; documentation only.
15. **Manual UI acceptance** (Arabic RTL, print/PDF, idle recovery, deactivated-customer
    selection, creating a centre and tagging a document by hand) remains a human task.
16. **Single-active-company invariant** means tenant-isolation is proven at the database level,
    not by two live tenants.

No data-affecting operation was performed on the user's real database; every scenario ran on a
disposable database created for that purpose.

---

## 13. Recommendation

**Not a finished cost-center module. Ready for controlled user testing on Windows of the parts
that are finished, with the caveats below.**

What a reader can rely on:

- The **backend** (accounting, returns, opening balances, permissions, cost-center attribution,
  budgets, stock attribution) is covered by 43 Jest suites / 298 tests, seven real-PostgreSQL API
  scenarios and a 25-check upgrade harness, and the current commit is green in CI.
- The **cost-center screen and the budget screen exist in Flutter**, are reachable from the
  navigation, are permission-gated with the same codes the server enforces, and are covered by
  five new widget tests plus analyze/test/build in CI.
- The **installer of the current commit** exists and its installed-package smoke test passed
  (service, database, client, login, both backup formats, RepairTool).

What is **not** finished, and is therefore not claimed:

| Not finished | Consequence |
|---|---|
| Multi-centre allocation editor | Splitting one journal line across several centres is API-only; the requirement is unmet. |
| Cost-center picker on the stock screen | The server-side stock attribution cannot be reached from the program. |
| Centre/type/active filters and a comparison view in the cost-center report tab | The tab always shows every centre for the chosen period. |
| Centre (and splits) on the invoice/journal detail screens | Only the report drill-down shows a posted attribution. |
| Arabic RTL of the two new screens | Strings are complete; the rendered layout was never inspected. |
| LAN from a second computer | Not tested; no firewall rule is created automatically. |
| Human click-through of the installed Windows app | The smoke test drives the API, not the widgets. |

Do not treat this as a production release: the branch is unmerged, the installer is **unsigned**
(SmartScreen warns), the artifact expires 2026-11-02, and no public download exists because the
release step only runs on `main`.

The recommended next step is a short acceptance session on a Windows test machine using the
artifact of section 14.4, focused on: install → first run → login → create a cost center → tag
a journal line and an invoice line → lookup the centre in the cost-center report → create a
budget → read the budget-vs-actual report → company JSON backup → full PostgreSQL backup →
RepairTool.

## 14. Final Completion Pass (2026-10-19)

Base of this pass: `abb8e3f` (the report commit). Commits added, in order:

| Commit | Content |
|---|---|
| `8aa52e5` | budgets (model, migration, service, controller, report, permissions), stock-document attribution, cost-center screen, budget screen, document pickers, two report tabs, 63 localized strings |
| `2272580` | the pickers appear only when the company keeps cost centres; an existing value is preserved and marked inactive; 5 widget tests |
| `5da76f2` | test assertion fixed (a parent's code also appears in its child's parent column) |

`git rev-list --count main..HEAD` = **22**; `git diff --stat main..5da76f2` = **155 files,
+21,228 / −1,192**. Nothing was reverted, no migration was recreated, `main` was not touched and
nothing was merged.

### 14.1 Gaps named at `abb8e3f` and what happened to them

| Gap (section 5 before this pass) | Result | Evidence |
|---|---|---|
| No Flutter UI for cost centers | **Closed** | `cost_centers_screen.dart` (tree with depth, search, type/status/parent filters, create, edit, deactivate/reactivate, delete, details with usage); nav entry gated by `accounting.costcenters.read`; CI analyze/test/build green; `test/widget/cost_centers_screen_test.dart` (3 tests) |
| No pickers on documents | **Closed for single attribution only** | manual journal line, sales/purchase invoice line, cash voucher; `test/widget/invoice_cost_center_test.dart` proves the line carries `costCenterId` to the API and that the field disappears when the company has no centres |
| No cost-center report page | **Closed** | Reports tab 16 fed by `GET /reports/cost-centers` (own vs. rolled-up, unallocated, reconciliation, drill-down dialog through `/reports/cost-centers/{id}/transactions`) |
| Stock adjustments not attributed | **Server closed for `ADJUSTMENT`/`COUNT`; no UI** | `StockDocument.costCenterId`; only the inventory-difference line carries it; `TRANSFER` refuses one; reversal keeps the same attribution. `scenario-budgets` 29/29 |
| Budgets not implemented | **Closed** | `Budget` model, migration, service, controller, `GET /reports/budgets`, screen and report tab. `budgets.service.spec` 10/10 and `scenario-budgets` 29/29 |
| Multi-centre allocation editor | **Still open** | the API accepts and validates `allocations[]`; no Flutter editor |
| Centre shown on document detail | **Still open** | report drill-down only |
| Opening balances, bulk reallocation, dedicated export template | **Still open** | unchanged |

### 14.2 Budgets — the rules that were implemented

- One active definition per company + cost centre + account + period, enforced by a partial
  unique index (`budgets_active_definition_key`), plus a `409` from the service with a message
  that names the conflict. A retired budget keeps its row and frees the period.
- Only **postable REVENUE or EXPENSE** accounts; a balance-sheet account is refused with `400`.
  An inactive centre is refused for a **new** definition; a definition that already names a
  centre keeps it after deactivation (historical value preserved, not rewritten).
- The period must be a valid ISO date range with `periodEnd >= periodStart`; the amount must be
  a non-negative decimal with at most four places. The currency is the company currency; a
  different code is refused rather than converted.
- **Actuals come only from posted accounting data**: journal entries with status `POSTED` or
  `REVERSED`, attributed with the same `COALESCE(allocation.costCenterId, line.costCenterId)`
  rule as the cost-center report, on the account and centre of the budget, inside the budget's
  own period. Draft entries, unposted documents and invoices are excluded. Nothing is
  extrapolated or prorated.
- `variance = actual − budget`; `variancePercent` is `null` when the budget is zero rather than
  an invented infinity; `favorable` is "revenue at/above plan" or "expense at/below plan".
- Permissions: `accounting.budgets.read` / `accounting.budgets.manage`, added to the catalogue
  and granted to `ADMIN` and `ACCOUNTANT` by the migration (`INSERT … WHERE NOT EXISTS` +
  `ON CONFLICT DO NOTHING`, no grant removed). `scenario-budgets` proves three `403` refusals
  for a restricted user (list, report, create) — the API stays authoritative, the button is
  only hidden in the UI.

### 14.3 Verification of this pass

| Check | Result |
|---|---|
| `npx tsc --noEmit` | CLEAN |
| `npx jest --runInBand` | **43 suites / 298 tests PASS** |
| `npm run build` | OK |
| `scenario-budgets.mjs` (new) | **29/29** |
| `scenario-cost-centers.mjs` | **49/49** |
| `scenario-regressions.mjs` | **32/32** |
| `scenario-returns.mjs` | **88 / 0** |
| `scenario-warehouses-orders.mjs` | **35/35** |
| `scenario-imports.mjs` | **13/13** |
| `scenario-accounting.mjs` | **79/79, 3 skipped** |
| `verify-cost-center-upgrade.mjs` | **25/25** |
| CI run [39260659445](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39260659445) on `5da76f2` | **SUCCESS** — Backend, Flutter Web (analyze, 130 tests, build), Linux Desktop (analyze, 130 tests, build), Regression scenario |
| CI run [39276354174](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39276354174) and Windows run [39276354529](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39276354529) on `8cdd84d` (report commit) | **SUCCESS** — all five checks, including the installed-package smoke test |
| New Flutter widget tests | 5 (invoice picker ×2, cost-center screen ×3) — **pass in CI**; `test/` declares **127** cases across 25 files |
| Localization (static check) | **562** keys in `app_en.arb` and **562** in `app_ar.arb`, **identical sets**; the generated API carries **554 getters + 8 parameterized methods = 562**; `lib/` uses **493 distinct** keys and **all of them resolve** (the only name that looked missing, `accountTypeLabel`, is an extension method in `lib/shared/extensions/account_type_labels.dart`) |

The stock-attribution checks inside `scenario-budgets` prove, against real PostgreSQL: the
adjustment posts an inventory-difference line with the centre and an inventory line without it;
a transfer that names a centre is refused (`400`); a reversal of the adjustment keeps the same
attribution; the budget actual increases by the posted difference only after posting.

### 14.4 Installer built from the final commit

| Item | Value |
|---|---|
| Built from | **`5da76f2`** (the code head), and rebuilt from **`8cdd84d`** (the report commit) |
| Workflow runs | [`39260659483`](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39260659483) — SUCCESS, 30m50s; [`39276354529`](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39276354529) — SUCCESS |
| Artifact (latest) | `12199953707` — `KAYAN-ERP-Windows-x64-Installer` (GitHub login required to download) |
| Size (latest) | 344,516,260 bytes |
| `KAYAN-ERP-Setup.exe` SHA-256 (latest) | `E08B3BCD0F9E179AFBB1CE7B9065F7E89AD9E5BB23A18E59E42948BF8AB0BAD6` |
| Artifact (first) | `12192261692`, 344,523,931 bytes, SHA-256 `2B0560CD16135D18FF4F12B2303660DE5B36B286BDD76C9D09489A2CE6AE8EFA` |
| Created / expires (latest) | 2026-10-19T15:47:30Z / **2026-11-02T15:47:30Z** |
| Smoke test of the installed package | **PASSED** (step `Smoke-test the actual installed Windows application`) |
| Service / database / client / login | **exercised by the smoke test**: service running, database prepared and migrated, client started a healthy local API on port 3000, login returned a token — all confirmed by the run's annotations |
| Company JSON and full PostgreSQL backup/restore | **exercised**: snapshot → mutation → restore → re-login → original sentinel verified, for both formats |
| `RepairTool.exe` | **exercised**: `--diagnose` detected a stopped PostgreSQL service, `--repair --quiet` fixed it, `--diagnose` was healthy afterwards, `KAYAN-REPAIR-OK` was logged and the company data survived |
| Signed? | **No.** Unsigned; SmartScreen warns. |
| Public download? | **No.** Publishing is restricted to `main` and was skipped for this PR. |
| Flutter UI clicked by a human inside the installed app? | **NOT VERIFIED** — the smoke test drives the API, not the widgets |

### 14.5 Not verified here (exact statements)

| Item | Status | Why / what is still needed |
|---|---|---|
| Human click-through of the new screens on Windows | **NOT VERIFIED** | The CI Windows job installs the package and drives the API (login, backup/restore, repair tool); it does not click the Flutter UI. Needed: install the artifact of 14.4 on a Windows machine, create a centre, edit it, deactivate it, tag a journal line and an invoice line, open both report tabs. |
| Arabic RTL on the new screens | **NOT VERIFIED visually** | Both ARBs carry every string (562 keys each, identical sets) and the widgets use directional layout widgets, but no Arabic widget test renders these two screens and no human looked at them. |
| Multi-centre allocation editor | **NOT IMPLEMENTED** | The API validates splits; the UI assigns one centre per line. |
| Centre on document detail | **NOT IMPLEMENTED** | Only the report drill-down shows the attribution. |
| Export/print of the two new reports | **NOT IMPLEMENTED** | No template; the button is hidden instead of offering a failing action. |
| Budget vs. actual over a partial range | **LIMITATION BY DESIGN** | Rows are always compared over their own budget period; no proration. The report returns the period per row, so the screen cannot mislead, but it cannot answer "first week only". |
| LAN from a second computer | **NOT VERIFIED** | Unchanged from section 11; no second machine. |
| Full PostgreSQL backup/restore locally | **NOT VERIFIED locally** | No `pg_dump` in this sandbox; covered by CI and the installed-app smoke test. |
| Installer code signing | **NONE** | Unsigned; SmartScreen will warn. |

### 14.6 Requirement-by-requirement status (no backend-only credit for a UI requirement)

Legend: **DONE** = server rule **and** the Flutter surface exist and were exercised; **PARTIAL** =
some of the asked-for surface is missing; **API ONLY** = no Flutter surface, so **not complete**;
**BY DESIGN** = the requirement is satisfied by derivation rather than a separate control;
**NOT VERIFIED** = never exercised.

| # | Requirement | Status | What exists / what is missing |
|---|---|---|---|
| 1 | Cost-center screen in Flutter with a navigation entry, list, search, filters (type, active/inactive, parent), create, edit, view, activate/deactivate, hierarchy, code/name/type/status/dates/description, AR+EN | **DONE** | `lib/features/accounting/presentation/screens/cost_centers_screen.dart`; route `/accounting/cost-centers`; nav item gated by `accounting.costcenters.read`. The list is the server's tree with `depth`, so the hierarchy is the real parent/child order. Search covers code, both names, responsible person and parent code. Filters: type, status, parent. Details dialog shows type, parent, responsible person, dates, description, status and usage counts. All strings come from `l10n`. |
| 2 | Create/edit form (code, both names, type, parent, description, responsible, start/end, active), duplicates `409`, self-parent/cycle `400`, invalid/inactive parent, permission and network errors | **DONE** | Same screen; the form is the shared `showFormSheet`. Duplicate code/name, cycle/self-parent, inactive parent and permission refusals are shown **as the server phrased them** (`Failure.message`). The client marks required fields but the server is the authority. |
| 3a | Pickers on manual journal lines | **DONE (single centre)** | Per-line dropdown in the new-entry editor; `''` means "no allocation" and an empty choice is omitted from the payload rather than sent as a literal. The editor creates new drafts only (there is no edit path for a journal entry in this build), so there is no historical value to restore. **No dedicated widget test** for this screen; it shares the provider that the invoice test covers. |
| 3b | Pickers on sales and purchase invoice lines | **DONE (single centre)** | `_LinesTable`; value restored on edit and posted in the payload; `test/widget/invoice_cost_center_test.dart` asserts `lines[0].costCenterId` reaches the API and that the control disappears when the company has no centres. |
| 3c | Pickers on sales/purchase returns | **BY DESIGN — no picker** | A return is derived from an invoice line and inherits its centre; the server copies it (verified: `scenario-cost-centers` 49/49 includes return inheritance). Offering a picker here would let a return disagree with the invoice it reverses. |
| 3d | Pickers on cash vouchers and bank/expense documents | **DONE** | Optional `costCenterId` on the voucher form, applied to the counter (expense/revenue) account only; the cash side stays unallocated. `scenario-cost-centers` verifies the posted voucher line carries the centre. |
| 3e | **Multi-centre allocation UI** (several centres, amounts/percentages, source vs allocated vs remaining, block unless it reconciles exactly, no duplicates, reject inactive) | **API ONLY — NOT COMPLETE** | `posting.service` accepts `allocations[]`, validates each centre, rejects a line that carries both forms, requires the parts to equal the line exactly and de-duplicates by centre; the journal detail returns the splits. **No Flutter editor exists**, so the requirement is not met. |
| 4 | Display centre and allocations after posting (document detail, journal history); historical values survive deactivation | **PARTIAL** | The cost-center report's drill-down shows the attributed line per entry. The **journal history and invoice detail do not print the centre or its splits**; no historical value is ever rewritten by deactivation (server rule, and the budget/report tests confirm a deactivated centre still reports its past amounts). |
| 5 | Cost-center report UI: period, centre, type, hierarchy, active/inactive, expense by centre with drill-down, revenue attribution, comparison, project profitability, roll-up | **PARTIAL** | Reports tab "cost centers": shared period picker, own vs. rolled-up revenue/expense/result, unallocated bucket, reconciliation totals, per-centre drill-down (and an `unallocated` drill-down). Missing: explicit **centre/type/active filters** in the tab (the API accepts `type`, `costCenterId`, `asOf`, `includeInactive`) and a separate "multi-centre comparison" view. The two new tabs are also shown to any user holding `reports.read`, while their endpoints require `accounting.costcenters.read` / `accounting.budgets.read`; a user without those codes therefore sees the tab and gets the server's `403` in it. The API stays correct — the tab is simply not hidden — but it is a rough edge. Project profitability is only shown as result per centre, and only where entries are genuinely attributed — nothing is invented. |
| 6 | Inventory integration: attribute only genuinely cost-bearing lines, verify quantity/valuation/journal/reversal, add tests | **API ONLY — NOT COMPLETE as a UI feature** | `StockDocument.costCenterId` is accepted on `ADJUSTMENT`/`COUNT`; the inventory-difference line carries it and the inventory line does not; `TRANSFER` refuses a centre. Reversal keeps the attribution. `scenario-budgets` 29/29 proves all of that. **The stock screen has no picker**, so an operator cannot set it from the program. Opening stock (opening-balance document) is not attributable. |
| 7 | Budgets: period, centre, account/category, amount, create/edit/deactivate, permissions, actual vs budget from posted data, invalid period/duplicate/unauthorized/invalid centre refused | **DONE** | Budget screen + API + `GET /reports/budgets` + report tab. Duplicate definition `409` (partial unique index), invalid period `400`, balance-sheet account `400`, inactive centre `400` on create, company currency enforced, three `403` refusals for a restricted user. Actuals read `POSTED`/`REVERSED` ledger lines only. **Limitation:** no proration — each row compares its own period. |
| 8 | Permissions: view/create/edit/deactivate/allocate/report/budget; ADMIN, accountant, restricted user; API stays authoritative | **DONE** | `accounting.costcenters.read/manage`, `accounting.budgets.read/manage`; nav and buttons gated by the same codes the server checks; `scenario-cost-centers` and `scenario-budgets` prove `403` for a restricted user on the API, and `scenario-accounting` proves grant/revoke take effect without a new token. |
| 9 | Localization AR+EN, RTL, terminology, no hard-coded English, existing visual language | **DONE (strings) / NOT VERIFIED (visual RTL)** | 562 keys in each ARB with identical key sets; generated getters in all three files; every key used by the changed screens exists. The new screens use `l10n` exclusively for user-facing text. **No Arabic widget test renders these two screens and no human looked at them**, so RTL layout is not claimed as visually verified. |
| 10 | Tests: CC UI, allocation UI, documents, reports, budgets, permissions, full regression | **PARTIAL** | Backend: 43 suites / 298 tests, 7 API scenarios, upgrade harness. Flutter: 5 new widget tests (CC screen ×3, invoice picker ×2). **No widget test covers the budget screen, and the allocation UI has no tests because it does not exist.** |
| 11 | LAN: secure loopback default, opt-in documented, never claim PASS without a second computer | **NOT VERIFIED** | Unchanged; section 11. |
| 12 | Installer from the final commit, installed-app checks, real SHA-256 | **DONE (with unsigned caveat)** | Section 14.4; the installed-app smoke test covers service, database, client, login, both backup formats and RepairTool. A human clicking the Flutter UI in the installed app is **NOT VERIFIED**. |
| 13 | Update this report only, with evidence | **DONE** | This file. |
| 14 | Commit, push, keep PR #52 open, 17-point answer | **DONE** | Commit and push on the same branch; PR #52 remains open. |

#### Existing ERP features — still present and exercised

| Feature | Status | Evidence |
|---|---|---|
| Opening balances (template, posting, second-document refusal, imports) | preserved | `scenario-accounting` 79/79; `scenario-imports` 13/13 |
| Banks and cash accounts (kind, `accountId`, transfers, balances) | preserved | `scenario-accounting` |
| Sales returns and purchase returns (links, cost restoration, reversal) | preserved | `scenario-returns` 88/0 |
| Customer/supplier picker including deactivated parties | preserved | `scenario-regressions` 32/32 |
| Item creation + opening stock | preserved | `scenario-accounting`, `scenario-warehouses-orders` 35/35 |
| Session recovery / refresh rotation / logout reuse | preserved | `scenario-accounting`; Flutter `result_test`, auth tests |
| Permissions (live grants, revokes, super-admin) | preserved | `scenario-accounting`; `permissions.guard.spec`, `super-admin.guard.spec` |
| Backup/restore (company JSON and full PostgreSQL), RepairTool | preserved and re-verified on the installed package | annotations of run `39260659483` |

## Appendix A — Exact evidence commands

```bash
# backend, on this branch
cd backend
npx tsc --noEmit
npx jest --runInBand
npm run build

# real PostgreSQL scenarios (disposable databases, API on 3101/3102/3107/…)
DATABASE_URL=postgresql://…/kayan_scenario node scripts/scenario-accounting.mjs http://127.0.0.1:3101/api/v1
DATABASE_URL=postgresql://…/kayan_cc2      node scripts/scenario-cost-centers.mjs  http://127.0.0.1:3107/api/v1
DATABASE_URL=postgresql://…/kayan_reg      node scripts/scenario-regressions.mjs   http://127.0.0.1:3103/api/v1
DATABASE_URL=postgresql://…/kayan_ret      node scripts/scenario-returns.mjs       http://127.0.0.1:3104/api/v1
DATABASE_URL=postgresql://…/kayan_wh       node scripts/scenario-warehouses-orders.mjs http://127.0.0.1:3105/api/v1
DATABASE_URL=postgresql://…/kayan_imp      node scripts/scenario-imports.mjs       http://127.0.0.1:3106/api/v1

# migration upgrade reproduction (creates its own database)
node scripts/verify-cost-center-upgrade.mjs
```

## Appendix B — Files that implement the cost-center dimension

- `backend/prisma/schema.prisma` — `CostCenterType`, `CostCenter`, `JournalLineAllocation`,
  nullable `costCenterId` on journal lines, invoice lines and cash vouchers.
- `backend/prisma/migrations/20261019120000_cost_centers_hierarchy_allocations/migration.sql`
- `backend/src/modules/accounting/cost-centers.service.ts`,
  `cost-centers.controller.ts`, `cost-center-attribution.ts`
- `backend/src/modules/accounting/journal-entries.service.ts`, `posting.service.ts`
- `backend/src/modules/sales/sales-invoices.service.ts`,
  `backend/src/modules/purchases/purchase-invoices.service.ts`,
  `backend/src/modules/returns/returns.service.ts`,
  `backend/src/modules/cash/cash-vouchers.service.ts`
- `backend/src/modules/reports/financial-statements.service.ts`, `reports.controller.ts`
- `backend/src/modules/backup/backup.service.ts` (splits in JSON backups)
- `backend/prisma/permissions.ts` (catalogue)
- `backend/scripts/scenario-cost-centers.mjs`, `verify-cost-center-upgrade.mjs`

---

## 15. Follow-up implementation pass — 2026-10-19

This section records changes made after the earlier verification sections. It does **not**
retroactively change their test results.

### 15.1 Cost-center report filters

- The Flutter cost-center report now exposes a type filter, a specific-centre filter, and an
  **Include inactive centres** toggle, alongside the existing shared date range.
- These controls pass `type`, `costCenterId`, and `includeInactive` to
  `GET /reports/cost-centers`; the report totals and table are fetched from the same filtered
  request rather than filtering only the visible rows.
- Implemented in `lib/features/reports/presentation/reports_screen.dart`.
- Commit: `0a0da58` (`feat(reports): add cost-center report filters`).

### 15.2 Multi-centre allocation editor on manual journal lines

- The journal-entry editor now offers a split-allocation dialog when a company has active cost
  centres. It allows multiple distinct centres and positive decimal amounts, displays the line
  amount, allocated total and remaining amount, and disables **Done** until the allocation is
  complete and exactly reconciles to the source line.
- On submission, split lines send `allocations[]`; they do not send `costCenterId` at the same
  time. The backend remains authoritative and repeats validation when posting.
- The existing single-centre selection remains available. Choosing **Use one centre** switches
  the line back to single-centre mode without deleting the saved split draft.
- Implemented in `lib/features/accounting/presentation/screens/journal_entries_screen.dart`.
- Commits: `033e6c1` and `953024f`.

### 15.3 Verification status for this pass

| Check | Status |
|---|---|
| Source changes committed to the PR #52 branch | **YES** |
| Local Flutter analysis/test run | **NOT RUN** — this pass used the GitHub repository editor, not a local checkout |
| CI on the cost-centre-filter commit `0a0da58` | Run `39297065511` was observed in progress; this is not recorded as a pass here |
| Windows installer workflow | Run `39297065383` was observed in progress; no new installer is claimed by this section |
| New widget tests specifically covering report filters and split allocation | **NOT ADDED YET** |
| Human click-through, Arabic RTL visual check, second-computer LAN test | **NOT VERIFIED** |

The current code changes should be treated as implemented but **not yet verified** until a workflow
run that checks the current branch head completes successfully. The earlier green results in
sections 1 and 14 apply to their recorded commits only.

### 15.4 Remaining requested work — still open

- Cost-centre attribution on stock adjustment/count screens, and displaying centre/splits in
  journal and invoice details.
- Invoice-level and line-level percentage/fixed discounts, including tax, accounting, inventory,
  returns, reversals, and backup/restore parity.
- Resizable/maximizable dialogs and usable table-column sizing/density/long-text behavior.
- Complete quotation workflow, including multiple titled tables, origin country, discounts,
  company branding/tax details, responsible manager, status/audit trail, invoice conversion, and
  print/PDF.
- Full print preview and export parity (Arabic RTL, pagination, active filters and permissions)
  for the requested screens and reports.
- Human Windows UI walkthrough, visual RTL verification, and LAN test from a second physical
  computer.

No merge to `main`, release publication, or destructive operation on real company data was made
during this pass.

### 15.5 Static-analysis correction found during CI

The first CI attempt on the new journal allocation UI found one Flutter analyzer error: the project
does not define an `AppLocalizations.done` getter. Replaced that call with the existing bilingual
inline label helper. Fix commit: `355c229`.

The failing run is **not** counted as a pass. A new CI/Windows workflow run must finish against the
updated branch head before this implementation pass can be called verified.


## 16. Navigation recovery and verification — 2026-10-19

### 16.1 Read-only navigation permission alignment

- Opening balances is now shown to users with `accounting.journal.read`, matching the GET endpoints. Creating, posting and reversing an opening-balance document still require `accounting.openingbalances.manage` on the API.
- Sales returns navigation follows `sales.invoices.read`; purchase returns follows `purchases.invoices.read`. These are the actual read permissions on the return list/detail API routes. Create/post/reverse remain protected by their respective invoice create/post permissions.
- Added a widget test that gives the user only the relevant read permissions and verifies cash/banks, opening balances, sales returns and purchase returns are visible.
- Added an idempotent database migration to grant cash-account read permission to active roles that already have journal-read permission, without granting account management, voucher creation or posting.
- Source commits: `f3123df`, `5f104ea`, `4394fe7`, plus the cash permission migration commit on this branch.

### 16.2 CI and Windows installer state at report update

- ERP KAYAN CI for branch head `4394fe7f38f27ce56fed11a80fd73bda32925200`: **PASS** (including Linux/Web analysis, tests/builds, backend PostgreSQL smoke test and regression scenario).
- The regression scenario job reported **SUCCESS**.
- Windows Installer workflow for the same head: **IN PROGRESS** at the time of this report update. No installer artifact is claimed until that workflow completes and the artifact is inspected.
- The widget test and migration were checked by CI; a human Windows installed-app walkthrough, Arabic RTL visual verification, and second-computer LAN test are still not equivalent to automated CI and remain unverified.

### 16.3 Scope still not completed by this pass

The navigation fix does not itself implement invoice discounts, quotation screens/workflow, Excel accounting import, resizable/maximizable dialogs, complete export/print parity, or full backup/restore test coverage. Those remain explicit follow-up work and must not be reported as complete based only on this navigation change.

---

## 17. Final verification pass — 2026-10-20, head `cb81bc3`

### 17.1 What this pass changed

Five defects kept CI red after the previous pass; all five were in tests or diagnostics, not in
application behaviour:

| Commit | Change | Why |
|---|---|---|
| `ac26531` | Added `subTotal`, `discountTotal`, `totalAmount` (`Prisma.Decimal`) to the printed-page fixture | `snapshotContent` formats those fields with `toFixed`; without them three tests threw `Cannot read properties of undefined` |
| `ac26531` | Put `sales-quotation` after `purchase-order` in the export-catalogue expectation | It matches the order in `DOCUMENT_KINDS`; the assertion still checks the exact list |
| `ac26531` | `separatorBuilder: (_, __)` → `(_, _)` | Removed the last `flutter analyze` issue (`unnecessary_underscores`), which was failing the Analyze step |
| `ac26531` | Unit tests now run through `scripts/ci-diagnose.py` | A future failure publishes its tail as an annotation even when the Actions log archive is unreachable |
| `e504e2d` | Widget test overrides `customersProvider`/`itemsProvider` | The quotation editor reads those providers, not the `active*` variants, so the dropdowns were empty |
| `cb81bc3` | Widget test asserts `showTaxId` | The editor and the DTO use `showTaxId`; `showTaxNumber` was never sent |

Production code was not changed to make a test pass, and no assertion was weakened.

### 17.2 CI at the final code head

| Run | Result | Jobs |
|---|---|---|
| [`39340110065`](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39340110065) | **success** | Regression `118359257671`, Backend `118359257757`, Flutter Web `118359257742`, Linux Desktop `118359257857` |

The Backend job executed, in order: install → `prisma generate` → `prisma validate` →
`tsc --noEmit` → **`npm test`** → `npm run build` → `prisma migrate deploy` on ephemeral
PostgreSQL → seed → start API and smoke-test health/login → install PostgreSQL client tools →
build and restore the complete demo JSON on clean disposable databases → `npm audit`.

The Regression job applied migrations to a freshly created database, seeded it, built the API,
checked that `/` and a client-side route serve the web client, and ran
`scenario-regressions.mjs` **and** `scenario-discounts-quotations.mjs`.

The Flutter jobs ran `flutter analyze`, `flutter test --reporter expanded`, and the Web/Linux
release builds.

### 17.3 Requirement-by-requirement status

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Quotation subject | `Quotation.subject`, editor field, snapshot, printed header | Backend test, widget test, scenario | **DONE + TESTED** |
| Per-offer tax-number switch | `showTaxId` on the quotation, beats company setting, snapshotted | Backend print tests (on/off), scenario, widget body | **DONE + TESTED** |
| Terms copied per offer + library | `terms` text and `quotation_term_templates`, copied on insert | Service/scenario; no dedicated UI test | **DONE (UI not unit-tested)** |
| Editable columns and DB templates | ordered JSON columns with labels/visibility/width; `quotation_column_templates`; editor with add/hide/rename/move/width; save/apply template | Backend column tests; widget test sends the layout; scenario checks print order | **DONE + TESTED (server), UI covered by widget test** |
| Multiple tables, table/document/line discounts, totals | tables with own discount, document discount, per-line discount, stored totals | Backend specs, scenario, widget payload | **DONE + TESTED** |
| Statuses, event log, revision | `QuotationStatus`, `QuotationEvent`, `revisionOfId`, revision copies snapshot | Service and scenario | **DONE + TESTED** |
| One-time concurrency-safe conversion | atomic `updateMany` claim on status + `convertedInvoiceId`; explicit second-attempt error | Service code; scenario; unit assertions | **DONE + TESTED** |
| Arabic RTL print/PDF, XLSX and CSV | `printHtml`, `toXlsx`, `toCsv`, PDF engine, separate buttons | Backend print tests; export catalogue tests; no physical printer | **DONE; physical print NOT VERIFIED** |
| Sales/purchase/return discounts, posting, reversal | line and document discounts, allocation, tax and stock impact; drafts re-open unchanged | `invoice-discount`, `sales-invoices`, `returns`, `landed-cost` specs; scenario | **DONE + TESTED** |
| Navigation and permissions | quotation permissions `read/manage/export/convert`; guarded routes and buttons; navigation widget test | Permissions guard specs, catalogue spec, `erp_shell_test` | **DONE + TESTED** |
| Resizable/maximisable dialogs, horizontal scroll | `data_dialog.dart`, `RecordsTable` | Code; no visual walkthrough | **DONE; visual NOT VERIFIED** |
| LAN card | `/health/network`: binding state, real IPv4, port, copy, public IP on demand, guidance | Widget code; no second computer | **IMPLEMENTED; LAN NOT VERIFIED** |
| Per-warehouse stock in the item picker | `GET /inventory/stock/by-warehouse`, grouped display next to total | Service/controller; scenario covers stock | **DONE + TESTED (API); UI visual not verified** |
| Cost centres | hierarchy, line attribution, journal allocations, report filters, budgets, stock attribution | Service specs; widget tests for cost-centre picker; CI | **DONE + TESTED (automated)** |
| Migrations, seed, backup/restore | 34 migrations; CI applies them to a new DB; demo JSON built and restored on clean DBs | Backend job steps 11–16 all success | **DONE + TESTED on disposable databases** |
| Installer from final code | Windows run `39340110060` at `cb81bc3` | artifact `12228799462`, smoke test passed | **DONE + TESTED** |

### 17.4 Exact commands and outcomes

```bash
# Backend (executed by CI, backend job 118359257757)
cd backend
npx prisma generate && npx prisma validate && npx tsc --noEmit
npm test -- --runInBand
npm run build
npx prisma migrate deploy          # fresh PostgreSQL 16 service
npx ts-node prisma/seed.ts
npm run start:prod                 # health + login smoke test
node scripts/build-demo-backup.mjs # demo JSON restored on clean databases
npm audit --omit=dev

# Regression job 118359257671
node scripts/scenario-regressions.mjs          http://127.0.0.1:3000/api/v1
node scripts/scenario-discounts-quotations.mjs http://127.0.0.1:3000/api/v1

# Flutter jobs 118359257742 and 118359257857
flutter analyze
flutter test --reporter expanded
flutter build web --release
flutter build linux --release

# Localization catalogue (run locally in this workspace)
node tools/check-l10n-keys.mjs
# -> l10n check passed: 719 keys in both languages, 1323 usages in the sources.
```

**Outcomes:** every CI step above returned success. Locally, the backend suite also ran with a
faithful Prisma stand-in (the generated client in this container is incomplete and the engine
cannot be downloaded): **47/47 suites, 327/327 tests**. That local run is diagnostic only; the
authoritative run is the CI job on the real client.

### 17.5 Installer — current artifact

| Item | Value |
|---|---|
| Workflow run | [`39340110060`](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39340110060) — success |
| Source commit | `cb81bc316afe3933bd69915b72e8086224341bad` (last commit that changes code or a packaged file) |
| Artifact | `12228799462` — `KAYAN-ERP-Windows-x64-Installer` |
| Size | **344,698,505 bytes** |
| SHA-256 | `3FA4D266A65145A1EC50F52A622EFEF120D745669AD5D26604B7B0990C290D00` |
| Expires | 2026-11-02T23:43:53Z |
| Link | <https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39340110060/artifacts/12228799462> |

The installed-package smoke test verified, on the runner and from the actual installer:

```text
Windows installer smoke test passed: service, database preparation, client startup on port
3000, login, company JSON and full PostgreSQL backup/restore all verified.
Installed Windows PostgreSQL backup/restore passed: real archive, mutation, checked restore,
safety copy, re-login and original sentinel verified.
Installed Windows company JSON backup/restore passed: snapshot, mutation, restore, re-login
and original sentinel verified.
```

The installer is **not code-signed**. Windows SmartScreen may warn.

### 17.6 What this pass did not verify

1. No connection from a **second physical computer** over LAN.
2. No **physical printer** test and no manual Arabic RTL visual check.
3. No **human click-through** of the installed Windows build.
4. No **upgrade of a real existing production database**; CI proves fresh-database migrations
   and restore on disposable databases, not an in-place customer upgrade.
5. No code-signing certificate.

### 17.7 Reports

- `ERP_KAYAN_IMPLEMENTATION_REPORT.md` — 18-section implementation report for this pass.
- `KAYAN-INTEGRATION-VERIFICATION-REPORT.md` — this file; section 17 is authoritative.
- `ERP_KAYAN_FINAL_IMPLEMENTATION_REPORT.md` — retained as a historical report from an earlier
  pass; it is not a description of `cb81bc3`.

No merge, release, branch deletion or history rewrite was performed.
