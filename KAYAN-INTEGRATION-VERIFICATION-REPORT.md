# KAYAN ERP — Integration Verification Report

**Date:** 2026-10-19
**Repository:** [ahmadtefa/ERP_KAYAN](https://github.com/ahmadtefa/ERP_KAYAN)
**Integration branch:** `arena/a5a099ec-erp-kayan`
**Base:** `main` at `e1a2a7e` (unchanged; nothing was merged into `main`)
**Open pull request:** [#52](https://github.com/ahmadtefa/ERP_KAYAN/pull/52) — **OPEN**, base `main`, head `arena/a5a099ec-erp-kayan`, MERGEABLE, not merged

This report records what was actually verified on this branch, what was not, and the exact
evidence for each claim. A status of **NOT VERIFIED** means no test was run; it is never a
guessed "probably works".

---

## 1. Final state

| Item | Value |
|---|---|
| Branch | `arena/a5a099ec-erp-kayan` |
| Code commit (last commit that changes program files) | `e3c577d` — `fix(backup): keep cost-centre splits in company JSON backups` |
| Report commit | the commit that adds this file (see `git log -1 -- KAYAN-INTEGRATION-VERIFICATION-REPORT.md`) |
| Commits ahead of `main` | 18 before the report commit (`git rev-list --count main..HEAD`) |
| Working tree | clean at the time the evidence below was produced |
| `main` | `e1a2a7e`, untouched |
| Merged into `main`? | **No** |
| New production release published? | **No** |

The PR head was pushed to the same branch that PR #52 watches, so PR #52 contains every
commit listed in section 2. Its Windows installer workflow rebuilt from `e3c577d`; this report
is the only file added after that build and it is not part of the installed package, so the
artifact described in sections 8–9 contains the exact program files of the final code commit.

---

## 2. Source pull requests, branches and integration status

| PR | Branch | Base | Head | Size | State | Really integrated? |
|---|---|---|---|---|---|---|
| [#51](https://github.com/ahmadtefa/ERP_KAYAN/pull/51) | `arena/92b91cee-erp-kayan` | `main` | `7e2514c` | 100 files, +11,487 / −919 | OPEN, MERGEABLE, unmerged | **Yes, into the integration branch.** `7e2514c` is an ancestor of `e3c577d` (`git merge-base --is-ancestor`), so all of its content is in this branch. It is *not* in `main`. |
| [#52](https://github.com/ahmadtefa/ERP_KAYAN/pull/52) | `arena/a5a099ec-erp-kayan` | `main` | `e3c577d` | 140 files, +16,692 / −1,179 | OPEN, MERGEABLE, unmerged | This is the integration branch itself. It contains #51 plus the follow-up fixes and the cost-center module. |
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
```

No branch was deleted, no history was rewritten, and `main` was not modified.

---

## 3. What changed, by area

`git diff --stat main..e3c577d` — **140 files, +16,692 / −1,179**.

### Backend (`backend/src`, 72 files)

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

### Flutter (`lib/`, 32 files)

- Session recovery (no endless spinners), localized messages, permission-aware navigation,
  opening-balance screens, cash/bank screens, returns screens, LAN access card, export/print
  actions. Arabic RTL and English LTR are both kept.

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

### Implemented and verified

| Capability | Evidence |
|---|---|
| Master data: `type` (`DEPARTMENT`, `ADMINISTRATIVE_UNIT`, `PROJECT`), parent hierarchy, code/name (AR+EN), description, responsible person, start/end dates, active flag | `scenario-cost-centers` 49/49 |
| Guards: duplicate code `409`, self-parent/cycle `400`, depth limit 12, inactive centre refused for new postings `400` | 49/49 |
| Delete blocked while journal lines, allocations, invoice lines or cash vouchers reference the centre; deactivation available instead | 49/49 (`usage` endpoint reports 7 attributed lines) |
| Manual journal entries: single centre per line **and** split across several centres, with amounts that must add up to the line total | 49/49, `journal-entries.service` |
| Sales and purchase invoice lines carry a centre; revenue, COGS and inventory postings are attributed; sales-return lines inherit the centre | 49/49 |
| Reversals copy the original allocations exactly (no invented or lost amounts) | 49/49 |
| Cash receipts/payments can carry a centre on the counter-account side | exercised through the real API on a disposable database: payment `PV-000002` posted `75.0000`, the expense line (`5101`) carried the centre, the cash line (`1101`) stayed unallocated, and a second post was refused (`400`) |
| Report `GET /reports/cost-centers`: own vs. rolled-up revenue/expenses/result, `unallocated` bucket, reconciliation invariant (`totals + unallocated == ledger`), filters (`from`, `to`, `asOf`, `branchId`, `type`, `costCenterId`, `includeInactive`) | 49/49 |
| Drill-down `GET /reports/cost-centers/:id/transactions` (and `/unallocated/transactions`), page ≤ 500 | 49/49 |
| Permissions `accounting.costcenters.read` / `.manage`, ADMIN + ACCOUNTANT grants, `reports.read` roles receive read | 19/19 upgrade test |
| Company JSON backup keeps splits and restores them | 2 allocation rows in the file; restore reproduced the report exactly (see section 7) |
| Upgrade from a pre-cost-center database without inventing data | 19/19 upgrade test |

Report attribution rule: `COALESCE(allocation.costCenterId, line.costCenterId)` with
`COALESCE(allocation.amount, debit + credit)` over posted/reversed `REVENUE` and `EXPENSE`
accounts; a line with no centre lands in `unallocated`.

### Missing or not implemented

| Gap | Detail |
|---|---|
| **No Flutter user interface** | There is no cost-center settings screen, no picker on the invoice/journal/expense forms, and no cost-center report page. `lib/features/accounting/domain/entities/journal_entry.dart` carries `costCenterId`, but nothing in `lib/` creates or selects a centre. The module is usable through the API only. |
| Inventory stock documents | Stock adjustments/counts post an inventory-difference expense line with **no** cost-centre attribution; `stock-documents.service` has no `costCenterId`. |
| Opening balances | Opening-balance lines are not attributable to a centre (they are predominantly balance-sheet lines). |
| Budgets vs. actual | Not implemented. There is no budget table or comparison report; do not present the module as budget-capable. |
| Bulk reallocation | No tool to re-attribute historical lines; by design nothing is re-attributed automatically. |
| Export | The cost-center report is available through the generic report export endpoints (`reports.print`/PDF), but there is no dedicated screen or template. |

---

## 6. Migrations and backward compatibility

- **27 migrations** are applied on a fresh database (`48` tables).
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

## 7. Tests actually run (2026-10-19, this branch, `e3c577d`)

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

The three skips in `scenario-accounting` are explicit and reported by the script itself:

1. `_prisma_migrations` is absent because this database was built by applying the migration
   SQL directly (the Prisma engine binaries cannot be downloaded here). CI runs
   `prisma migrate deploy`, so the check runs there.
2. Full PostgreSQL backup/restore is skipped locally because `pg_dump`/`pg_restore` are not on
   this machine. The Windows CI smoke test performs a real installed-app backup and restore.
3. The guarded live-reset check only runs with `ENABLE_DISPOSABLE_RESET=true` on a disposable
   database; CI runs it.

### CI evidence

| Run | Result |
|---|---|
| [ERP KAYAN CI run 39246795396](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39246795396) on `e3c577d` | **SUCCESS** — all four jobs: Flutter Web (analyze, test, build), Linux Desktop (analyze, test, build), Backend (real Prisma + PostgreSQL), Regression scenario (issues 1–9, 32 checks) |
| [Windows Installer run 39246795416](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39246795416) on `e3c577d` | **SUCCESS** — 32m56s (11:45:07Z → 12:18:03Z) |

The Windows job also runs the backend test suite, `flutter analyze`, `flutter test` and the
Flutter web build before packaging, so the installer is built from a tree that passed the same
checks as the Linux CI run. Step-level logs could not be downloaded in this sandbox
(`results-receiver.actions.githubusercontent.com` is outside the allowed egress), so the
evidence used here is the job conclusion plus the check-run annotations quoted in section 8.

---

## 8. Installer build status and provenance

[Windows Installer run 39246795416](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39246795416)
built the installer from `e3c577d` and **succeeded** in 32m56s. The job:

- ran the backend tests, `flutter analyze`, `flutter test` and the Flutter web build;
- compiled `RepairTool.exe` early with `csc.exe`;
- built `KAYAN-ERP-Setup.exe` with Inno Setup and printed its SHA-256;
- installed the package and ran `scripts/smoke-test-installed-windows.ps1` against it.

Check-run annotations on that job:

> Windows installer smoke test passed: service, database preparation, client startup on port
> 3000, login, company JSON and full PostgreSQL backup/restore all verified.

> Installed Windows PostgreSQL backup/restore passed: real archive, mutation, checked restore,
> safety copy, re-login and original sentinel verified.

> Installed Windows company JSON backup/restore passed: snapshot, mutation, restore, re-login
> and original sentinel verified.

The same smoke script exercises the bundled `RepairTool.exe` against a stopped service and a
re-corrupted `kayan.env`; any failure there fails the job, and the job succeeded. A human
running the GUI on a physical desktop is still **NOT VERIFIED**.

**Provenance.** The Windows workflow checks out the PR head (`e3c577d`), builds the Flutter
Windows release, the backend, and the installer from that tree. The only commit after it is
this report, which lives at the repository root and is **not** copied into the installer
(`build-installer.ps1` packages `backend/{dist,prisma,scripts,…}`, `build/web`, `distribution`
files and the runtimes — not repository documentation). The packaged files therefore match the
final branch content exactly.

**Code signing: none.** There is no Authenticode signing step in `build-installer.ps1` or the
workflow. Windows SmartScreen will warn on first run. This is stated in the Windows guide
rather than claimed otherwise.

---

## 9. `KAYAN-ERP-Setup.exe` — location, size, hash, expiration

| Item | Value |
|---|---|
| Artifact | [`KAYAN-ERP-Windows-x64-Installer`](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39246795416/artifacts/12184754202) (GitHub login required) |
| Artifact id | `12184754202` |
| Size | **344,471,902 bytes** (ZIP containing `KAYAN-ERP-Setup.exe`) |
| Created | 2026-10-19T12:17:37Z |
| Expires | **2026-11-02T12:17:26Z** (14-day retention) |
| `KAYAN-ERP-Setup.exe` SHA-256 | `7507EFE8E9FA9D7237BDBED4D06944942A32F80A6D1261360BA5B220F85C61B8` |
| Source commit | `e3c577d` |
| Public direct link | **None.** The release-publishing step only runs on `main`; it was skipped for this pull request. |

The installer is also produced locally by the workflow at
`build\windows-installer\KAYAN-ERP-Setup.exe` on the runner, together with a versioned copy
named `KAYAN-ERP-Setup-<version>-x64.exe`; neither is on this Linux workspace. Only the ZIP
above is retained by GitHub.

The permanent release asset `KAYAN-ERP-Setup.exe` under
[`windows-v0.1.1`](https://github.com/ahmadtefa/ERP_KAYAN/releases/tag/windows-v0.1.1)
(338,342,527 bytes, uploaded 2026-10-18) is an **older `main` build from before the integration
work**; it is *not* the artifact of this branch and must not be presented as one. The workflow
only publishes a release on `main`, so a permanent download link can only exist after an
authorized merge — which has not happened.

---

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

1. **Cost centers have no UI** (settings CRUD, pickers on documents, report screen). This is the
   largest functional gap; the API and reports are complete.
2. **Inventory stock documents are not attributed** to a cost centre.
3. **No LAN verification** from a second computer; no automatic firewall rule (manual by design).
4. **Unsigned installer** — SmartScreen will warn; no certificate is available in this
   environment.
5. **No local Windows/Flutter/Inno toolchain** — Windows behavior is verified only through the
   CI build and installed-app smoke test, not by a human on a desktop.
6. **Artifact retention** — GitHub keeps the installer artifact for 14 days; there is no
   permanent download until an authorized `main` merge publishes a release.
7. **Local backup/restore of the full database** could not be run (no `pg_dump`); it is covered
   by CI and the installed-app smoke test.
8. **Cost-center budgets** are not implemented and must not be advertised.
9. **Legacy demo JSON** (`demo-data/kayan-company-backup-full.json`) predates splits and has no
   `journalLineAllocation`; it restores on a database without allocations and is refused, by
   design, where allocation rows exist.
10. **Stale schema comment** in `backend/prisma/schema.prisma` still describes cost centers as
    "flat by design" above the hierarchy fields; documentation only.
11. **Manual UI acceptance** (Arabic RTL, print/PDF, idle recovery, deactivated-customer
    selection) remains a human task.
12. **Single-active-company invariant** means tenant-isolation is proven at the database level,
    not by two live tenants.

No data-affecting operation was performed on the user's real database; every scenario ran on a
disposable database created for that purpose.

---

## 13. Recommendation

**Ready for controlled user testing on Windows, with the caveats below.**

- The backend, accounting flows, returns, opening balances, permissions and the cost-center
  API/report are covered by automated tests and real PostgreSQL scenarios, and the installer is
  built and smoke-tested in CI.
- Cost centers can be used through the API today, **not** from the Flutter screens. If the user
  expects to create centres or tag invoices in the UI, that work is still outstanding.
- Do not deploy the LAN/server mode to a real network until the second-computer test and the
  firewall rule are done, and do not treat this as a production release: the branch is
  unmerged, the installer is unsigned, and no release was published.
- The recommended next step is a short acceptance session on a Windows test machine using the
  CI artifact, focused on: install → first run → login → opening balances → invoice with a cost
  center (API/console) → cost-center report → backup → repair tool.

---

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
