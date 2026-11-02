import { defineConfig } from 'prisma/config';

/**
 * Prisma configuration for KAYAN ERP.
 *
 * Two separate choices live here, and they are deliberately not the same one:
 *
 *  * The **migration path** is Prisma 6's classic (native) schema engine. It is
 *    the supported engine for `migrate deploy`, it replays exactly the SQL in
 *    `prisma/migrations`, and it is the engine the shipped installer and the
 *    CI database jobs must prove. It is not switchable: no environment variable
 *    can select a different schema engine, because a release must not be able to
 *    migrate customer databases with an engine that was never the tested one.
 *
 *  * The **client runtime** is engine-less (`engineType = "client"` in
 *    `prisma/schema.prisma`) and talks to PostgreSQL through
 *    `@prisma/adapter-pg`. That is a query-time choice only, it is wired in
 *    `src/common/prisma/prisma.service.ts`, and it is not selected here: a config
 *    file that loaded the adapter would also let the CLI's experimental
 *    JavaScript schema engine drive migrations, which is exactly what must not
 *    happen in production.
 *
 * Shadow databases (used only by `migrate dev` / `migrate diff`) are never taken
 * from `DATABASE_URL` and never enabled by a URL on its own. Two variables are
 * required: `KAYAN_PRISMA_SHADOW_DATABASE_URL`, and `KAYAN_PRISMA_SHADOW_VERIFIED=1`
 * which only `scripts/migrate-dev-safe.mjs` sets, after it has proven - by URL
 * and by DNS resolution - that the shadow is a different PostgreSQL server. A
 * stray variable therefore cannot point schema work at the company database.
 */
const databaseUrl = process.env.DATABASE_URL ?? '';
const shadowDatabaseUrl = process.env.KAYAN_PRISMA_SHADOW_DATABASE_URL ?? '';
const shadowVerified = process.env.KAYAN_PRISMA_SHADOW_VERIFIED === '1';

if (shadowDatabaseUrl && !shadowVerified) {
  throw new Error(
    'KAYAN_PRISMA_SHADOW_DATABASE_URL is set but the shadow database has not been verified as a separate server. ' +
      'Run migrations through `npm run prisma:migrate` (scripts/migrate-dev-safe.mjs), which performs the safety checks. ' +
      'A URL on its own is not proof that shadow schema work cannot reach the company database.',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  engine: 'classic',
  // A config file disables Prisma's implicit .env loading, so the URL is passed
  // explicitly when there is one. It is deliberately NOT replaced with a
  // placeholder when DATABASE_URL is absent: `generate` and `validate` are
  // schema-only commands and must keep working without a database, while any
  // command that tries to connect with no URL fails with Prisma's own "missing
  // environment variable" instead of dialling a fake server.
  ...(databaseUrl
    ? {
        datasource: {
          url: databaseUrl,
          ...(shadowDatabaseUrl && shadowVerified
            ? { shadowDatabaseUrl }
            : {}),
        },
      }
    : {}),
});
