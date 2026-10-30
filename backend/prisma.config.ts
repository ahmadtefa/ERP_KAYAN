import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * The application client is engine-less and uses the JavaScript query compiler
 * with the pg driver adapter. Prisma 6.19's WASM schema engine currently fails
 * to deserialize PostgreSQL's internal `name` catalog type during
 * `migrate deploy`. For migration CI only, opt into the classic schema engine
 * (the CLI's supported native engine); the shipped application remains on the
 * engine-less runtime and offline Windows installs continue to use
 * scripts/apply-migrations.mjs.
 *
 * Set KAYAN_PRISMA_CLASSIC_MIGRATIONS=1 only for CI's real migrate-deploy
 * compatibility check. Do not set it for client generation or runtime.
 */
const classicMigrations =
  process.env.KAYAN_PRISMA_CLASSIC_MIGRATIONS === '1';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  engine: classicMigrations ? 'classic' : 'js',
  ...(classicMigrations
    ? {
        // A config file disables implicit env loading, and the classic schema
        // engine needs the datasource URL explicitly (the JS adapter path does
        // not use it for schema-engine connections).
        datasource: { url: process.env.DATABASE_URL ?? '' },
      }
    : {
        experimental: { adapter: true },
        adapter: async () => {
          const connectionString = process.env.DATABASE_URL;
          if (!connectionString) {
            throw new Error(
              'DATABASE_URL is required for database-touching Prisma commands.',
            );
          }
          return new PrismaPg({ connectionString });
        },
      }),
});
