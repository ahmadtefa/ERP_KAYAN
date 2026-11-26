# Per-company licensing: design for review

Status: DESIGN, revision 2 (after engineering review). Prototype tests are isolated and not enabled in the product. Nothing here is implemented, no live data, key or protected-state file is touched, and no private key is read. The user approved the direction (reviewed 2026-11-26, WhatsApp): a company is created only through a vendor-issued, company-specific authorization, the activation tool is updated together with the program, and existing activations keep working. The protected-state migration below still needs review before code.

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

## 4a. Protected state v2 (DESIGN, revision 2)

```
v: 2
installId, enforcement, publicKeyFingerprint, sequence      (installation-wide)
lastSeenAt, clockState, clockSuspects                       (installation-wide, see 4c)
legacyLicenseId                                             (the v1 identity, immutable)
licenses: { [licenseId]: {
   companyId, companyRef|null, origin: "LEGACY"|"V2",
   maxSeatLimit, maxSeatsUsed, licenseExpiresAt, perpetual,
   appliedKeys[], suspended (per licence) } }
```
`companyId` and `legacyLicenseId` are write-once. `companyRef` is write-once once set (null only for the migrated legacy entry until its first v2 key binds it). The database row carries the same three values; any disagreement between row and entry stops with `LICENSE_STATE_ID_MISMATCH` and writes nothing.

## 4b. Migration state machine, locking and durability (DESIGN, revision 2)

Two different things were mixed before. They are now separate:

* Schema-ready (`prepared`): additive, idempotent, reversible by simply ignoring it. It never changes what any binary does. It is not authoritative.
* Authoritative marker (`committed`): a single row in the database written in the same transaction that records the digest and `sequence` of the verified v2 state. Only this row makes v2 the sole authority.

Precedence at every start, evaluated in this order, first match wins:
1. Marker `committed`: v2 state is the only authority. v1 files are never read for licensing. If the v2 state is missing, corrupt, or its digest/sequence differs from the marker: `LICENSE_STATE_DAMAGED`, fail closed, nothing written, no regeneration.
2. Marker absent, v2 state file present: a migration was interrupted after the write. Verify (exact rules in 4b-validate); if valid, commit the marker; if not, `LICENSE_STATE_DAMAGED`, both files preserved.
3. Marker absent, journal says `prepared`/`schema-ready`, state v1: resume at the next idempotent step.
4. Nothing: legacy behaviour, migration may start.

Exclusion: the migration takes (a) a PostgreSQL advisory lock for the whole run, and (b) an exclusive lock file `license-migration.lock` beside the state (O_EXCL, holds pid and start time, stale only when the pid is gone and an operator or the run's own recovery clears it). The v1 loader cannot learn new fields, so the migration requires the application to be stopped. This is enforced: the running service holds a PostgreSQL advisory lock for as long as it is up, and the migration aborts if it cannot take that lock. Old and new processes therefore cannot both write v1 after the backup.

Durability: write the temp file, `fsync` the file, rename, then `fsync` the directory; same for the backups and journal. Atomic rename alone is not relied on. A crash test must kill between each of these calls.

Steps: A prepare (preconditions, lock, verified backups with digests only, journal `prepared`); B schema (additive, idempotent); C write v2 temp, fsync, rename, fsync dir; D one transaction that sets the marker with the v2 digest and sequence; E journal `committed`. v1 files are never edited and are kept.

### 4b-validate: exact preservation, not just numeric watermarks
The v2 state is accepted only if, against the verified v1 backup: `legacyLicenseId` equals the v1 `licenseId`; the single entry has the same `appliedKeys` as a set with identical keyIds and order; each numeric watermark is greater or equal; `licenseExpiresAt` and `perpetual` are identical unless a later applied key explains the change; `installId`, `publicKeyFingerprint` equal; `sequence` is greater. Anything else stops.

Disagreements and missing files (no regeneration, no overwrite, ever):
* State sequence lower than the marker's sequence, or journal and marker disagree: treat the higher authority (marker) as truth, refuse the lower, stop `LICENSE_STATE_DAMAGED`, preserve both.
* `state.key` missing or unreadable with a v2 state, or HMAC fails: damaged. Never create a new key, never re-sign. Recovery is the key's own backup under an authorised procedure; the migration backup digests allow checking that the right copy was returned.
* Backups missing or digest mismatch at any step before `committed`: abort, change nothing further.

## 4c. Clock and suspension scope
* Installation-wide (a property of the machine): `clockState`, `clockSuspects`, `lastSeenAt`, the clock-tamper lock. A detected rollback affects every company: all licensed writes refuse with the clock message until the shared clock is repaired through the existing recovery. Expected and tested.
* Per licence: expiry, perpetual, seats, `suspended`. One company's expiry or suspension blocks only that company; the others continue, and a restored read-only expired state follows the existing per-licence rules.
* A company's expiry never advances or relaxes the shared clock watermark; the shared clock never extends a company term.

## 4d. Honest boundary of `companyRef`
`companyRef` is chosen by the vendor and signed in the key. It proves the vendor authorised one more logical company on that machine. It does not prove which real-world company or name was intended, because there is no signed customer request binding a name. The design does not claim otherwise. What it does guarantee: one key creates exactly one company, once; its binding cannot be swapped afterwards; a key for another companyRef cannot be applied to it. If the vendor needs the name bound, an optional signed `displayLabel` in the key (vendor-typed) is shown in the activation screen and stored with the binding, and the operator guide says the vendor must check it against the customer.
Company setup: the `COMPANY_ACTIVATION` key creates the company in state `AWAITING_FIRST_ADMIN` and that state is created once. First-admin provisioning is allowed only in that state, only inside the same activation session and only by presenting the same activation key id (single use, consumed on success). After success the state moves to `ACTIVE` and the endpoint refuses forever; it is not a reusable unauthenticated door. A restore or key replay cannot reopen it. Test: second attempt, replay, and restore all refused.

## 4e. Legacy keys, downgrade and recovery claims
* Consistent from migration (one company too): a `KYN1` key is accepted only when its `licenseId` equals `legacyLicenseId`, and only for the legacy company. Unknown licence ids are refused from the first start after the commit.
* Manual v1 rollback is not advertised as safe once the v2 state has accrued anything the v1 file lacks: a newer applied key, a spent keyId, a higher watermark, or any second licence. Even with one company, restoring the v1 file would drop a spent key. Only the exact pre-migration state (v2 sequence equals the committed sequence and no applied key added) may be restored, by an authorised recovery, from the verified backup.
* Downgrade: no down-migration, no data dropped. Old binaries must be tested for real: the pre-change code is run (startup, status, activation, seat reservation, a write path, reconcile) against the v2 state and the migrated database. Expected: `LICENSE_STATE_DAMAGED`, licensed writes refused, no write to the state or licence tables. This is an integration test; the parser test alone is not claimed as proof.

## 5. Restore

* Company backup: never carries or changes a licence link; restoring into a different company must not relink anything.
* Full backup: the snapshot's licence rows and links return as of the file date, then `reconcile()` applies the per-licence watermarks. A restored company-to-licence link that disagrees with the protected state is refused. On another machine the rows carry another `machineId`, so no licence works until each company is re-activated.

## 6. Tests required before any claim

Product (real PostgreSQL in CI): key for licence X works for company A and is refused for B; second company cannot start without a `COMPANY_ACTIVATION` key; key replay refused; A expired or suspended does not stop B; seat limits per company; renewals and seat keys touch only their company; v1 keys still bind to the existing company only; existing single-company install behaves identically after migration; username routing; no role can create a company (API, not only UI); restore cases above; state migration keeps every watermark; the old store code refuses the v2 file; downgrade after migration but before a second company restores the v1 backup.
Generators: shared golden vectors for KYN2 across the product verifier, Node CLI, Windows C# tool and Android tool; v1 vectors unchanged; the register keeps `companyRef`.

## 7. Not done and not claimed

No key was issued, no private key read, no installed tool inspected, no signing performed, no live licence or state file touched. Compatibility with the user's already installed licence tool and register is unverified until that tool or its output is available. The generators in this repository are the source of truth for what is qualified.
