import { readFileSync, statSync } from 'node:fs';

import { pgBackupConnectionEnv } from '../pg-backup-connection';

/**
 * The restore administrator: a separate, limited-privilege PostgreSQL account
 * used only for the destructive-restore machinery — opening and removing the
 * isolated scratch database in which an archive is rehearsed.
 *
 * Why a second account: the program's own runtime account is deliberately
 * least-privilege and may not `CREATE DATABASE`. Rehearsal is not optional —
 * a restore that cannot be rehearsed is a restore that can destroy the live
 * data with an archive nobody proved restorable. Instead of widening the
 * runtime account (forbidden) the operator configures one narrow account
 * that may create databases, and nothing else in the program ever uses it.
 *
 * Credentials come from outside the repository and never from a screen:
 *   * `KAYAN_RESTORE_ADMIN_DATABASE_URL` — a postgres:// URL, or
 *   * `KAYAN_RESTORE_ADMIN_FILE` — an absolute path to a file holding that
 *     URL. The file must not be readable by group or others.
 *
 * Nothing here ever returns, logs, or throws the URL. API responses may only
 * learn booleans and short reason sentences.
 */

const NAME_PATTERN = /^[a-z0-9_]{1,63}$/;

export type RestoreAdminPath = 'runtime' | 'restore-admin';

export interface RestoreAdminStatus {
  configured: boolean;
  /// Same PostgreSQL server as the program's own database.
  sameServer: boolean;
  /// The account may create databases.
  mayCreate: boolean;
  /// Ready to be used for scratch databases right now.
  usable: boolean;
  path: RestoreAdminPath | null;
  /// Short sentence safe for a screen (never contains secrets).
  reason: string | null;
}

export function selfCreatedScratchName(name: string): boolean {
  return (
    NAME_PATTERN.test(name) &&
    /^kayan_(restore_check|restore|rehearsal|scratch)_/.test(name)
  );
}

function readConfiguredUrl(): { url: string | null; problem: string | null } {
  const direct = (process.env.KAYAN_RESTORE_ADMIN_DATABASE_URL ?? '').trim();
  const filePath = (process.env.KAYAN_RESTORE_ADMIN_FILE ?? '').trim();
  if (direct) return { url: direct, problem: null };
  if (!filePath) return { url: null, problem: null };
  if (!filePath.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(filePath)) {
    return {
      url: null,
      problem:
        'KAYAN_RESTORE_ADMIN_FILE must be an absolute path outside the program folder',
    };
  }
  try {
    if (process.platform !== 'win32') {
      const mode = statSync(filePath).mode & 0o077;
      if (mode !== 0) {
        return {
          url: null,
          problem:
            'the restore-admin credential file is readable by other users; restrict it to the service account (chmod 600)',
        };
      }
    }
    const url = readFileSync(filePath, 'utf8').trim();
    return url ? { url, problem: null } : { url: null, problem: 'the restore-admin credential file is empty' };
  } catch {
    return {
      url: null,
      problem: 'the restore-admin credential file could not be read',
    };
  }
}

function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return ['postgres:', 'postgresql:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function serverOf(url: URL): { host: string; port: string } {
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: url.port || '5432',
  };
}

/**
 * The credential to use for scratch-database work: the restore administrator
 * when one is configured and allowed, otherwise the runtime account when it
 * may create databases, otherwise nothing. The returned environment is for
 * PostgreSQL tools and clients; it is kept out of command lines.
 */
export function scratchDatabaseActor(
  runtimeUrl: string | undefined = process.env.DATABASE_URL,
): {
  path: RestoreAdminPath;
  connectionString: string;
  env: NodeJS.ProcessEnv;
} | null {
  const { url } = readConfiguredUrl();
  if (url && runtimeUrl) {
    const admin = parseUrl(url);
    const runtime = parseUrl(runtimeUrl);
    if (admin && runtime) {
      const a = serverOf(admin);
      const r = serverOf(runtime);
      if (a.host === r.host && a.port === r.port) {
        return {
          path: 'restore-admin',
          connectionString: url,
          env: pgBackupConnectionEnv(url),
        };
      }
    }
    // A configured-but-unusable administrator must not silently fall back to
    // the runtime account and appear to work while missing the point; the
    // status probe reports the problem instead.
    return null;
  }
  return null;
}

/**
 * The full status of the restore-admin path, safe to return over the API.
 * When no administrator is configured, the runtime account is considered: it
 * may already be allowed to create databases on development machines.
 */
export async function restoreAdminStatus(
  runtimeUrl: string | undefined = process.env.DATABASE_URL,
): Promise<RestoreAdminStatus> {
  const { url, problem } = readConfiguredUrl();
  if (!url) {
    return {
      configured: false,
      sameServer: false,
      mayCreate: false,
      usable: false,
      path: null,
      reason: problem,
    };
  }
  const admin = parseUrl(url);
  const runtime = runtimeUrl ? parseUrl(runtimeUrl) : null;
  if (!admin) {
    return {
      configured: true,
      sameServer: false,
      mayCreate: false,
      usable: false,
      path: null,
      reason: 'the restore-admin credential is not a valid PostgreSQL URL',
    };
  }
  const sameServer =
    runtime === null ||
    (serverOf(admin).host === serverOf(runtime).host &&
      serverOf(admin).port === serverOf(runtime).port);
  if (!sameServer) {
    return {
      configured: true,
      sameServer: false,
      mayCreate: false,
      usable: false,
      path: null,
      reason:
        'the restore-admin account points at a different PostgreSQL server than the program; it must be the same server',
    };
  }
  // Probe the account: it must be able to create databases. The probe
  // connects with the credentials but never reports them.
  let mayCreate = false;
  let reason: string | null = problem;
  try {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const result = await client.query<{ ok: boolean }>(
        'SELECT (rolsuper OR rolcreatedb) AS ok FROM pg_roles WHERE rolname = current_user',
      );
      mayCreate = result.rows[0]?.ok === true;
      reason = mayCreate
        ? null
        : 'the restore-admin account may not create databases (grant it CREATEDB)';
    } finally {
      await client.end().catch(() => {});
    }
  } catch {
    reason = 'the restore-admin account could not sign in to PostgreSQL';
  }
  return {
    configured: true,
    sameServer: true,
    mayCreate,
    usable: mayCreate,
    path: mayCreate ? 'restore-admin' : null,
    reason,
  };
}

/** The environment for tools that must reach a scratch database. */
export function scratchToolEnv(
  runtimeUrl: string | undefined = process.env.DATABASE_URL,
): NodeJS.ProcessEnv | null {
  const actor = scratchDatabaseActor(runtimeUrl);
  return actor ? actor.env : null;
}

export function scratchConnectionStringFor(
  database: string,
  runtimeUrl: string | undefined = process.env.DATABASE_URL,
): string {
  if (!NAME_PATTERN.test(database)) {
    throw new Error('refusing to name a scratch database that');
  }
  const actor = scratchDatabaseActor(runtimeUrl);
  const base = actor?.connectionString ?? runtimeUrl;
  if (!base) throw new Error('This server has no database connection to use.');
  const url = new URL(base);
  url.pathname = `/${database}`;
  url.searchParams.delete('schema');
  return url.toString();
}
