# PROJECT_KNOWLEDGE — نظام ERP كيان / Kayan ERP

Everything a developer needs to know before touching this repository: how the
system is put together, how to run it, which rules must not be broken, and
where the bodies are buried. Written after the October 2026 work session
(company setup, chart-of-accounts rework, exports, full backup/restore).

---

## 1. What this system is

A single-company Arabic-first ERP for a trading/retail business:

* **Flutter client** (`lib/`) — web + Windows desktop. RTL by default (`ar`),
  English (`en`) switchable. Green theme `#0B6E4F`, dense tables, no shadows
  (see `DESIGN.md`).
* **NestJS backend** (`backend/src/`) — REST under `/api/v1`, JWT auth,
  permissions checked server-side.
* **PostgreSQL** — Prisma ORM. Money is `Decimal(19,4)` everywhere.

The data model is **multi-company** (`companyId` on every row) but the product
runs one company per installation.

## 2. Repository map

| Path | What lives there |
|---|---|
| `backend/src/modules/company/` | Company profile, logo (BYTEA), HQ/branch units, first-run `setup` API |
| `backend/src/modules/accounting/` | Chart of accounts (tree CRUD), journal entries, fiscal periods |
| `backend/src/modules/export/` | XLSX/CSV/print-HTML/PDF for reports **and** everyday lists |
| `backend/src/modules/backup/` | Per-company JSON backup **and** full pg_dump backup/restore |
| `backend/src/common/maintenance/` | Write-blocking interceptor used during restores |
| `backend/src/common/localization/account-name.ts` | The one account-name rule (server side) |
| `lib/shared/utils/account_name.dart` | The same rule, client side — keep them identical |
| `lib/features/settings/` | Company settings screen (profile, logo, units) |
| `lib/features/data/` | Backup screen: full DB section + per-company JSON section |
| `backend/prisma/migrations/` | Additive migrations, applied in order |
| `docs/BACKUP_RESTORE.md` | Backup/restore design, tool discovery, recovery plan |
| `tools/backend_shape_check.dart` | Static shape check for the Dart side |

## 3. How to run it

### Database (any PostgreSQL 14+)

```bash
createdb kayan
cd backend
npm install
npx prisma migrate deploy     # never `db push`, never `migrate reset` on real data
npx tsx prisma/seed.ts        # idempotent: skips everything it already created
npm run start:dev             # or: npm run build && node dist/src/main.js
```

The seed creates: company (code `KAYAN`), headquarters `MAIN`, the starter
chart of accounts (hierarchical codes 1 → 11 → 1101 …), roles with fine-grained
permissions, and the `admin` user.

Optional company profile for first-run from an installer:

```bash
KAYAN_COMPANY_CODE=... KAYAN_COMPANY_NAME_AR=... KAYAN_COMPANY_NAME_EN=... \
KAYAN_COMPANY_PHONE=... KAYAN_COMPANY_EMAIL=... KAYAN_COMPANY_ADDRESS=... \
  npx tsx prisma/seed.ts
```

### Flutter

```bash
flutter pub get
flutter run -d chrome        # or windows
flutter build web            # the build that must always succeed
```

### Tests

```bash
cd backend && npx jest       # unit tests (writers, COA rules, backup guards…)
flutter test                 # Dart/widget tests
```

## 4. Prisma — read this before anything else

The project runs Prisma **without native engines** (works offline and inside
restricted environments):

* `schema.prisma`: `engineType="client"` +
  `previewFeatures=["queryCompiler","driverAdapters"]`.
* Every `PrismaClient` MUST be constructed with the pg adapter:

  ```ts
  new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  ```

  This is already the case in `PrismaService`, `prisma/seed.ts` and
  `scripts/prepare-database.mjs`. A bare `new PrismaClient()` will throw.

* `prisma generate`/`migrate` need two harmless stub env vars in offline
  environments (they are only used to satisfy the CLI's existence checks):

  ```bash
  PRISMA_SCHEMA_ENGINE_BINARY=/tmp/schema-engine-stub \
  PRISMA_QUERY_ENGINE_LIBRARY=/tmp/libquery_engine_stub.so.node \
    npx prisma generate
  ```

## 5. Rules that must not be broken

1. **Migrations are additive.** No drops, no `migrate reset`, no `db push` on
   real data. Both fresh and existing databases must keep working.
2. **Never log or commit secrets** — no DB passwords, no JWT secrets, none in
   README, test reports or backup filenames.
3. **Account codes are never renumbered.** New codes extend the chart's own
   numbering (`suggestCode` = parent code + the width its children use).
4. **Grouping (تجميعي) accounts never receive postings.** Journal creation
   refuses them; `isPostable` cannot be turned on while an account has
   children.
5. **Deletes are refusals first.** Accounts/units with movements or children
   are not deletable — the server says so and the UI offers deactivate instead.
6. **One headquarters per company**, branches link upward, and the parent walk
   refuses cycles (account tree and unit tree).
7. **The account name rule is one function on each side**
   (`account-name.ts` / `account_name.dart`): preferred language → other
   language → code, never empty. User-entered names are never machine-
   translated.
8. **A full restore takes a safety backup first** and only reports success
   after the post-restore integrity check. If that check fails, the safety
   backup is restored automatically; if THAT fails, write-blocking maintenance
   stays ON.

## 6. Features added in the October 2026 session

### Company / HQ / branch setup
* `GET/PATCH /company/profile`, `GET/POST/DELETE /company/logo`
  (PNG/JPEG/WebP, magic-byte validated, ≤ 2 MB, stored as BYTEA — never as a
  loose file).
* `GET/POST /company/branches`, `PATCH/DELETE /company/branches/:id`.
  `kind: HEADQUARTERS | BRANCH`, `parentBranchId` self-relation with cycle
  check. Soft delete refused while sub-units/entries/stock/users remain.
* First-run: `GET /setup/status`, `POST /setup/initial` — one transaction,
  refuses to run twice (resumable, no duplicates).
* UI: «بيانات الشركة» screen (profile + logo + units), route
  `/settings/company`.

### Remember-me on login
* `lib/core/storage/credentials_store.dart`: off by default; username in
  shared preferences; password **only** in the platform keystore
  (`flutter_secure_storage`), never in plain prefs/local storage; on the web
  the username alone is kept. One tap clears everything.

### Multi-level chart of accounts
* Full CRUD under `/accounting/chart-of-accounts` (+ `suggest-code`). Unique
  codes per company, parent-type matching, ancestor-walk cycle check,
  auto-demote of a parent gaining its first child (only when the parent has no
  movements), delete refused with movements or children.
* UI: expand/collapse tree, search (code + both names), type filter, create /
  edit / delete dialogs with parent picker.

### Full Arabic/English localization for entries & accounts
* Account names chosen per language everywhere (screens, reports, exports) via
  the shared rule. Journal lines carry `accountCode`, `accountNameEn`,
  `accountNameAr`, `accountName`.

### Exports
* Real `.xlsx` (exceljs): typed number/date cells, column widths, totals row,
  Arabic RTL sheets, company header with optional logo, report name,
  creation date.
* Chart export keeps the tree: `Level` column + indented names + parent code.
* Journal export is line-level: entry number/date/description, account code +
  account name (localized), line description, debit/credit, grand totals.
* Print HTML: RTL Arabic with shaping via the browser's font stack, repeating
  `thead` per printed page, fixed footer identity line, optional auto-print.
* PDF: Chrome headless render of the print page + `pdf-lib` page-number
  stamping ("n / total"). Capability endpoint reports
  `pdfOnTheServer: false` when no Chrome exists — the UI hides the button
  instead of failing.

### Full DB backup / restore
* `pg_dump --format=custom`, filenames `kayan-{full|safety}-YYYY-MM-DD-HH-MM-SS.dump`
  in `KAYAN_BACKUP_DIR` (server-local folder). Routes under `/backup/full`
  (permission `admin.backup`). Tool discovery: `KAYAN_PG_DUMP`/
  `KAYAN_PG_RESTORE` env → PATH → platform install dirs.
* Restore pipeline: confirm flag → PGDMP magic + scratch-database trial
  restore → safety backup → maintenance write-block → `pg_restore --clean
  --if-exists --exit-on-error` → reconnect + row-count + journal-balance
  integrity check → audit record. Failures after the real restore begins
  auto-recover from the safety backup; if that also fails, maintenance stays
  ON and the server says so.
* Details: `docs/BACKUP_RESTORE.md`.

### New permissions (seeded + setup mirror + migration)
`accounting.accounts.read`, `accounting.accounts.create`,
`accounting.accounts.update`, `accounting.accounts.delete`,
`admin.company.manage`.

For **existing** databases the seed never runs again, so migration
`20261011160000_grant_new_permissions` fills the gaps additively (idempotent,
never deletes grants):

* `accounting.accounts.read` → roles that already read the ledger/periods/
  reports;
* `accounting.accounts.create/update/delete` → roles that already create
  journal entries;
* `admin.company.manage` → roles that already manage users (admin roles only).

The access token carries permission claims for session compatibility, but the API
rebuilds permissions from active, tenant-scoped database roles on every request.
Role/permission changes therefore take effect immediately without waiting for the
next sign-in; deleted roles and cross-company role assignments are ignored.

### Backup tools on Windows
The packaged program carries `pg_dump`/`pg_restore` (+ their DLLs) inside
`backend\pg\` — the build script copies them from the portable PostgreSQL
(`%LOCALAPPDATA%\kayan-tools\pgsql`, provisioned by
`scripts/install-postgres-portable.bat`) or from an installed PostgreSQL,
newest first, and refuses to finish if the copies cannot answer `--version`.
`scripts/verify-package.ps1` checks the same at packaging time. At runtime the
lookup order is: `KAYAN_PG_DUMP`/`KAYAN_PG_RESTORE` → `backend\pg` (the
package's own copy) → the portable toolchain → `PATH` → installed PostgreSQL;
`GET /backup/full/capabilities` reports the chosen tools, the server version
and a warning when pg_dump is older than the server.

## 6.5 The application icon

One source: **`Kayan.png` at the repository root** (the KAYAN Integrated
Solutions logo, 352×121, opaque RGB on white — the file is used as-is and is
never redrawn or recoloured). `tools/generate_icons.py` (needs Pillow) renders
every icon from it, keeping the logo whole on a white square that matches its
own background:

* `windows/runner/resources/app_icon.ico` (16–256) — embedded into
  `erp_kayan.exe` at build time; it is also the window/taskbar icon
  (`win32_window.cpp` loads `IDI_APP_ICON`) and the installer's own icon
  (`SetupIconFile` in `scripts/installer-windows.iss`);
* `web/favicon.png`, `web/icons/Icon-192.png`, `Icon-512.png` (browser tab,
  apple-touch-icon, PWA) and `Icon-maskable-192/512.png` (mark kept inside
  the 80% launcher safe zone);
* the build script copies `icons\app_icon.ico` + `icons\Kayan.png` into the
  package, the installer's shortcuts point at that copy, and
  `verify-package.ps1` checks both.

After changing `Kayan.png`: run `python tools/generate_icons.py`, then rebuild
(web copies `web/` as-is; the exe re-embeds the .ico at compile time).

## 7. Known gaps / honest limitations

* **Dart/Flutter toolchain** was not available in the implementation sandbox:
  `flutter test`, `flutter analyze` and `flutter build web` must be run on a
  machine with the SDK. The Dart tests were written to run there
  (`test/core/credentials_store_test.dart`, `test/shared/account_name_test.dart`).
* **Generated l10n files**: `lib/l10n/app_ar.arb` and `lib/l10n/app_en.arb`
  are the source of truth. The three files under `lib/l10n/generated/` are
  produced by Flutter's generator and must NOT be maintained by hand. Because
  the sandbox had no Flutter SDK they were brought in line with the ARB once,
  and that state is temporary. On any machine with Flutter, run from the
  repository root (where `l10n.yaml` lives):

  ```bash
  flutter gen-l10n     # regenerates lib/l10n/generated/ from lib/l10n/*.arb
  flutter analyze
  flutter test
  ```

  After that, commit the regenerated files and stop touching them; edit only
  the ARB files.
* **PDF rendering** needs Chrome/Chromium on the server
  (`PUPPETEER_EXECUTABLE_PATH` or an install in the usual paths). Without it,
  XLSX/CSV/print still work and the PDF button is hidden.
* **PG roles/grants** are not inside the dump (`--no-owner --no-privileges`):
  global roles are out of scope for `pg_dump` by design. The restore runs with
  the application's own connection, so no role juggling is needed.
* Server-side validation messages come back in English (Problem Details);
  UI-side validation and confirmations are localized. Full backend message
  localization is future work.
