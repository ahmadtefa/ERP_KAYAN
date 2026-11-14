# Flutter frontend — what is missing, and how to put it back

**Date:** 2026-11-07
**Branch:** `arena/56e71924-erp-kayan` at `55519ce`
**Reference:** PR #67 head `211f34e2c9a16761fa82500770458e924473b1fc` (fetched read-only as `refs/pull/67/head`; no branch created, nothing pushed, PR left open and untouched)
**Nothing in this document has been executed.** It is an audit plus a plan. No Dart file was created, edited or deleted; the three protected files were not opened for writing.

---

## 1. The one fact that shapes everything

`git merge-base HEAD 211f34e` **fails**. This branch and PR #67 share no ancestor at all — not even the base commit `d3f62e9` is in PR #67's history. These are two unrelated trees, not two versions of the same work.

```
$ git merge-base HEAD 211f34e
(fails, exit 1)
$ git merge-base --is-ancestor d3f62e9 211f34e
NO
```

**Consequence:** nothing can be cherry-picked, rebased or merged. The Flutter work has to be re-applied file by file against *our* tree, which has meanwhile diverged in the opposite direction (we kept an `orders` feature that PR #67 deleted; we kept persistent-draft and race-guard behaviour that PR #67 rewrote away). A bulk `git checkout 211f34e -- lib/` would destroy both. Do not do it.

## 2. Exact size of the gap

`git diff --numstat HEAD 211f34e`:

| Area | Files | Added | Deleted | Net |
|---|---|---|---|---|
| `lib/` | 111 | 15,251 | 7,942 | +7,309 |
| `test/` | 94 | 4,284 | 7,688 | −3,404 |
| `backend/` | 275 | 22,654 | 15,046 | +7,608 |

Of the 111 `lib/` files, **23 do not exist here at all** and **88 exist but differ**. Of the 94 `test/` files, **14 are new** and **80 differ** — but 74 of those 80 differ only because PR #67 *deleted* them, so they are not work to redo, they are work to protect.

### 2.1 The 23 files that do not exist here — the actual missing functions

Every one of these is a whole screen, widget or data source. This is the honest answer to "which functions are missing": none are half-written, these are all absent.

**Inventory (10 files, 6,564 lines) — the bulk of the gap**

| File | Lines | What it is |
|---|---|---|
| `lib/features/inventory/presentation/screens/stock_documents_screen.dart` | 1,046 | stock document create/review/approve/post/reverse + voucher draft editing |
| `lib/features/inventory/presentation/screens/write_offs_screen.dart` | 969 | write-off register, approve/post flow |
| `lib/features/inventory/presentation/screens/storage_locations_screen.dart` | 947 | location tree per warehouse, move-stock |
| `lib/features/inventory/presentation/screens/warehouses_screen.dart` | 923 | warehouse CRUD, deactivate/reactivate, balances |
| `lib/features/inventory/presentation/screens/stock_takes_screen.dart` | 886 | stock take: count → approve → post → cancel |
| `lib/features/inventory/presentation/screens/batches_screen.dart` | 679 | batches, expiry report, trace, issue/transfer |
| `lib/features/inventory/presentation/screens/inventory_reports_screen.dart` | 625 | valuation, slow-moving, reorder, cost-centre, stock-take variance + export/print |
| `lib/features/inventory/presentation/screens/item_thresholds_screen.dart` | 430 | per-warehouse item thresholds |
| `lib/features/inventory/presentation/screens/warehouse_access_screen.dart` | 418 | per-user warehouse grants |
| `lib/features/inventory/presentation/widgets/item_units_editor.dart` | 598 | multi-unit editor (packing units, barcodes, conversion) |

**Shared / infrastructure (6 files)**

| File | Lines | What it is |
|---|---|---|
| `lib/core/units/item_units.dart` | 160 | unit conversion model + helpers used by the editors above (note: `test/widget/unit_conversion_helpers_test.dart` is also missing) |
| `lib/app/theme/section_theme.dart` | 62 | per-section theming used by the new screens |
| `lib/shared/widgets/kayan_logo.dart` | 92 | logo widget |
| `lib/shared/widgets/phone_browser_notice.dart` | 148 | mobile-browser notice |
| `lib/shared/widgets/user_avatar.dart` | 176 | avatar widget (paired with the missing backend `user-avatars` controller) |
| `lib/features/admin/presentation/widgets/user_photo_dialog.dart` | 328 | admin user photo upload dialog |

**Notifications (2 files) — a whole feature that does not exist on our side**

| File | Lines | What it is |
|---|---|---|
| `lib/features/notifications/presentation/screens/notification_center_screen.dart` | 419 | notification centre |
| `lib/features/notifications/presentation/widgets/notification_settings_panel.dart` | 421 | notification settings |

**Settings / data (5 files)**

| File | Lines | What it is |
|---|---|---|
| `lib/features/settings/data/print_settings_data_source.dart` | 147 | print-settings API |
| `lib/features/settings/presentation/providers/print_settings_providers.dart` | 62 | print-settings providers |
| `lib/features/settings/presentation/screens/print_settings_screen.dart` | 314 | print-settings screen |
| `lib/features/data/presentation/widgets/print_visibility_prompt.dart` | 59 | print-visibility prompt |
| `lib/features/quotations/data/quotation_backgrounds_data_source.dart` | 129 | **quotations — see §4, do not touch** |

### 2.2 The 14 missing tests

`test/shared/design_contrast_test.dart` (293), `test/shared/logo_transparency_test.dart` (189),
`test/widget/inventory_reports_screen_test.dart` (211), `test/widget/invoice_editor_lots_test.dart` (256),
`test/widget/invoice_unit_display_test.dart` (317), `test/widget/item_units_dialog_test.dart` (452),
`test/widget/phone_browser_notice_test.dart` (133), `test/widget/print_visibility_prompt_test.dart` (159),
`test/widget/sidebar_scroll_test.dart` (253), `test/widget/stock_documents_screen_test.dart` (207),
`test/widget/unit_conversion_helpers_test.dart` (78), `test/widget/user_avatar_test.dart` (269),
`test/widget/warehouse_access_screen_test.dart` (197), `test/widget/write_offs_screen_test.dart` (322).

## 3. Good news: the backend half is already done

This is the most useful finding of the audit. The backend routes that the 23 missing screens call **already exist here**, because they were restored in `b1db8a2`:

| Screen needs | Route present here? |
|---|---|
| `stock_documents_screen` | `inventory/stock-documents` — present (8 routes incl. `voucher-draft`, `review`, `write-off/*`) |
| `write_offs_screen` | same controller, `write-off/approve` + `write-off/post` — present |
| `storage_locations_screen` | `inventory/locations` — present (`tree/:warehouseId`, `move-stock`) |
| `warehouses_screen` | `inventory/warehouses` — present (incl. `balance`, `deactivate`, `reactivate`) |
| `stock_takes_screen` | `inventory/stock-takes` — present (`count`, `approve`, `post`, `cancel`) |
| `batches_screen` | `inventory/batches` — present (`expiry-report`, `:id/trace`, receive/issue/transfer/write-off) |
| `inventory_reports_screen` | `inventory/reports/:slug` + `:slug/export` and the print/pdf controller — present |
| `item_thresholds_screen` | `inventory/item-thresholds` — present |
| `warehouse_access_screen` | `inventory/warehouse-access` — present |
| `item_units_editor` | `inventory/items/:itemId/units` CRUD — present |
| `notification_center_screen` | `notifications` — **MISSING** |
| `print_settings_screen` | `company/print-settings` — present |
| `user_photo_dialog` | `admin/user-avatars` — **MISSING** (backend file exists only in PR #67) |

So 11 of 13 screens can be written against endpoints that are live and tested today. Only two need backend work first (`notifications`, `admin/user-avatars`), and both those backend pieces exist in PR #67 as self-contained new files.

## 4. The protected files and quotations

**Protected — must stay byte-identical to `d3f62e9`, verified unchanged right now:**

| File | vs PR #67 |
|---|---|
| `lib/features/data/presentation/screens/import_screen.dart` | **PR #67 has a 488-line version; ours is 568 lines and is authoritative.** Its diff includes the import screen, so any plan that "takes PR #67's data feature" would silently overwrite it. |
| `lib/features/inventory/presentation/screens/stock_vouchers_screen.dart` | **absent from PR #67 entirely.** The voucher-draft route (`PUT /inventory/stock-documents/:id/voucher-draft`) exists on our backend and is part of `b1db8a2`; the screen consuming it is ours alone. PR #67 replaced it with `stock_documents_screen`. |
| `test/widget/stock_voucher_flow_test.dart` | **absent from PR #67.** Our only guard on the above. |

**Quotations — leave alone.** PR #67 changes 6 client quotation files and adds 4 backend ones (`quotation-background`, `quotation-backgrounds.controller/service`, `quotation-redaction`) plus a Prisma migration for PDF backgrounds. Per the standing instruction, none of this is in scope. The one shared file, `quotation_backgrounds_data_source.dart`, must not be added either — it is quotation code.

## 5. What PR #67 deletes that we must keep

Re-applying PR #67's Flutter files wholesale would delete 10 `lib/` files and 74 `test/` files that exist only on our side. The important ones:

- `lib/features/orders/` — the whole feature (4 screens + retry store) and 8 order tests. PR #67 has **no** orders feature at all.
- `lib/app/router/draft_exit_guard.dart`, `lib/core/backend/setup_state.dart`
- `lib/features/inventory/presentation/providers/stock_providers.dart`
- `lib/features/auth/presentation/widgets/user_photo.dart` (superseded by `user_avatar.dart` in PR #67 — replacing it is fine, deleting it is not, until the replacement lands and is proven)
- 74 widget/feature tests, including race-guard, unsaved-guard and refresh-error suites

## 6. Verification is currently impossible here — say so plainly

There is no Dart SDK and no Flutter SDK in this environment, and the download is blocked:

```
$ which flutter dart          -> nothing
$ curl -I https://storage.googleapis.com/flutter_infra_release/...
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL
```

So **no `flutter analyze`, no `flutter test`, no widget test, no build** can be run for any Flutter change — not for this audit, not for the re-implementation. This is a hard blocker, not a preference. Any plan must therefore be staged so that Dart code only lands in batches that a machine *with* Flutter can verify, and must stay uncommitted until then.

What can be verified here, statically, and was:
- every relative import in the current `lib/` resolves (no dangling imports today);
- the packages the 23 missing files import (`flutter`, `flutter_riverpod`, `decimal`, `go_router`, `dio`) are all already declared in `pubspec.yaml` — **no dependency additions needed**;
- no missing file references an asset, and `assets/1.png` referenced by `pubspec.yaml` is present.

## 7. Plan — five stages, in this order

**Stage 0 — unblock verification (prerequisite, outside this sandbox).**
Get Flutter on a machine that has it, or restore network access to `storage.googleapis.com`. Nothing else should start before `flutter analyze` and `flutter test` can run, because every later stage is unverifiable code.

**Stage 1 — foundation, no UI.** Add the three shared pieces first, because the screens import them:
`lib/core/units/item_units.dart`, `lib/app/theme/section_theme.dart`, and the three `lib/shared/widgets/` files (`kayan_logo`, `phone_browser_notice`, `user_avatar`).
Then the three settings/print files and `print_visibility_prompt` (they are leaf features).
Verify: `flutter analyze` clean, `flutter test test/widget/unit_conversion_helpers_test.dart test/widget/user_avatar_test.dart test/widget/phone_browser_notice_test.dart`.

**Stage 2 — inventory screens, backend already live.** Port in this dependency order, testing after each:
`warehouses_screen` → `storage_locations_screen` → `item_thresholds_screen` → `warehouse_access_screen` → `batches_screen` → `write_offs_screen` → `stock_takes_screen` → `inventory_reports_screen` → `stock_documents_screen` → `item_units_editor`.
Nine of the ten are pure reads/writes against routes proven in `b1db8a2`. Wire the routes and shell entries **last**, in `app_router.dart` and `erp_shell.dart`, and only after the screens compile — those two files are where the protected `import_screen`/`stock_vouchers` navigation lives, so they need a hand review, not a wholesale replacement.

**Stage 3 — the two backend gaps.** Port `backend/src/modules/notifications/*` (4 files + 1 spec) and `backend/src/modules/admin/user-avatars.*` (2 files + spec) — these are self-contained additions, and they can be proven here with the existing `npm ci` → `prisma generate` → build → jest loop, unlike anything Dart. Do this stage **before** the notification and avatar screens, not after.

**Stage 4 — notifications + avatars UI.** `notification_center_screen`, `notification_settings_panel`, `user_photo_dialog`. Depends on Stage 3.

**Stage 5 — tests, then the deleted-file audit.** Port the 14 missing tests, then walk §5 and confirm every file PR #67 deletes is still present on our side. Only then consider routing/shell changes.

**Explicitly out of scope for every stage:** the three protected files, all of `lib/features/quotations/`, the `orders` feature, and the 74 tests that exist only on our side.

## 8. Honest status

- Backend: **done and committed** — `b1db8a2` (73 files) + `55519ce` (pglite), both verified by `npm ci` → build → 1446 jest passes → 13/13 integration checks.
- Flutter: **unchanged since `d3f62e9`.** Not one Dart file has been written this session. The gap is 23 new files and 14 new tests, and it cannot be verified in this environment.
- The backup does **not** contain the Flutter work — it never existed here to back up. That is exactly why §1 matters: PR #67 is currently the only place that Flutter work exists.
