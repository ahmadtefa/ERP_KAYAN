# CODEX_HANDOFF

Handoff notes for continuing **ERP_KAYAN** in Codex on VS Code.

Written 2026-11-06. Branch `arena/56e71924-erp-kayan`.

---

## 1. Where the project stands

| Item | Value |
|---|---|
| Branch | `arena/56e71924-erp-kayan` |
| Base commit this work branched from | `b244c91f4a35804d6b18b3132c518d5d1d8727c2` |
| Remote | `origin` → `ahmadtefa/ERP_KAYAN` |
| PR | **#77, OPEN** (base `main`, head this branch) |

Two commits were added on top of `b244c91f`:

| Commit | Contents |
|---|---|
| `364ad939` | **Phase (ج)** — expiry alerts, the scheduler, the alerts endpoint, the screen |
| `759617e2` | **Phase (د)** — barcode counting once in the backend, plus the four review fixes |

### Completeness, stated honestly

- ✅ **Backend: verified.** 1668 tests passed, 68 real-database (PGlite) tests passed, `tsc` and `prisma validate` clean.
- ❌ **Flutter: NOT verified.** **61 Dart test cases have never been executed.** The environment where this work was done has no Dart or Flutter SDK, and every toolchain host was blocked (see §6).

**Do not treat Phase (د) as delivered until those 61 cases run green.** That is the first thing to do in Codex.

---

## 2. Getting started

```bash
git clone https://github.com/ahmadtefa/ERP_KAYAN.git
cd ERP_KAYAN
git checkout arena/56e71924-erp-kayan
git pull --ff-only
```

Then read §5 before touching anything: the Flutter tests are the open item.

---

## 3. Backend

Prerequisites: **Node 22** (developed on v22.22.3), **PostgreSQL 16**, npm.

```bash
cd backend
npm ci

cp .env.example .env      # then edit DATABASE_URL / JWT_SECRET
npx prisma generate
npx prisma migrate deploy
npm run seed:permissions  # permissions and roles
npm run seed              # optional: demo data

npm run start:dev         # http://localhost:3000/api/v1
```

### Tests

```bash
cd backend

npx tsc --noEmit                          # type check
npx prisma validate                       # schema check

# The unit suite. The flag matters: see the warning below.
NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBand

# The eight real-PostgreSQL suites (PGlite).
npm run test:pglite
```

**Warning that will otherwise cost you an hour:** the PGlite suites load an ES
module, so Jest needs `--experimental-vm-modules`. Run Jest **without** the flag
and `stock-takes.barcode-count.spec.ts` **fails on purpose** with a message
telling you this. That is deliberate: it used to skip silently, which reported a
green build while proving nothing. `npm run test:pglite` sets the flag for you.

### Baseline to compare against

| Check | Expected |
|---|---|
| `npx jest --runInBand` (with flag) | **1668 passed, 8 skipped**, 177/178 suites, exit 0 |
| `npm run test:pglite` | **8 suites, 68 tests**, exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npx prisma validate` | "schema is valid" |

The **8 skipped** are `quotation-pdf.spec.ts`, which needs a browser. Pre-existing, unrelated.

---

## 4. Flutter

Prerequisites: **Flutter 3.47.6** (pinned in `.github/workflows/*`), Dart **^3.13.5** (from `pubspec.yaml`).

```bash
flutter pub get
flutter analyze
flutter test
```

### The tests that matter most right now — run these first

```bash
flutter test test/shared/barcode_scan_test.dart --reporter expanded
flutter test test/widget/stock_take_barcode_scan_test.dart --reporter expanded
flutter test test/widget/invoice_barcode_scan_test.dart --reporter expanded
flutter test test/widget/invoice_unit_selection_test.dart --reporter expanded
flutter test test/widget/expiry_alerts_screen_test.dart --reporter expanded
```

**61 cases have never run.** Expect to fix genuine failures here: the code was
reviewed by reading, not by execution. Whatever breaks is real and was invisible
until now.

### Run the app

```bash
flutter run -d windows      # or -d chrome, -d <device-id>
flutter devices             # to list
```

---

## 5. What is done, and what is not

### Done

**Phase (ج) — expiry alerts**
- `backend/src/modules/notifications/expiry-alert.scheduler.ts`: a pass ~30 s after boot, then every 30 min. `unref()` on both timers, so it never holds the process open. A per-process `running` guard drops an overlapping tick. Kill switch: `KAYAN_DISABLE_EXPIRY_SCHEDULE=on`.
- `GET /inventory/batches/alerts` — read needs `inventory.batches.read`, the manual scan needs `notifications.manage`. Declared before `:id`.
- Duplicate alerts impossible: unique `(companyId, dedupeKey)` + `upsert`, with `P2002` swallowed for the two-scanners race.
- `lib/features/inventory/presentation/screens/expiry_alerts_screen.dart`.

**Phase (د) — barcode**
- One scan = one of the unit on the label. The conversion to base units happens **once, in the backend**; screens send `quantity` + `unitName` and never a converted figure.
- Sales/purchase invoices default to the item's default sale/purchase unit (`isDefaultSale` / `isDefaultPurchase`, now actually sent to the client).
- A stock take **locates** the frozen line, never adds one.
- The four review fixes: zero-count still validates its unit · multi-lot asks which batch · PGlite suite fails instead of skipping · `fromResponse` refuses an unusable factor instead of assuming 1.

### Not done / open

1. **The 61 Flutter tests have never executed.** This is the blocker.
2. **No distributed lock for the scheduler.** `docker-compose.yml` defines a single `api` service, so the in-process guard matches the shipped deployment. With N instances the *work* is duplicated (rows stay correct because of the unique key). The repo already uses `pg_advisory_xact_lock` in `licensing.service.ts` if you want to close it.
3. **`stock-documents.service.ts:466,483`** has the same zero-skip bug that was fixed in stock takes: `if (!quantity.isZero())` skips unit validation. Left alone deliberately — it is outside Phase (د) and changing it alters stock-document posting.
4. **`quotation-pdf.spec.ts`** skips without a browser (8 tests).
5. **A lot-controlled item**: a barcode cannot say which lot it came from, so the screen now asks. Still true that a bare barcode carries no lot.

---

## 6. Known errors and traps

| Symptom | Cause | Fix |
|---|---|---|
| `stock-takes.barcode-count.spec.ts` fails with "REFUSES TO PASS WITHOUT A REAL DATABASE" | Jest without `--experimental-vm-modules` | `npm run test:pglite`, or set `NODE_OPTIONS` |
| Jest OOM / heap crash | default heap too small for 178 suites | `NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=6144"` |
| `prisma migrate deploy` fails on this schema | Prisma 6.19.3's WASM engine splits PL/pgSQL `$`-quoted bodies | apply migrations with `psql` (see `ci.yml`) |
| Flutter tests cannot run in this sandbox | no SDK; `storage.googleapis.com`, `pub.dev`, `release-assets.githubusercontent.com` all blocked | run on your machine — that is the point of this handoff |
| Error-dialog button | it is `حسنًا` in **every** locale (`app_error_dialog.dart` uses `AppLocalizationsAr`) | assert `حسنًا`, not a translated string |
| Never assert a raw `ApiFailure.message` | it leaks transport detail | assert the user-facing sentence |
| `git diff` ignores untracked files | by design | `git add -N <file>` first (already done for all new files here) |

---

## 7. Building the Windows installer

Run on Windows. Flutter must be on `PATH`.

```powershell
flutter pub get
flutter build windows --release
```

Output: `build\windows\x64\runner\Release\`.

Then compile the installer with **Inno Setup 6** (the workflow pins 6.7-compatible):

```powershell
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" <script>.iss
```

`.github/workflows/windows-installer.yml` is the authoritative reference for the
exact paths, payload verification and the naming convention
(`KAYAN-ERP-Windows-x64-…-NOT-FOR-RELEASE`). Read it before building a
candidate; several steps there exist to stop an unverified installer being
published.

---

## 8. CI

`.github/workflows/ci.yml` runs on **`workflow_dispatch` only** — there is no
`pull_request` trigger, so a PR does **not** exercise it. To run it:

```bash
gh workflow run ci.yml --ref arena/56e71924-erp-kayan
gh run watch
```

Two steps exist specifically to catch the silent-skip regression: one asserts the
flag is present, one parses the Jest log and **fails** if any of the 8
real-database suites is missing from the `PASS` lines.

Other workflows: `barcode-quantity-focused.yml` runs the barcode widget tests on
Flutter 3.47.6, and `safe-checks.yml` runs on pull requests.

---

## 9. Suggested first moves in Codex

1. `flutter pub get && flutter analyze`.
2. Run the five Flutter test files in §4. **Fix what fails** — do not weaken a test to make it pass.
3. When green, update `phase-d-report.md` in the delivery folder with the real output and change its verdict from "NOT VERIFIED" to verified.
4. Only then consider §5 items 2 and 3.

Nothing in this repository is release-ready. `main` has not been touched.
