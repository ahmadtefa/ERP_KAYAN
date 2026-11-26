# Per-company licensing: design for review

Status: DESIGN ONLY. Nothing here is implemented, no live data, key or protected-state file is touched, and no private key is read. The user approved the direction (reviewed 2026-11-26, WhatsApp): a company is created only through a vendor-issued, company-specific authorization, the activation tool is updated together with the program, and existing activations keep working. The protected-state migration below still needs review before code.

## 1. What exists today (verified in source)

* One licence per installation. `licenseRow()` and `licenseRowIn()` in `licensing.service.ts` read the oldest `license_installations` row (`findFirst`). Used by status, activation, seat reservation, clock handling, reconcile and summary.
* The protected state (`license-store.ts`) is one HMAC-authenticated file with one `licenseId` and installation-wide watermarks: `maxSeatLimit`, `maxSeatsUsed`, `licenseExpiresAt`, `perpetual`, `appliedKeys`, `clockState`, `clockSuspects`, `lastSeenAt`, `sequence`. `assertLicenseIdentity` refuses any row or key whose `licenseId` differs from it (`LICENSE_STATE_ID_MISMATCH`).
* Keys are `KYN1.<payload>.<ed25519 signature>`, payload `v:1`. A payload carries `licenseId`, `type` (ACTIVATION, RENEWAL, SEATS, TRANSFER), `machineId`, `term`, `seats`. No company field. Anything but `v:1` and prefix `KYN1` is refused unread.
* Full backups restore the database snapshot, then `reconcile()` repairs it from the protected state. Company backups exclude the licence tables.
* Existing guards already fail closed: a state file whose format is not 1 is refused with `UNREADABLE`, which the service reports as `LICENSE_STATE_DAMAGED`.

## 2. Target behaviour

1. Every company has its own licence: its own `licenseId`, activation, term and seat limit.
2. A company cannot be created without a vendor-issued key naming it. No customer role, including ADMIN, has a create-company path.
3. A key for company A cannot be applied to company B, including on first use.
4. The existing company and its existing v1 activation keep working unchanged.
5. Login is routed by username (usernames are globally unique today) with no company chooser.

## 3. Key format v2 (recommended)

* New prefix `KYN2` and payload `v:2`. A different prefix means an old verifier refuses the key as "not a KAYAN licence key" and never misreads it. `KYN1` keys stay valid.
* New key type `COMPANY_ACTIVATION`, plus a required `companyRef` field in every v2 key (`ACTIVATION`, `RENEWAL`, `SEATS`, `TRANSFER`, `COMPANY_ACTIVATION`).
* `companyRef` is an opaque id the vendor chooses when issuing the first key for that company. It carries no business data (no name, tax number or anything from the books).
* `COMPANY_ACTIVATION` creates the company and its licence in one atomic step on the machine named by `machineId`, with the key's term and seats. The customer's first administrator and company details are entered afterwards in the existing first-setup flow of that company.
* RENEWAL, SEATS and TRANSFER keys in v2 are accepted only for the company whose stored `companyRef` equals the key's `companyRef`.
* Replay: `keyId` stays unique per installation.
* v1 keys keep their meaning and bind to the existing company only (the one whose licence row was migrated, see 4).
* Request codes: `KYNREQ1` already carries the machine id and keeps working. No company data is needed in the request, because the vendor chooses `companyRef`.

What a signed company identity buys: a key issued for one company cannot be entered for another even on first use, the vendor's intent is enforced by signature, and the licence register shows which company each licence was sold to. Cost: verifier change, updates to the Node CLI and GUI, the Windows C# tool and the Android tool, new golden vectors in the shared compatibility tests, and an operator step to pick or record `companyRef`.

## 4. Database

* `license_installations` gets a nullable unique `companyRef` and a unique `companyId` link to `companies`. The existing row is backfilled to the single existing company with `companyRef` empty. v1 keys keep working through the `licenseId` match. A v2 key for that company (for example its next renewal) binds the vendor's `companyRef` once, and only when its `licenseId` equals the existing row; after that every v2 key must match it.
* `license_seat_usage` already has `licenseId`. Seat counts are per `licenseId`.
* Replace the singleton accessor with `licenseRowFor(companyId)`. The guard resolves the company from the authenticated user, never from a request parameter. The guard, `status`, seat reservation, clock handling and `reconcile` all take a company.
* Installation-level facts (machine id, enforcement mode, public key fingerprint, clock tamper state of the machine) stay installation-wide. Per-licence facts (expiry, seat limit, perpetual flag, seats used watermark) are per licence.
* Company creation consumes no seat of another company. Seats are reserved against the user's company licence.

## 4a. Protected state migration (DESIGN, needs review before code)

Today the file holds one `licenseId`. Proposed `v:2` state:

```
v: 2
installId, enforcement, publicKeyFingerprint, sequence,
lastSeenAt, clockState, clockSuspects      (installation-wide)
licenses: { [licenseId]: { maxSeatLimit, maxSeatsUsed, licenseExpiresAt, perpetual, appliedKeys } }
```

Migration rules:
1. Migration runs once, in a code path that only starts after a verified backup of the v1 file and its key file (`license-state.json.v1.bak`, same HMAC, never overwritten). The v1 file is never edited in place.
2. The v1 `licenseId` entry becomes the first `licenses` entry with the same watermarks. No watermark is lowered. `appliedKeys` is carried over in full.
3. Writes stay atomic (temp file then rename) with a higher `sequence`; the HMAC covers the whole v2 state with the same secret.
4. A v1 state with entitlement watermarks but no `licenseId` ("unbound") is not migrated; it keeps the existing refusal and goes to authorised recovery.
5. Rollback gate: an old binary reading a `v:2` file already refuses it (`state.v !== 1` gives `UNREADABLE`, reported as `LICENSE_STATE_DAMAGED`). The new build never writes v2 until the migration was confirmed, so a plain downgrade before any second company exists can restore the v1 backup. After a second licence exists, a downgrade stays locked as damaged (fail closed), not licensed under the first row. Recovery is the preserved v1 file plus an authorised procedure, not silent data loss. This needs a test against the real old store code, not an assumption.
6. Any mismatch between the database rows and the state entries (a row with no entry, an entry with no row, a company with two rows) stops with `LICENSE_STATE_ID_MISMATCH` and writes nothing.

## 4b. Migration crash consistency, recovery and downgrade (DESIGN, needs review)

The migration touches three things that cannot change in one transaction: the database (additive columns, link, marker), the protected state file, and its key file. The order and the recovery rules below make every interruption resolvable without losing a watermark or licensing the wrong company.

State words (written to a small `license-migration.json` journal beside the state, HMAC-protected with the same secret, plus a `license_migration` row in the database):

1. `PREPARED`: preconditions hold (state file readable and HMAC valid, key file present, exactly one licence row, exactly one company, no unbound watermarks). The v1 state file is copied byte for byte to `license-state.json.v1.bak` and the copy is verified by re-reading it and checking its HMAC inside the process. Nothing is printed. The key file is copied the same way (`state.key.v1.bak`, mode 0600); only SHA-256 digests of the two copies and the originals are logged, never contents.
2. `DB_READY`: the additive database step is committed (nullable `companyId`/`companyRef` columns, backfill of the single row to the single company, unique indexes, marker row). The old code still works against this schema because the legacy accessor reads the same oldest row and the state is still v1.
3. `STATE_WRITTEN`: the v2 state is written atomically (temp file, then rename) with a higher `sequence`. The v1 state is not edited.
4. `COMMITTED`: journal and marker are set to committed; the legacy file stays as the backup.

Recovery by observed state at start-up (each start inspects journal, database marker, state file version and the two backups):

* Journal absent, state v1, no marker: normal old behaviour; migration may start.
* `PREPARED` only, or `PREPARED` with the DB step half applied: the DB step is idempotent (add column if absent, backfill only when null, unique index if absent), so the start-up re-runs it. The state is still v1, so nothing can be mis-licensed. No watermark has changed.
* `DB_READY`, state still v1: re-run step 3. If the v1 file no longer matches its verified backup digest, stop and enter authorised recovery (do not overwrite either).
* State v2 written but journal not `COMMITTED` (crash between 3 and 4): verify the v2 HMAC and that its single entry equals the v1 backup's watermarks entry for entry (monotonic: each value greater or equal); if so, set `COMMITTED`; if not, stop in `LICENSE_STATE_DAMAGED` with both files preserved.
* State v2 but no backup or digest mismatch: refuse to run licence-dependent features (fail closed) and keep every file.
* Database marker says migrated but the state is v1: refuse. The new build never falls back to a v1 state once the marker is set, even if the v1 file is restored from the backup, because that could lower a watermark; it stays damaged until an authorised recovery reconciles the two.
* A restored database snapshot older than the marker: the full restore path re-runs `reconcile()`, which compares marker, rows and state; a snapshot without the marker or with fewer companies than the state entries is refused as a mismatch (nothing is dropped from the state).

Immutable binding: `companyRef` is write-once in the database (trigger-free: the service refuses an update, and a unique index prevents a second licence for the same company) and also stored in the matching protected-state entry. A restore, a replayed `keyId`, or a key for a different company cannot change either side; disagreement between the two stops with `LICENSE_STATE_ID_MISMATCH` and changes nothing. A restored company backup never contains the licence rows or links.

Legacy keys after migration: `KYN1` keys keep verifying and applying, but only to the licence row that existed at migration (matched by `licenseId`). A `KYN1` key whose `licenseId` is not an existing row is refused once a second company exists; creating a company needs `COMPANY_ACTIVATION` in `KYN2`. After a second company is activated, no code path reads the v1 file or the oldest row as an authority.

Downgrade: there is no down-migration and no data is dropped. The additive columns, rows and the v2 state remain. An old binary meets a v2 state and refuses it as damaged, so it licenses nothing and writes nothing; the second company's data stays in the database untouched. Returning to the new build restores service. Reverting to a v1 file by hand is only valid before a second company exists and only from the verified backup, as an authorised recovery.

Tests required for this section (integration, not reasoning): a crash injected after each step (kill between steps 1 to 4 in a real file and real PostgreSQL) and the start-up recovery result; digest check of the backups without any secret in logs; the actual old store and service code (checked out from the pre-change commit) pointed at the v2 state and at the migrated database: it must lock as `LICENSE_STATE_DAMAGED` and perform no write; restore of a pre-migration snapshot after a second company exists; replay of a spent `keyId` after migration; `KYN1` key refused for an unknown licence once a second company exists; companyRef write-once.

## 5. Restore

* Company backup: never carries or changes a licence link; restoring into a different company must not relink anything.
* Full backup: the snapshot's licence rows and links return as of the file date, then `reconcile()` applies the per-licence watermarks. A restored company-to-licence link that disagrees with the protected state is refused. On another machine the rows carry another `machineId`, so no licence works until each company is re-activated.

## 6. Tests required before any claim

Product (real PostgreSQL in CI): key for licence X works for company A and is refused for B; second company cannot start without a `COMPANY_ACTIVATION` key; key replay refused; A expired or suspended does not stop B; seat limits per company; renewals and seat keys touch only their company; v1 keys still bind to the existing company only; existing single-company install behaves identically after migration; username routing; no role can create a company (API, not only UI); restore cases above; state migration keeps every watermark; the old store code refuses the v2 file; downgrade after migration but before a second company restores the v1 backup.
Generators: shared golden vectors for KYN2 across the product verifier, Node CLI, Windows C# tool and Android tool; v1 vectors unchanged; the register keeps `companyRef`.

## 7. Not done and not claimed

No key was issued, no private key read, no installed tool inspected, no signing performed, no live licence or state file touched. Compatibility with the user's already installed licence tool and register is unverified until that tool or its output is available. The generators in this repository are the source of truth for what is qualified.
