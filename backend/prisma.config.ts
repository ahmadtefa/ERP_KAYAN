import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolveMigrationDatabaseConnection } from './src/common/prisma/database-connection';

const databaseProfile = process.env.DATABASE_PROFILE?.trim().toLowerCase() || 'local';
const schemaOnlyUrl = 'postgresql://127.0.0.1:1/kayan_schema_only?schema=public';
const configuredDatabaseUrl =
  databaseProfile === 'supabase'
    ? process.env.SUPABASE_MIGRATION_DATABASE_URL
    : process.env.DATABASE_URL;

// Prisma 6 resolves env("DATABASE_URL") from schema.prisma even for
// validate/generate. Use the selected CLI URL when present, otherwise a
// deliberately unreachable placeholder. Pure schema commands never open a
// connection and therefore need no secret.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = configuredDatabaseUrl ?? schemaOnlyUrl;
}

/**
 * The project uses Prisma 6.19 with the JavaScript schema engine and pg adapter.
 * Prisma CLI database commands use a distinct migration identity in cloud mode;
 * NestJS runtime code reads SUPABASE_DATABASE_URL instead. Local mode retains
 * the existing DATABASE_URL behavior for offline Windows installations.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: configuredDatabaseUrl ?? schemaOnlyUrl,
  },
  engine: 'js',
  experimental: {
    adapter: true,
  },
  adapter: async () => {
    if (databaseProfile === 'supabase') {
      const { connectionString } = resolveMigrationDatabaseConnection();
      return new PrismaPg({ connectionString });
    }
    if (!configuredDatabaseUrl) {
      throw new Error(
        'DATABASE_URL is required for database-touching Prisma commands.',
      );
    }
    return new PrismaPg({ connectionString: configuredDatabaseUrl });
  },
});
