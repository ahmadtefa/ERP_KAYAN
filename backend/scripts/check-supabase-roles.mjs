import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const runtimeUrl = process.env.SUPABASE_DATABASE_URL;
const migrationUrl = process.env.SUPABASE_MIGRATION_DATABASE_URL;
const forbiddenRoles = new Set([
  'postgres', 'service_role', 'supabase_admin', 'authenticator', 'authenticated', 'anon',
]);

export function parseAndValidate(name, value, kind) {
  if (!value) throw new Error(name + ' GitHub Secret is missing.');
  let url;
  try { url = new URL(value); } catch { throw new Error(name + ' is not a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(name + ' must use PostgreSQL.');
  if (!['require', 'verify-ca', 'verify-full'].includes((url.searchParams.get('sslmode') || '').toLowerCase())) {
    throw new Error(name + ' must include sslmode=require, verify-ca, or verify-full.');
  }
  const host = url.hostname.toLowerCase();
  const pooler = host.endsWith('.pooler.supabase.com');
  const direct = /^db\.[a-z0-9-]+\.supabase\.co$/.test(host);
  if (url.port && url.port !== '5432') throw new Error(name + ' must use port 5432 session mode.');
  if (kind === 'runtime' && !pooler) throw new Error('Runtime URL must use the Supabase session pooler.');
  if (kind === 'migration' && !pooler && !direct) throw new Error('Migration URL must use the Supabase direct endpoint or session pooler.');
  let username;
  try { username = decodeURIComponent(url.username); } catch { throw new Error(name + ' has an invalid username.'); }
  const role = username.split('.')[0].toLowerCase();
  if (!role || forbiddenRoles.has(role)) throw new Error(name + ' must use a dedicated least-privilege role.');
  if (pooler && !username.includes('.')) throw new Error(name + ' pooler username must include the project reference.');
  return { role, connectionString: value };
}

function readCaCertificate(env = process.env) {
  let certificate = env.SUPABASE_DB_CA_CERT?.trim() || '';
  if (!certificate && env.SUPABASE_DB_CA_CERT_FILE) {
    try { certificate = readFileSync(env.SUPABASE_DB_CA_CERT_FILE, 'utf8').trim(); }
    catch { throw new Error('Supabase CA certificate file could not be read.'); }
  }
  if (!certificate) {
    throw new Error('SUPABASE_DB_CA_CERT GitHub Secret is missing; provide the PEM CA certificate from Supabase Database Settings.');
  }
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(certificate)) {
    throw new Error('SUPABASE_DB_CA_CERT must contain a PEM encoded certificate.');
  }
  return certificate;
}

export function secureClientOptions(connectionString, env = process.env) {
  const url = new URL(connectionString);
  for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    url.searchParams.delete(parameter);
  }
  return {
    connectionString: url.toString(),
    ssl: { ca: readCaCertificate(env), rejectUnauthorized: true },
  };
}

function errorCode(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

async function inspect(label, connectionString) {
  const client = new Client(secureClientOptions(connectionString));
  try {
    await client.connect();
    const result = await client.query([
      "SELECT current_user AS role, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,",
      "has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,",
      "has_schema_privilege(current_user, 'public', 'CREATE') AS public_create",
      "FROM pg_roles r WHERE r.rolname = current_user",
    ].join(' '));
    if (result.rowCount !== 1) throw new Error('Could not inspect connected PostgreSQL role.');
    const role = result.rows[0];
    if (role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole) {
      throw new Error(label + ' role has superuser, RLS bypass, CREATEDB, or CREATEROLE privileges.');
    }
    if (!role.public_usage) throw new Error(label + ' role lacks USAGE on public schema.');
    if (label === 'runtime' && role.public_create) throw new Error('Runtime role must not have CREATE on public schema.');
    if (label === 'migration' && !role.public_create) throw new Error('Migration role needs CREATE on public schema.');

    const protections = await client.query([
      "SELECT count(*)::int AS table_count,",
      "count(*) FILTER (WHERE NOT c.relrowsecurity)::int AS rls_disabled,",
      "count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname))::int AS no_policy,",
      "count(*) FILTER (WHERE",
      "has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT') OR",
      "has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE') OR",
      "has_table_privilege('authenticated', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'INSERT') OR",
      "has_table_privilege('authenticated', c.oid, 'UPDATE') OR has_table_privilege('authenticated', c.oid, 'DELETE'))::int AS data_api_grants",
      "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace",
      "WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations'",
    ].join(' '));
    const state = protections.rows[0];
    if (state.rls_disabled > 0) throw new Error(label + ': ' + state.rls_disabled + ' public tables have RLS disabled.');
    if (state.no_policy > 0) throw new Error(label + ': ' + state.no_policy + ' public tables have no RLS policy.');
    if (state.data_api_grants > 0) throw new Error('anon/authenticated have table privileges; this would expose tables to the Data API.');
    return { role: role.role, tableCount: state.table_count };
  } catch (error) {
    const code = errorCode(error);
    const tlsMessage = error instanceof Error ? error.message : '';
    const tlsFailure = /self.signed certificate|unable to verify.*certificate|certificate chain/i.test(tlsMessage);
    if (tlsFailure || /SELF_SIGNED_CERT|CERT_SIGNATURE_FAILURE|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|ERR_TLS_CERT_ALTNAME_INVALID|CERT_HAS_EXPIRED/.test(code)) {
      throw new Error(label + ' TLS certificate verification failed; set SUPABASE_DB_CA_CERT to the CA certificate from Supabase Database Settings.');
    }
    if (error instanceof Error && !/password|connection string|postgresql:\/\//i.test(error.message)) throw error;
    throw new Error(label + ' connection or credential check failed; details withheld.');
  } finally {
    await client.end().catch(() => {});
  }
}

export async function main() {
  const runtime = parseAndValidate('SUPABASE_DATABASE_URL', runtimeUrl, 'runtime');
  const migration = parseAndValidate('SUPABASE_MIGRATION_DATABASE_URL', migrationUrl, 'migration');
  if (runtime.role === migration.role) throw new Error('Runtime and migration secrets must authenticate as different database roles.');
  const runtimeState = await inspect('runtime', runtime.connectionString);
  const migrationState = await inspect('migration', migration.connectionString);
  console.log('PASS: verified distinct least-privilege Supabase roles; runtime=' + runtimeState.role +
    '; migration=' + migrationState.role + '; public tables=' + runtimeState.tableCount +
    '. No schema changes were applied.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Supabase role preflight failed; details withheld.');
    process.exitCode = 1;
  });
}
