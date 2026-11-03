/**
 * Translate the application's PostgreSQL URL to libpq environment variables.
 * Secrets stay out of the command line. Do not silently drop a URL option: a
 * backup or restore must never fall back to a weaker connection than the app.
 */
export function pgBackupConnectionEnv(
  raw: string,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('The backup database URL must use PostgreSQL.');
  }
  const allowed = new Set([
    'schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'statement_cache_size',
    'host', 'port', 'user', 'password', 'ssl', 'sslmode', 'sslrootcert', 'sslcert',
    'sslkey', 'sslnegotiation', 'connect_timeout', 'application_name',
  ]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length > 1) {
      throw new Error('The backup database URL contains an unsupported or duplicate option.');
    }
  }
  const option = (key: string) => url.searchParams.get(key) || undefined;
  const sslMode = option('sslmode');
  const ssl = option('ssl');
  const negotiation = option('sslnegotiation');
  if (negotiation && negotiation !== 'postgres') {
    throw new Error('The database SSL negotiation mode is unsupported for backup tools.');
  }
  if (ssl && !['true', '1', '0'].includes(ssl)) {
    throw new Error('The database SSL option is unsupported for backup tools.');
  }
  if (sslMode && !['disable', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error('The database SSL mode is unsupported for backup tools.');
  }
  // node-postgres defaults to certificate and hostname verification for
  // prefer/require/verify-ca unless libpq compatibility is explicitly enabled.
  // libpq's names are weaker, so enforce verify-full rather than downgrade.
  const urlTlsOptions = Boolean(sslMode || ssl || option('sslrootcert') || option('sslcert') || option('sslkey'));
  const inheritedMode = urlTlsOptions ? undefined : inherited.PGSSLMODE;
  if (inheritedMode && !['disable', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(inheritedMode)) {
    throw new Error('The inherited database SSL mode is unsupported for backup tools.');
  }
  if (inherited.PGSSLNEGOTIATION && inherited.PGSSLNEGOTIATION !== 'postgres' && !negotiation) {
    throw new Error('The inherited database SSL negotiation mode is unsupported for backup tools.');
  }
  const sslRequested = sslMode && sslMode !== 'disable' ||
    ssl === 'true' || ssl === '1' || Boolean(option('sslrootcert') || option('sslcert') || option('sslkey')) ||
    Boolean(inheritedMode && inheritedMode !== 'disable');
  if (sslMode === 'disable' && sslRequested) {
    throw new Error('The database URL contains conflicting SSL options.');
  }
  const env: NodeJS.ProcessEnv = {
    PGHOST: option('host') || decodeURIComponent(url.hostname.replace(/^\[(.*)\]$/, '$1')) || inherited.PGHOST || 'localhost',
    PGPORT: option('port') || url.port || inherited.PGPORT || '5432',
    PGUSER: option('user') || decodeURIComponent(url.username) || inherited.PGUSER || inherited.USER,
    PGPASSWORD: option('password') || decodeURIComponent(url.password) || inherited.PGPASSWORD,
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
  if (sslRequested) env.PGSSLMODE = 'verify-full';
  else if (sslMode === 'disable' || ssl === '0' || inheritedMode === 'disable') env.PGSSLMODE = 'disable';
  for (const [key, variable] of [
    ['sslrootcert', 'PGSSLROOTCERT'], ['sslcert', 'PGSSLCERT'], ['sslkey', 'PGSSLKEY'],
    ['connect_timeout', 'PGCONNECT_TIMEOUT'], ['application_name', 'PGAPPNAME'],
  ] as const) {
    const value = option(key);
    if (value) env[variable] = value;
  }
  return env;
}
