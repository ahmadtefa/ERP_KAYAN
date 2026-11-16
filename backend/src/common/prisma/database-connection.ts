export type DatabaseProfile = 'local' | 'supabase';

export interface ResolvedDatabaseConnection {
  profile: DatabaseProfile;
  connectionString: string;
}

type ConnectionEnvironment = Record<string, string | undefined>;

const forbiddenRoles = new Set([
  'postgres',
  'service_role',
  'supabase_admin',
  'authenticator',
  'authenticated',
  'anon',
]);

function requiredValue(env: ConnectionEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the selected database profile.`);
  return value;
}

function profileFrom(env: ConnectionEnvironment): DatabaseProfile {
  const profile = env.DATABASE_PROFILE?.trim().toLowerCase() || 'local';
  if (profile !== 'local' && profile !== 'supabase') {
    throw new Error("DATABASE_PROFILE must be either 'local' or 'supabase'.");
  }
  return profile;
}

function validateCloudUrl(
  connectionString: string,
  purpose: 'runtime' | 'migration',
): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Supabase connection URL is invalid.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('Supabase connection URL must use PostgreSQL.');
  }

  const sslmode = url.searchParams.get('sslmode')?.toLowerCase();
  if (!sslmode || !['require', 'verify-ca', 'verify-full'].includes(sslmode)) {
    throw new Error('Supabase connections require sslmode=require, verify-ca, or verify-full.');
  }

  let username: string;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    throw new Error('Supabase connection URL has an invalid role name.');
  }
  const role = username.split('.')[0].toLowerCase();
  if (!role || forbiddenRoles.has(role)) {
    throw new Error('Supabase connections must use a dedicated non-privileged Supabase role.');
  }

  const host = url.hostname.toLowerCase();
  const isPooler = host.endsWith('.pooler.supabase.com');
  const isDirect = /^db\.[a-z0-9-]+\.supabase\.co$/.test(host);
  const port = url.port || '5432';

  if (port !== '5432') {
    throw new Error('Supabase Prisma connections must use port 5432; transaction pooling is not supported here.');
  }
  if (purpose === 'runtime' && !isPooler) {
    throw new Error('The persistent NestJS runtime must use the Supabase session pooler on port 5432.');
  }
  if (purpose === 'migration' && !isPooler && !isDirect) {
    throw new Error('The migration connection must use the Supabase direct endpoint or session pooler on port 5432.');
  }
  if (isPooler && !username.includes('.')) {
    throw new Error('Supavisor usernames must include the database role and project reference.');
  }
}

export function resolveDatabaseConnection(
  env: ConnectionEnvironment = process.env,
): ResolvedDatabaseConnection {
  const profile = profileFrom(env);
  if (profile === 'local') {
    return {
      profile,
      connectionString: requiredValue(env, 'DATABASE_URL'),
    };
  }

  const connectionString = requiredValue(env, 'SUPABASE_DATABASE_URL');
  validateCloudUrl(connectionString, 'runtime');
  return { profile, connectionString };
}

export function resolveMigrationDatabaseConnection(
  env: ConnectionEnvironment = process.env,
): ResolvedDatabaseConnection {
  const profile = profileFrom(env);
  if (profile === 'local') {
    return {
      profile,
      connectionString: requiredValue(env, 'DATABASE_URL'),
    };
  }

  const connectionString = requiredValue(env, 'SUPABASE_MIGRATION_DATABASE_URL');
  validateCloudUrl(connectionString, 'migration');
  return { profile, connectionString };
}
