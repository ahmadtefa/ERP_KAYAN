# Prisma migration notes (KAYAN ERP)

This file records how Prisma is wired in this repository, what has actually been
proven, and what has not. It exists because the migration path was changed
several times while chasing a failure, and each change looked plausible in
review.

## The architecture that is now enforced

| Concern | Choice | Where |
| --- | --- | --- |
| Applying migrations (production, installer, CI) | **Prisma 6 classic / native schema engine** | `prisma.config.ts` (`engine: 'classic'`) |
| Query-time client | **Engine-less client** (`engineType = "client"`) with `@prisma/adapter-pg` (Prisma adapter **6**) | `prisma/schema.prisma`, `src/common/prisma/prisma.service.ts` |
| Prisma adapter 7 / driver adapters for migrations | **Not used.** Not in the production path at all | — |
| Shadow database (only `migrate dev` / `migrate diff`) | **Guarded**: explicit variable + a proof that it is a different *server* | `scripts/prisma-shadow-guard.mjs`, `scripts/migrate-dev-safe.mjs` |
| Desktop / installer migration | `scripts/migrate-deploy.mjs` → `prisma migrate deploy` (same engine) | `scripts/prepare-database.mjs` |

Versions (from `package-lock.json`): `prisma`, `@prisma/client`, `@prisma/engines`,
`@prisma/config` are all **6.19.3**; `@prisma/adapter-pg` **6.19.3**.
`@prisma/adapter-pg` majors track `@prisma/client` majors; adapter 7 is a
different major and is not installed here.

### Why the experimental engine is banned, not merely discouraged

Prisma 6.19 ships an unstable **JavaScript (WASM) schema engine**
(`engine: 'js'` + `experimental.adapter`). It was used in this repository for a
while because it needs no binary download, and `migrate deploy` then failed with
`Failed to deserialize column of type 'name'` — PostgreSQL's own catalog type
(OID 19). Two things follow from that, and both are now enforced by tests:

* The failure belongs to the **experimental engine**, not to Prisma Client and
  not to the migration *files*. The classic engine applies the entire history
  (see below). So the customer-facing product was never blocked by it.
* Casting `name`/`char` catalog columns to `text` would have "fixed" nothing:
  those columns are inside PostgreSQL, not in our schema. A test now fails if any
  migration introduces such a cast (`prisma-architecture.test.mjs`).

## Shadow databases

`migrate dev` and `migrate diff` need a database the engine can create, write to
and **drop**. On a customer machine that is unacceptable, so:

* `KAYAN_PRISMA_SHADOW_DATABASE_URL` alone does nothing. `prisma.config.ts`
  throws unless `KAYAN_PRISMA_SHADOW_VERIFIED=1`, and only
  `scripts/migrate-dev-safe.mjs` sets that — after it has proven the shadow is a
  **separate server**.
* Refused, with a stable code: missing shadow; shadow equal to `DATABASE_URL`;
  the same server with a different database name; the same server and database
  with only `?schema=` changed; a different hostname that resolves to the live
  server's address; an unresolvable host.
* `npm run prisma:migrate` is the only route to `migrate dev`. The architecture
  test fails if any script calls `prisma migrate dev` or `prisma db push`
  directly.
* `migrate deploy` never uses a shadow, so production is unaffected by any of
  this.

**Status:** `migrate dev` is supported *only* with a verified separate server.
Where that cannot be proven, it stays disabled by design — it is not silently
allowed.

## OID 18 (`char`) and OID 19 (`name`)

`scripts/prisma-catalog-types.mjs` reads, through the **shipped client**
(engine-less client + `@prisma/adapter-pg`):

* `pg_class.relname`, `pg_attribute.attname`, `pg_type.typname` — OID 19;
* `pg_attribute.attstorage`, `pg_attribute.attidentity` — OID 18;
* `NULL::"char"` and `NULL::name` — the null cases;
* the `name` boundary: 63 characters survive, 70 are truncated by the server;
* a real 63-character table name created and read back;
* `DECIMAL(19,4)` money, to show the same path keeps exact numerics.

The migration history also proves the *engine* side: two checked-in migrations
query `pg_type.typname` (an OID 19 column) inside `DO` blocks, and the classic
engine applies them on every fresh install.

**Conclusion:** the OID 18/19 defect affects the experimental JavaScript schema
engine. It does not affect the shipped client, and it does not affect the native
migration path. No type was changed or cast to hide it.

## What is proven, where

| Proof | Script | Runtime |
| --- | --- | --- |
| Fresh database, all migrations, history and checksums | `prisma-native-migration-suite.mjs` phases 1–2 | GitHub Actions, real PostgreSQL + real engine |
| `migrate deploy` twice is a no-op | phase 3 | same |
| Broken migration rolls back atomically and blocks the next run; `resolve --rolled-back` then succeeds | phase 4 | same |
| Populated database (older schema + business rows) upgrades with data, statuses and checksums intact | phase 5 | same |
| No orphaned rows after upgrade | phase 6 | same |
| OID 18/19 through the client | `prisma-catalog-types.mjs` | same |
| Shadow isolation against two servers | `prisma-shadow-isolation.mjs` | same |
| Guard logic (URL/DNS rules) | `prisma-shadow-guard.test.mjs` | anywhere, no database |
| Architecture invariants | `prisma-architecture.test.mjs` | anywhere, no database |

Workflow: `.github/workflows/prisma-native-migrations.yml`.

## Known limits

* The classic engine binary is downloaded from `binaries.prisma.sh` at
  `npm install` time. A sandbox that blocks that host cannot run *any* Prisma
  command that needs an engine (even `prisma validate`), so those proofs must run
  in CI or on the Windows builder. This is a limitation of the environment, not
  of the configuration.
* `migrate dev` is not used to author migrations on this project's shared
  database; new migrations are written as reviewed SQL files.
* The installer ships `prisma.config.ts`, the schema, every migration and the
  schema engine; `scripts/smoke-test-installed-windows.ps1` verifies all four
  inside the installed package and runs the installed CLI's engine report.
