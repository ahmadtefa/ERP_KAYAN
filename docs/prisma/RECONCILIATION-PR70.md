# Reconciliation: this branch (`db57e3b`) vs PR #70 (`022c0321`)

Generated from the actual Git objects, not from memory. Reproduce with the
commands at the bottom of this file.

* merge-base: `b9997fe5be04a632a8564a28fc2cf712aa3c58b8` — Bound and instrument isolated installer smoke phases
* this branch: `db57e3b`, 77 commits ahead of the merge-base
* PR #70: `022c0321`, 16 commits ahead of the merge-base
* files changed here: 42; in PR #70: 59; **common: 17**; only here: 25; only in PR #70: 42

There is no 364-commit divergence to untangle: both sides grew from one merge-base,
and most of their work is disjoint. A merge or rebase would still be the wrong tool,
because the same subsystem (licensing, migrations, Windows packaging) evolved twice with
different answers.

## 1. Changed on both sides (conflict candidates)

| file | here | PR #70 |
| --- | --- | --- |
| `.github/workflows/windows-candidate-preflight.yml` | M | M |
| `backend/scripts/verify-licensing-postgres.mjs` | M | M |
| `backend/src/modules/licensing/license-store.spec.ts` | M | M |
| `backend/src/modules/licensing/license-store.ts` | M | M |
| `backend/src/modules/licensing/licensing.service.ts` | M | M |
| `distribution/windows/install-runtime.ps1` | M | M |
| `lib/core/backend/local_backend_io.dart` | M | M |
| `lib/features/licensing/presentation/screens/licence_screen.dart` | M | M |
| `lib/features/licensing/presentation/widgets/licence_gate.dart` | M | M |
| `lib/l10n/app_ar.arb` | M | M |
| `lib/l10n/app_en.arb` | M | M |
| `lib/l10n/generated/app_localizations.dart` | M | M |
| `lib/l10n/generated/app_localizations_ar.dart` | M | M |
| `lib/l10n/generated/app_localizations_en.dart` | M | M |
| `scripts/smoke-test-installed-windows.ps1` | M | M |
| `scripts/windows-release-policy.test.mjs` | M | M |
| `test/core/backend/local_backend_io_test.dart` | M | M |

## 2. Only on this branch (`db57e3b`)

* `backend/src/` — 10 file(s)
  * `backend/src/modules/backup/full-backup.service.spec.ts`
  * `backend/src/modules/backup/full-backup.service.ts`
  * `backend/src/modules/health/health.controller.spec.ts`
  * `backend/src/modules/licensing/installed-corrupt-state-safety.spec.ts`
  * `backend/src/modules/licensing/licence-backup-archive.spec.ts`
  * `backend/src/modules/licensing/licence-backup-archive.ts`
  * … 4 more
* `docs/licensing/` — 3 file(s)
  * `docs/licensing/KEY-PROTECTION.md`
  * `docs/licensing/LICENCE-BACKUPS.md`
  * `docs/licensing/README.md`
* `.github/workflows/` — 2 file(s)
  * `.github/workflows/ci.yml`
  * `.github/workflows/windows-installer.yml`
* `distribution/windows/` — 2 file(s)
  * `distribution/windows/RepairTool.cs`
  * `distribution/windows/repair-runtime.ps1`
* `backend/package-lock.json/` — 1 file(s)
  * `backend/package-lock.json`
* `backend/package.json/` — 1 file(s)
  * `backend/package.json`
* `backend/prisma.config.ts/` — 1 file(s)
  * `backend/prisma.config.ts`
* `lib/core/` — 1 file(s)
  * `lib/core/backend/local_backend_stub.dart`
* `scripts/branch-candidate-release.test.mjs/` — 1 file(s)
  * `scripts/branch-candidate-release.test.mjs`
* `scripts/build-pinned-innoextract.sh/` — 1 file(s)
  * `scripts/build-pinned-innoextract.sh`
* `scripts/release-workflow-order.test.mjs/` — 1 file(s)
  * `scripts/release-workflow-order.test.mjs`
* `tools/license-generator/` — 1 file(s)
  * `tools/license-generator/sea/smoke.mjs`

## 3. Only in PR #70 `022c0321`

* `docs/catalog/` — 16 file(s)
  * `docs/catalog/00-environment-and-requirements.md`
  * `docs/catalog/01-screen-index.csv`
  * `docs/catalog/02-screenshot-shotlist.csv`
  * `docs/catalog/03-catalog-outline.ar.md`
  * `docs/catalog/04-gaps-and-risks.md`
  * `docs/catalog/05-remaining-tests.md`
  * `docs/catalog/DELIVERABLES.ar.md`
  * `docs/catalog/IMAGE-PROVENANCE.ar.md`
* `backend/src/` — 12 file(s)
  * `backend/src/common/units/unit-math.spec.ts`
  * `backend/src/common/units/unit-math.ts`
  * `backend/src/modules/inventory/items.barcode.spec.ts`
  * `backend/src/modules/inventory/items.service.ts`
  * `backend/src/modules/licensing/license-proof.spec.ts`
  * `backend/src/modules/licensing/license-proof.ts`
  * `backend/src/modules/licensing/license.guard.spec.ts`
  * `backend/src/modules/licensing/license.guard.ts`
* `backend/prisma/` — 2 file(s)
  * `backend/prisma/migrations/20261030160000_preserve_verified_licence_proof/migration.sql`
  * `backend/prisma/schema.prisma`
* `docs/release/` — 2 file(s)
  * `docs/release/FINAL-RELEASE-FEATURE-MATRIX.md`
  * `docs/release/OFFLINE-LICENSING-REDESIGN-PLAN.md`
* `.github/workflows/` — 1 file(s)
  * `.github/workflows/windows-integrated-candidate.yml`
* `backend/scripts/` — 1 file(s)
  * `backend/scripts/verify-prisma-native-upgrade.mjs`
* `backend/test/` — 1 file(s)
  * `backend/test/units-91.integration.ts`
* `lib/features/` — 1 file(s)
  * `lib/features/invoicing/presentation/screens/invoice_editor_screen.dart`
* `scripts/license-build-policy.test.mjs/` — 1 file(s)
  * `scripts/license-build-policy.test.mjs`
* `scripts/verify-synthetic-inno-probe.mjs/` — 1 file(s)
  * `scripts/verify-synthetic-inno-probe.mjs`
* `scripts/verify-synthetic-inno-probe.test.mjs/` — 1 file(s)
  * `scripts/verify-synthetic-inno-probe.test.mjs`
* `scripts/windows-candidate-preflight.test.mjs/` — 1 file(s)
  * `scripts/windows-candidate-preflight.test.mjs`
* `scripts/windows-runtime-preflight.test.mjs/` — 1 file(s)
  * `scripts/windows-runtime-preflight.test.mjs`
* `test/widget/` — 1 file(s)
  * `test/widget/invoice_unit_selection_test.dart`

## 4. Migrations

* here: 0 migration-related paths
* PR #70: 1
  * `backend/prisma/migrations/20261030160000_preserve_verified_licence_proof/migration.sql`

## 5. Licensing and protection files

* here:
  * `backend/scripts/verify-licensing-postgres.mjs`
  * `backend/src/modules/licensing/installed-corrupt-state-safety.spec.ts`
  * `backend/src/modules/licensing/licence-backup-archive.spec.ts`
  * `backend/src/modules/licensing/licence-backup-archive.ts`
  * `backend/src/modules/licensing/license-store.spec.ts`
  * `backend/src/modules/licensing/license-store.ts`
  * `backend/src/modules/licensing/licensing-keyless-installation.spec.ts`
  * `backend/src/modules/licensing/licensing.controller.spec.ts`
  * `backend/src/modules/licensing/licensing.controller.ts`
  * `backend/src/modules/licensing/licensing.service.ts`
  * `backend/src/modules/licensing/machine-identity.spec.ts`
  * `docs/licensing/KEY-PROTECTION.md`
  * `docs/licensing/LICENCE-BACKUPS.md`
  * `docs/licensing/README.md`
  * `lib/features/licensing/presentation/screens/licence_screen.dart`
  * `lib/features/licensing/presentation/widgets/licence_gate.dart`
  * `tools/license-generator/sea/smoke.mjs`
* PR #70:
  * `backend/prisma/migrations/20261030160000_preserve_verified_licence_proof/migration.sql`
  * `backend/scripts/verify-licensing-postgres.mjs`
  * `backend/src/modules/licensing/license-proof.spec.ts`
  * `backend/src/modules/licensing/license-proof.ts`
  * `backend/src/modules/licensing/license-store.spec.ts`
  * `backend/src/modules/licensing/license-store.ts`
  * `backend/src/modules/licensing/license.guard.spec.ts`
  * `backend/src/modules/licensing/license.guard.ts`
  * `backend/src/modules/licensing/licensing.harness.ts`
  * `backend/src/modules/licensing/licensing.service.spec.ts`
  * `backend/src/modules/licensing/licensing.service.ts`
  * `docs/release/OFFLINE-LICENSING-REDESIGN-PLAN.md`
  * `lib/features/licensing/presentation/screens/licence_screen.dart`
  * `lib/features/licensing/presentation/widgets/licence_gate.dart`
  * `scripts/license-build-policy.test.mjs`

## 6. Prisma / migration / Windows packaging files

* here:
  * `backend/prisma.config.ts`
  * `backend/scripts/verify-licensing-postgres.mjs`
  * `distribution/windows/RepairTool.cs`
  * `distribution/windows/install-runtime.ps1`
  * `distribution/windows/repair-runtime.ps1`
* PR #70:
  * `backend/prisma/migrations/20261030160000_preserve_verified_licence_proof/migration.sql`
  * `backend/prisma/schema.prisma`
  * `backend/scripts/verify-licensing-postgres.mjs`
  * `backend/scripts/verify-prisma-native-upgrade.mjs`
  * `distribution/windows/install-runtime.ps1`

## 7. What must be preserved from each side

**This branch — keep, do not rebase away:**

* The Windows repair/runtime fixes (`install-runtime.ps1`, `repair-runtime.ps1`,
  `RepairTool.cs`, `smoke-test-installed-windows.ps1`) — these are the only ones
  proven by a green Windows run (`41091969076`) that installed, upgraded,
  repaired and restored a real installation.
* The offline licensing work with its backups and its restoration tests
  (`licence-backup-archive.*`, `installed-corrupt-state-safety.spec.ts`,
  `machine-identity.spec.ts`) — PR #70 does not contain these files at all.
* The Prisma native migration path added in this round
  (`prisma.config.ts`, `migrate-dev-safe.mjs`, `prisma-shadow-guard.mjs`,
  `prisma-native-migration-suite.mjs`, `prisma-catalog-types.mjs`).

**PR #70 — worth porting deliberately, not by merging:**

* `backend/prisma/migrations/20261030160000_preserve_verified_licence_proof/`
  — one additive, nullable column (`license_keys."signedKey"`). It sorts after
  every migration on this branch, so it can be replayed on top without touching
  history. Not ported here: it belongs to PR #70's licensing model, and applying
  a licensing migration without that model being present would create a column
  nothing writes.
* `backend/src/modules/licensing/license-proof.ts` (+ its spec) and
  `backend/test/units-91.integration.ts`.

**PR #70 — superseded, do not port:**

* its `backend/prisma.config.ts`: it selects the experimental JavaScript schema
  engine for **all** Prisma commands, which is why PR #70's own CI fails at
  "Apply migrations to ephemeral PostgreSQL". This branch's config replaces it.
* any `windows-*` workflow change that depends on that config.

A portable patch of the porting candidates is written next to this file as
`pr70-portable.patch`, so PR #70's work can be applied file by file instead of
being lost if that branch is later closed. It is **not** applied here.

## 8. Recommended path (no merge, no rebase)

1. Land this branch's Prisma/Windows work on its own merits (it is the branch
   with the green Windows run and the green database jobs).
2. Port `pr70-portable.patch` in a separate, reviewable commit, together with the
   licensing model it belongs to — never as an automated merge.
3. Close PR #70 only after that port, so its licensing work is not dropped.

Reproduce this report:

```bash
MB=$(git merge-base db57e3b 022c0321)
git diff --name-status $MB db57e3b   # this branch
git diff --name-status $MB 022c0321  # PR #70
```
