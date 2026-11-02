// Shadow-database safety for Prisma's native (classic) schema engine.
//
// A shadow database is a scratch database the schema engine creates, writes to
// and drops in order to replay migrations before it computes a new one. That is
// only ever acceptable on a throwaway server. If the shadow URL ever points at
// the machine that holds a company's data, the engine has been handed a
// database it may create and DROP in - so every check here fails closed, and a
// URL that cannot be *proven* separate is refused rather than trusted.
//
// Configuration is not proof. Two URLs that are merely spelled differently are
// still one server:
//
//   postgres://u:p@db.example.com:5432/app
//   postgres://u:p@DB.EXAMPLE.COM/app            (default port, upper case)
//   postgres://u:p@localhost:5432/postgres       (a different database name)
//   postgres://u:p@localhost:5432/app?schema=shadow   (a different schema)
//   postgres://u:p@127.0.0.1:5432/app            (a different spelling again)
//   postgres://u:p@[::1]:5432/app
//
// The last four are the interesting ones: they are not the same database, so a
// naive string comparison accepts them, and a shadow run in any of them can
// still destroy the company database (DROP DATABASE, CREATE SCHEMA, or simply
// writing the shadow schema into the live database). They are refused here by
// server identity - host plus port - not by database name.
//
// "Same server" is not decided by hostname alone either. Different names can
// resolve to the same machine, so the runtime check also resolves both hosts
// and refuses when their addresses intersect on the same port.

import { lookup } from 'node:dns/promises';

/** Every reason a shadow configuration is refused, with a stable code. */
export const SHADOW_REFUSAL = Object.freeze({
  MISSING: 'shadow-not-configured',
  UNPARSEABLE: 'shadow-url-unparseable',
  NOT_POSTGRES: 'shadow-not-postgresql',
  SAME_URL: 'shadow-equals-database-url',
  SAME_SERVER: 'shadow-shares-server-with-database',
  SAME_HOST_PORT: 'shadow-shares-host-and-port-with-database',
  SAME_ADDRESS: 'shadow-resolves-to-the-database-server',
  UNRESOLVABLE: 'shadow-host-unresolvable',
});

export class ShadowDatabaseRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ShadowDatabaseRefused';
    this.code = code;
  }
}

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

/**
 * Parses a PostgreSQL URL into the parts that decide *which server* it is.
 *
 * Deliberately strict: an unparseable or non-PostgreSQL URL is refused rather
 * than guessed at, because guessing here means handing the schema engine a
 * database whose identity nobody established.
 */
export function parseDatabaseUrl(raw, label) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ShadowDatabaseRefused(
      SHADOW_REFUSAL.UNPARSEABLE,
      `${label} is empty.`,
    );
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ShadowDatabaseRefused(
      SHADOW_REFUSAL.UNPARSEABLE,
      `${label} is not a valid URL. Expected postgresql://user:password@host:port/database.`,
    );
  }
  if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
    throw new ShadowDatabaseRefused(
      SHADOW_REFUSAL.NOT_POSTGRES,
      `${label} uses ${url.protocol}, not postgresql: or postgres:.`,
    );
  }
  // URL lower-cases the hostname already, but an IPv6 literal keeps its
  // brackets; strip them so it can be compared with a resolved address.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) {
    throw new ShadowDatabaseRefused(
      SHADOW_REFUSAL.UNPARSEABLE,
      `${label} has no host.`,
    );
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) {
    throw new ShadowDatabaseRefused(
      SHADOW_REFUSAL.UNPARSEABLE,
      `${label} has no database name.`,
    );
  }
  return {
    protocol: url.protocol,
    host,
    port: url.port === '' ? '5432' : url.port,
    database,
    schema: url.searchParams.get('schema') ?? 'public',
    // Credentials are never logged or compared; only the server is.
    user: decodeURIComponent(url.username),
  };
}

/** True when two parsed URLs name the same PostgreSQL server (host + port). */
export function sameServer(a, b) {
  return a.host === b.host && a.port === b.port;
}

/**
 * The synchronous half of the check: everything decidable from the URLs alone.
 *
 * Returns the parsed shadow target when it is acceptable. Throws
 * ShadowDatabaseRefused otherwise.
 */
export function evaluateShadowUrls({ databaseUrl, shadowUrl }) {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') {
    throw new ShadowDatabaseRefused(
      SHADOW_REFUSAL.UNPARSEABLE,
      'DATABASE_URL is not set, so no shadow database can be proven separate from it.',
    );
  }
  if (typeof shadowUrl !== 'string' || shadowUrl.trim() === '') {
    throw new ShadowDatabaseRefused(
      SHADOW_REFUSAL.MISSING,
      'No shadow database is configured. Prisma needs a separate server for shadow work; set KAYAN_PRISMA_SHADOW_DATABASE_URL to a throwaway server, or do not use `migrate dev`/`migrate diff` here at all.',
    );
  }
  const live = parseDatabaseUrl(databaseUrl, 'DATABASE_URL');
  const shadow = parseDatabaseUrl(shadowUrl, 'KAYAN_PRISMA_SHADOW_DATABASE_URL');

  // The same database, spelled the same way (or with an irrelevant difference
  // such as a trailing slash). Prisma refuses this too; this check exists so the
  // refusal happens before any socket is opened.
  if (
    live.host === shadow.host &&
    live.port === shadow.port &&
    live.database === shadow.database
  ) {
    if (live.schema === shadow.schema) {
      throw new ShadowDatabaseRefused(
        SHADOW_REFUSAL.SAME_URL,
        `The shadow database ${shadow.host}:${shadow.port}/${shadow.database} is the database the program uses. Shadow work creates and drops schemas; it is never allowed on the live database.`,
      );
    }
    // Same server and database, different schema parameter. Prisma 6 classic
    // does not honour `schema=` as isolation: dropping the shadow schema would
    // happen inside the live database. A parameter is not a firewall.
    throw new ShadowDatabaseRefused(
      SHADOW_REFUSAL.SAME_SERVER,
      `The shadow URL points at the live database ${live.database} and only changes the schema parameter. A schema is not an isolation boundary: shadow work would run inside the live database.`,
    );
  }

  // A different database name on the same server is still the same server: the
  // engine may DROP or CREATE databases there, and a mistake in the base name
  // reaches the company database. Isolation means a different server.
  if (sameServer(live, shadow)) {
    throw new ShadowDatabaseRefused(
      SHADOW_REFUSAL.SAME_HOST_PORT,
      `The shadow database ${shadow.database} is on the same server (${shadow.host}:${shadow.port}) as the live database ${live.database}. A separate database name is not isolation: shadow work can create and drop databases on that server. Use a separate PostgreSQL instance.`,
    );
  }

  return { live, shadow };
}

/**
 * The asynchronous half: resolves both hostnames and refuses when they lead to
 * the same addresses on the same port.
 *
 * `resolve` is injectable so the behaviour can be tested without DNS.
 */
export async function evaluateShadowNetwork({
  live,
  shadow,
  resolve = defaultResolve,
}) {
  const [liveAddresses, shadowAddresses] = await Promise.all([
    resolveOrThrow(live.host, resolve, 'DATABASE_URL'),
    resolveOrThrow(shadow.host, resolve, 'KAYAN_PRISMA_SHADOW_DATABASE_URL'),
  ]);
  if (live.port !== shadow.port) {
    // A different port is a different listener on the same machine, which is a
    // separate PostgreSQL instance (the shape the isolation tests use).
    return { liveAddresses, shadowAddresses };
  }
  const overlap = [...shadowAddresses].filter((address) =>
    liveAddresses.has(address),
  );
  if (overlap.length > 0) {
    throw new ShadowDatabaseRefused(
      SHADOW_REFUSAL.SAME_ADDRESS,
      `The shadow host ${shadow.host} resolves to ${overlap.join(', ')}, which is the live database server ${live.host}. Two names for one server are still one server. Use a separate PostgreSQL instance.`,
    );
  }
  return { liveAddresses, shadowAddresses };
}

/** Runs both halves and returns the verified shadow target. */
export async function assertSafeShadowDatabase({
  databaseUrl,
  shadowUrl,
  resolve = defaultResolve,
}) {
  const parsed = evaluateShadowUrls({ databaseUrl, shadowUrl });
  await evaluateShadowNetwork({ ...parsed, resolve });
  return parsed.shadow;
}

async function defaultResolve(host) {
  const results = await lookup(host, { all: true });
  return results.map((entry) => entry.address);
}

async function resolveOrThrow(host, resolve, label) {
  // A literal IP address needs no lookup and is its own answer.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    return new Set([host]);
  }
  let addresses;
  try {
    addresses = await resolve(host);
  } catch (error) {
    throw new ShadowDatabaseRefused(
      SHADOW_REFUSAL.UNRESOLVABLE,
      `${label} host ${host} could not be resolved (${error.code ?? error.message}), so it cannot be shown to be separate from the live database server.`,
    );
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new ShadowDatabaseRefused(
      SHADOW_REFUSAL.UNRESOLVABLE,
      `${label} host ${host} resolved to no addresses, so it cannot be shown to be separate from the live database server.`,
    );
  }
  return new Set(addresses);
}
