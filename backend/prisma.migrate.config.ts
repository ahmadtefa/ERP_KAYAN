import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const profile = process.env.DATABASE_PROFILE?.trim().toLowerCase() || 'local';
const configuredUrl =
  profile === 'supabase'
    ? process.env.SUPABASE_MIGRATION_DATABASE_URL
    : process.env.DATABASE_URL;

if (!configuredUrl) {
  throw new Error(
    profile === 'supabase'
      ? 'SUPABASE_MIGRATION_DATABASE_URL is required for cloud migrations.'
      : 'DATABASE_URL is required for local migrations.',
  );
}

let datasourceUrl = configuredUrl;
if (profile === 'supabase') {
  const url = new URL(configuredUrl);
  // Prisma's classic PostgreSQL engine reads this CA path relative to
  // backend/prisma/. sslaccept=strict keeps certificate verification enabled.
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('sslaccept', 'strict');
  url.searchParams.set('sslrootcert', '../certs/supabase-prod-ca-2021.crt');
  datasourceUrl = url.toString();
} else if (profile !== 'local') {
  throw new Error("DATABASE_PROFILE must be either 'local' or 'supabase'.");
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  engine: 'classic',
  datasource: { url: datasourceUrl },
});
