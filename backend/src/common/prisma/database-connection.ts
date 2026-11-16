import { readFileSync } from 'node:fs';

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


export interface PostgresPoolConfiguration {
  connectionString: string;
  ssl?: { ca: string; rejectUnauthorized: true };
}

function supabaseCaCertificate(env: ConnectionEnvironment): string {
  let certificate = env.SUPABASE_DB_CA_CERT?.trim() ?? '';
  if (!certificate && env.SUPABASE_DB_CA_CERT_FILE?.trim()) {
    try {
      certificate = readFileSync(env.SUPABASE_DB_CA_CERT_FILE.trim(), 'utf8').trim();
    } catch {
      throw new Error('Supabase CA certificate file could not be read.');
    }
  }
  if (!certificate) {
    throw new Error(
      'SUPABASE_DB_CA_CERT or SUPABASE_DB_CA_CERT_FILE is required for verified Supabase TLS.',
    );
  }
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(certificate)) {
    throw new Error('Supabase CA certificate must be PEM encoded.');
  }
  return certificate;
}

function verifiedPoolConfiguration(
  resolved: ResolvedDatabaseConnection,
  env: ConnectionEnvironment,
): PostgresPoolConfiguration {
  if (resolved.profile === 'local') return { connectionString: resolved.connectionString };

  const url = new URL(resolved.connectionString);
  // URL TLS options can override pg's explicit TLS configuration.
  for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    url.searchParams.delete(parameter);
  }
  return {
    connectionString: url.toString(),
    ssl: { ca: supabaseCaCertificate(env), rejectUnauthorized: true },
  };
}

export function resolveRuntimePgPoolConfig(
  env: ConnectionEnvironment = process.env,
): PostgresPoolConfiguration {
  return verifiedPoolConfiguration(resolveDatabaseConnection(env), env);
}

export function resolveMigrationPgPoolConfig(
  env: ConnectionEnvironment = process.env,
): PostgresPoolConfiguration {
  return verifiedPoolConfiguration(resolveMigrationDatabaseConnection(env), env);
}
