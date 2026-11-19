# الأدوار والصلاحيات والتنبيهات — Multi-role access control and the notification centre

This is the reference for "who may do what" and "what the program tells you",
written for the person who installs the program and for whoever maintains it.

---

## 1. The model, in one paragraph

A person's permissions are:

> **union of the active roles they hold in their company**
> **+ permissions granted to them by name**
> **− permissions denied to them by name**

**Deny wins.** That order is the whole reason a per-user deny exists: a role that
grants `accounting.journal.post` to everyone in finance must not be able to
defeat a decision that one person may not post. A **disabled** role is still
assigned, keeps its holders and its history, and grants nothing until it is
switched back on.

Nothing is computed in a screen. The same function
(`backend/src/common/rbac/effective-permissions.ts`) is used by sign-in, by
refresh, by the request guard and by the preview endpoint, so a screen cannot
disagree with the guard that will refuse the request. The guard reloads the
person's roles and denies from the database **on every request**, so a revoked
permission stops working on the next click, not when a token expires.

## 2. The eighteen roles

They live in one file, `backend/prisma/role-catalogue.ts`, shared by the seed,
the start-up bootstrap and the tests. A test fails if a role names a permission
prefix that matches nothing.

| Code | Arabic | English | Group |
| --- | --- | --- | --- |
| `ADMIN` | مدير النظام | System administrator | Management |
| `GENERAL_MANAGER` | مدير عام | General manager | Management |
| `FINANCE_MANAGER` | مدير مالي | Finance manager | Finance |
| `ACCOUNTANT` | محاسب | Accountant | Finance |
| `SALES_MANAGER` | مدير مبيعات | Sales manager | Sales |
| `SALES_CLERK` | موظف مبيعات | Sales clerk | Sales |
| `PURCHASING_MANAGER` | مدير مشتريات | Purchasing manager | Purchasing |
| `PURCHASING_CLERK` | موظف مشتريات | Purchasing clerk | Purchasing |
| `WAREHOUSE_MANAGER` | مدير مخازن | Warehouse manager | Inventory |
| `STOREKEEPER` | أمين مخزن | Storekeeper | Inventory |
| `STOCK_AUDITOR` | مسؤول جرد | Stock auditor | Inventory |
| `TREASURER` | أمين خزينة | Treasurer | Cash |
| `BANK_OFFICER` | مسؤول بنوك | Bank officer | Cash |
| `COLLECTION_OFFICER` | مسؤول تحصيل | Collections officer | Cash |
| `INTERNAL_AUDITOR` | مراجع داخلي | Internal auditor | Audit |
| `REPORT_USER` | مسؤول تقارير | Reports officer | Audit |
| `READ_ONLY` | مستخدم للقراءة فقط | Read-only user | Custom |
| `CUSTOM` | دور مخصص | Custom role (template) | Custom |

`ADMIN` and `ACCOUNTANT` are the two roles every installation already has, and
they keep their codes on purpose: a user who holds `ACCOUNTANT` today holds
`ACCOUNTANT` after the upgrade, with no row rewritten.

`CUSTOM` is a template with no permissions. It is not seeded; the roles screen
offers it as a starting point, and "copy role" starts from any existing role.

### What each role deliberately cannot do

* No role except `ADMIN` holds `admin.roles.manage`, `admin.backup.restore` or
  `admin.reset`. A test asserts this, so "no automatic second super-admin" is a
  property of the catalogue, not a promise in a document.
* `STOREKEEPER` can receive, issue and transfer, and **cannot** see cost
  (`inventory.cost.read`) or approve.
* `SALES_CLERK` and `PURCHASING_CLERK` can prepare documents and **cannot post**
  them; their managers can.
* `READ_ONLY` holds only `.read` permissions plus the dashboard and the
  notification centre.

## 3. Upgrading an installation that already has data

Two pieces, deliberately separate:

1. **The migration** `20261119120000_roles_catalogue_and_deny` is additive: four
   columns on `roles` (`descriptionEn`, `descriptionAr`, `category`, `isActive`),
   three on `user_permissions` (`isDenied`, `reason`, `updatedAt`), one index,
   and two `UPDATE`s that label the existing `ADMIN` and `ACCOUNTANT` roles.
   Nothing is dropped, nothing is rewritten, no password or photo is touched.
2. **The catalogue pass** (`RoleCatalogueBootstrap`) adds the roles a company is
   missing, at start-up and on demand. It only inserts what is absent: it never
   renames a role, never removes a permission a company added, never touches an
   assignment. Running it twice changes nothing.

On demand, without starting the program:

```bash
DATABASE_URL=postgresql://… npx ts-node --transpile-only scripts/apply-role-catalogue.ts
```

or as an administrator: `POST /admin/roles/sync-catalogue`.

### Proof, on a real database

```bash
PGUSER=kayan PGPASSWORD=… PGPORT=5432 node scripts/verify-rbac-upgrade.mjs
```

It builds a database at the schema **before** the migration, fills it with the
rows an old installation has (two users with an Argon2 hash, a photo, a branch,
two roles, a direct grant, an audit row, a notification), applies the migration
and the catalogue pass, and checks 20 facts - users, passwords, photos,
branches, grants and notifications unchanged; the tuned `ACCOUNTANT` not
rewritten; nobody moved to another role; a second pass adds nothing. CI runs it
on its ephemeral PostgreSQL next to the cost-center and chart upgrade proofs.

## 4. The screens

**Administration → Roles.** Every role with its code, names, description, group,
permission count and user count. Actions: permissions (grouped by module with
select-all and clear-all, a live count, and a server preview with warnings before
saving), copy, enable/disable, edit (not for system roles' names), delete (never
for system roles, never for a role somebody still holds).

**Administration → Users.** Assign several roles to one person; the server unions
them. A user row also has:

* **extra permissions** — grants on top of the roles;
* **denied permissions** — explicit refusals that beat every role;
* **effective permissions** — what the person can do today, asked of the server.

Both lists save with an optimistic check (`expectedExtraPermissions`,
`expectedDeniedPermissions`), so two administrators editing at once get a clear
conflict instead of silently overwriting each other.

**Preview before saving** — the permission picker costs no request. The rules
that decide which grant deserves a second look are published *with* the
catalogue (`GET admin/roles/permissions` → `warnings: [{match, severity,
messageEn, messageAr}]`, from `backend/src/common/rbac/permission-warnings.ts`),
so the screen applies exactly the server's list while the boxes are ticked: a
one-line count above the list, and the full message before the write. There is
one list, so the two can never drift.

Servers and other clients can ask the same question directly:
`POST admin/roles/permissions-preview {permissions}` and
`POST admin/users/permissions-preview {roleIds, extraPermissions, deniedPermissions}`
answer "what will this person be able to do" for values that are not saved yet,
with the same warnings in Arabic and English (role management, backups, reset,
cost, period close) and for a set that allows nothing at all.

## 5. The notification centre

One table, one catalogue of kinds (`notification-kinds.ts`), two scanners.

| Kind | Meaning | Permission needed |
| --- | --- | --- |
| `STOCK_EXPIRY_SOON` / `STOCK_EXPIRED` | A lot near, at, or past expiry | `inventory.stock.read` |
| `STOCK_EXPIRED_WRITE_OFF_PENDING` | Expired stock still on the shelf | `inventory.batches.writeoff` |
| `STOCK_BELOW_MINIMUM` / `STOCK_OUT_OF_STOCK` / `STOCK_ABOVE_MAXIMUM` | A shelf against its own thresholds | `inventory.stock.read` |
| `STOCK_ABNORMAL` | A negative quantity or value | `inventory.stock.read` |
| `STOCK_VOUCHER_PENDING_APPROVAL` | A sales or purchase order still waiting | `inventory.stock.approve` |
| `JOURNAL_PENDING_APPROVAL` | A journal entry waiting for approval | `accounting.journal.approve` |
| `INVOICE_OVERDUE` | A posted customer invoice past its date with money on it | `sales.invoices.read` |
| `PAYABLE_DUE` / `PAYABLE_OVERDUE` | A supplier bill falling due within 7 days, or past it | `purchases.invoices.read` |
| `ADMIN_ALERT` | Role/user changes, password resets, restores, resets | `admin.audit.read` |

Properties that make it safe to leave running:

* **one fact, one row** — the unique index on `(companyId, dedupeKey)` is the
  whole duplicate policy; `repeatAfterHours` re-opens a still-true fact on
  purpose instead of duplicating it;
* **it closes what stopped being true** — a corrected balance closes its own
  alarm rather than standing next to news that contradicts it;
* **no leakage** — a row is visible only to somebody who holds its permission,
  in its branch, addressed to their role, on their shelves, and the badge counts
  only what they could open;
* **no sensitive numbers without the permission** — an alert written for
  `inventory.cost.read` is invisible to a person without it;
* **"nothing" is not the same as "switched off"** — `POST /notifications/scan`
  returns the scheduler's state with its answer.

Settings (`GET /notifications/settings`, `PUT /notifications/settings/:type`):
enable/disable per kind, severity, expiry bands (default 30/60/90 plus 7 and 0),
audience roles, warehouse restriction, repeat interval.

Screens: the bell in the top bar with the unread badge, the dashboard panel with
the five loudest open alerts, and the centre (`/notifications`) with filters by
status, kind and priority, mark read / mark unread / mark all read / archive,
and a refresh that does not need a restart. Arabic, English and RTL throughout.

## 6. Where the code is

| Concern | File |
| --- | --- |
| The arithmetic | `backend/src/common/rbac/effective-permissions.ts` |
| Warnings for a set | `backend/src/common/rbac/permission-warnings.ts` |
| The eighteen roles | `backend/prisma/role-catalogue.ts` |
| Adding missing roles | `backend/src/modules/admin/role-catalogue.bootstrap.ts` |
| Roles API | `backend/src/modules/admin/roles.{controller,service}.ts` |
| Users, grants and denies | `backend/src/modules/admin/users.{controller,service}.ts` |
| Notification kinds | `backend/src/modules/notifications/notification-kinds.ts` |
| Scanners | `…/notifications.service.ts` (`scanStock`, `scanBusiness`) |
| Automatic runs | `…/notifications/expiry-alert.scheduler.ts` |
| Upgrade proof | `backend/scripts/verify-rbac-upgrade.mjs` |
