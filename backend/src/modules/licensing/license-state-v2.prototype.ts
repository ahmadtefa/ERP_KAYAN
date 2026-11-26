/**
 * PROTOTYPE, not wired into the product. Isolated v1 -> v2 protected-state
 * migration, used only by its own spec on temporary directories. It never
 * reads or creates a key: the caller passes the secret. The database marker is
 * an injected interface so the spec can model crashes.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  closeSync, constants, copyFileSync, existsSync, fsyncSync, openSync, readFileSync,
  renameSync, statSync, writeSync,
} from 'node:fs';
import { join } from 'node:path';

export type Step =
  | 'AFTER_STATE_BACKUP' | 'AFTER_KEY_BACKUP' | 'AFTER_SCHEMA' | 'AFTER_TEMP_WRITE'
  | 'AFTER_RENAME' | 'AFTER_MARKER';

export interface Marker {
  committed: boolean;
  schemaReady: boolean;
  /** Digest of the migration's own output: the genesis of the v2 chain. */
  genesis: string | null;
  /** Floor: no accepted v2 state may have a lower sequence. */
  sequence: number | null;
}
export interface MarkerStore {
  read(): Marker;
  setSchemaReady(): void;
  commit(genesis: string, sequence: number): void;
  raiseSequence(sequence: number): void;
}

export class MigrationError extends Error {
  constructor(message: string, readonly code: 'DAMAGED' | 'ABORTED') { super(message); }
}

/** Canonical JSON: keys sorted at EVERY level (the v1 store sorts only the
 *  top level, which is enough for its flat shape but not for nested data). */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export const mac = (secret: Buffer, state: unknown) =>
  createHmac('sha256', secret).update(canonical(state)).digest('hex');
const hook = (h: ((s: Step) => void) | undefined, s: Step) => { if (h) h(s); };

/** Durable write: temp file, fsync file, rename, fsync directory. */
export function durableWrite(path: string, body: string, exclusive = false): void {
  if (exclusive && existsSync(path)) throw new MigrationError(`${path} already exists`, 'ABORTED');
  const temp = `${path}.${process.pid}.tmp`;
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
  try { writeSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
  fsyncDirectory(join(path, '..'));
}

/** POSIX: a directory fsync failure is an error. Windows cannot open a
 *  directory for fsync from Node; there the strategy is file fsync plus
 *  rename, which is NOT verified here and must be tested on Windows before
 *  any durability claim. */
export function fsyncDirectory(dir: string): 'SYNCED' | 'WINDOWS_UNVERIFIED' {
  if (process.platform === 'win32') return 'WINDOWS_UNVERIFIED';
  const fd = openSync(dir, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  return 'SYNCED';
}

function readSigned(path: string, secret: Buffer): any {
  let parsed: any;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new MigrationError('state unreadable', 'DAMAGED'); }
  if (!parsed?.state || typeof parsed.mac !== 'string') throw new MigrationError('state unsigned', 'DAMAGED');
  const a = Buffer.from(parsed.mac, 'hex'); const b = Buffer.from(mac(secret, parsed.state), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new MigrationError('state integrity check failed (HMAC)', 'DAMAGED');
  return parsed.state;
}

/** The one and only transformation. Deterministic: validation compares to it. */
export function buildV2(v1: any, companyId: string, v1Digest: string): any {
  const { licenseId, maxSeatLimit, maxSeatsUsed, licenseExpiresAt, perpetual, appliedKeys, ...shared } = v1;
  return {
    ...shared, v: 2, sequence: v1.sequence + 1,
    migratedFrom: v1Digest, legacyLicenseId: licenseId,
    licenses: {
      [licenseId]: {
        companyId, companyRef: null, origin: 'LEGACY', setup: 'ACTIVE', suspended: false,
        maxSeatLimit, maxSeatsUsed, licenseExpiresAt, perpetual, appliedKeys: [...appliedKeys],
      },
    },
  };
}

/** Exact transformation check: the file must equal the expected output. */
export function assertExactMigration(v1: any, v2: any, companyId: string, v1Digest: string): void {
  if (canonical(v2) !== canonical(buildV2(v1, companyId, v1Digest))) {
    throw new MigrationError('v2 state is not the exact expected migration of the v1 backup', 'DAMAGED');
  }
}

function verifiedBackup(path: string, expectDigest: string, secret: Buffer, isState: boolean): void {
  if (sha(readFileSync(path)) !== expectDigest) throw new MigrationError(`backup ${path} does not match`, 'DAMAGED');
  if (process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0) throw new MigrationError('backup mode too open', 'DAMAGED');
  if (isState) readSigned(path, secret);
}

export type Authority = 'LEGACY' | 'V2' | 'RESUME' | 'COMMIT_PENDING';

/** Start-up precedence, first match wins. Never regenerates or overwrites. */
export function resolveAuthority(dir: string, secret: Buffer, marker: MarkerStore): Authority {
  const path = join(dir, 'license-state.json');
  const m = marker.read();
  if (!existsSync(path)) throw new MigrationError('state missing', 'DAMAGED');
  const state = readSigned(path, secret);
  if (m.committed) {
    if (state.v !== 2) throw new MigrationError('marker says v2 but state is not v2 (no fallback to v1)', 'DAMAGED');
    if (state.sequence < (m.sequence ?? 0)) throw new MigrationError('state older than the marker floor', 'DAMAGED');
    return 'V2';
  }
  if (state.v === 2) return 'COMMIT_PENDING';
  return m.schemaReady ? 'RESUME' : 'LEGACY';
}

/** Normal post-migration update: durable file first, then raise the floor.
 *  A crash between the two leaves state.sequence > floor, which is accepted. */
export function updateV2(dir: string, secret: Buffer, marker: MarkerStore, change: (s: any) => void): any {
  if (resolveAuthority(dir, secret, marker) !== 'V2') throw new MigrationError('not in v2', 'DAMAGED');
  const path = join(dir, 'license-state.json');
  const cur = readSigned(path, secret);
  const next = JSON.parse(JSON.stringify(cur));
  change(next);
  next.sequence = cur.sequence + 1;
  durableWrite(path, JSON.stringify({ state: next, mac: mac(secret, next) }, null, 2));
  marker.raiseSequence(next.sequence);
  return next;
}

export function migrate(opts: {
  dir: string; secret: Buffer; marker: MarkerStore; companyId: string;
  schemaStep: () => void; hook?: (s: Step) => void;
  /** Operational precondition asserted by the service manager, not provable here. */
  serviceStopped: boolean;
}): void {
  const { dir, secret, marker } = opts;
  if (!opts.serviceStopped) throw new MigrationError('the licensed service must be stopped first', 'ABORTED');
  const path = join(dir, 'license-state.json');
  const keyPath = join(dir, 'state.key');
  const bak = join(dir, 'license-state.json.v1.bak');
  const keyBak = join(dir, 'state.key.v1.bak');
  const authority = resolveAuthority(dir, secret, marker);
  if (authority === 'V2') return;

  const bakDigestFile = `${bak}.sha256`;
  if (authority === 'COMMIT_PENDING') {
    if (!existsSync(bak) || !existsSync(bakDigestFile)) throw new MigrationError('backup missing', 'DAMAGED');
    const d = readFileSync(bakDigestFile, 'utf8').trim();
    verifiedBackup(bak, d, secret, true);
    const v2 = readSigned(path, secret);
    assertExactMigration(readSigned(bak, secret), v2, opts.companyId, d);
    marker.commit(sha(canonical(v2)), v2.sequence);
    return;
  }

  const v1 = readSigned(path, secret);
  if (!v1.licenseId) throw new MigrationError('unbound v1 state is not migrated', 'ABORTED');
  const d = sha(readFileSync(path));
  if (!existsSync(bak)) {
    copyFileSync(path, bak, constants.COPYFILE_EXCL);
    const fd = openSync(bak, 'r+'); fsyncSync(fd); closeSync(fd);
    durableWrite(bakDigestFile, `${d}\n`, true);
  }
  const savedDigest = readFileSync(bakDigestFile, 'utf8').trim();
  verifiedBackup(bak, savedDigest, secret, true);
  if (savedDigest !== d) throw new MigrationError('v1 changed after backup', 'DAMAGED');
  hook(opts.hook, 'AFTER_STATE_BACKUP');
  if (existsSync(keyPath)) {
    if (!existsSync(keyBak)) {
      copyFileSync(keyPath, keyBak, constants.COPYFILE_EXCL);
      const fd = openSync(keyBak, 'r+'); fsyncSync(fd); closeSync(fd);
    }
    if (!readFileSync(keyBak).equals(readFileSync(keyPath))) throw new MigrationError('key backup does not match', 'DAMAGED');
    if (process.platform !== 'win32' && (statSync(keyBak).mode & 0o077) !== 0) throw new MigrationError('key backup mode too open', 'DAMAGED');
  }
  hook(opts.hook, 'AFTER_KEY_BACKUP');
  opts.schemaStep(); marker.setSchemaReady();
  hook(opts.hook, 'AFTER_SCHEMA');
  const v2 = buildV2(v1, opts.companyId, d);
  const temp = `${path}.${process.pid}.tmp`;
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
  try { writeSync(fd, JSON.stringify({ state: v2, mac: mac(secret, v2) }, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  hook(opts.hook, 'AFTER_TEMP_WRITE');
  renameSync(temp, path); fsyncDirectory(dir);
  hook(opts.hook, 'AFTER_RENAME');
  assertExactMigration(v1, readSigned(path, secret), opts.companyId, d);
  marker.commit(sha(canonical(v2)), v2.sequence);
  hook(opts.hook, 'AFTER_MARKER');
}

/** First-admin provisioning capability. The key id is only an identifier; the
 *  capability is the signed key, verified by the caller with the public key
 *  (represented here by `verified`). Single use, recorded in the entry. */
export function consumeFirstAdmin(
  entry: { companyRef: string | null; setup: string; appliedKeys: string[] },
  verified: { signatureValid: boolean; type: string; companyRef: string; keyId: string } | null,
): void {
  if (!verified || !verified.signatureValid) throw new MigrationError('a verified signed activation key is required', 'ABORTED');
  if (verified.type !== 'COMPANY_ACTIVATION') throw new MigrationError('wrong key type', 'ABORTED');
  if (entry.setup !== 'AWAITING_FIRST_ADMIN') throw new MigrationError('first-admin setup is closed', 'ABORTED');
  if (entry.companyRef !== verified.companyRef) throw new MigrationError('key is for another company', 'ABORTED');
  if (!entry.appliedKeys.includes(verified.keyId)) throw new MigrationError('key was not the activating key', 'ABORTED');
  entry.setup = 'ACTIVE';   // write-once; the caller persists via updateV2
}
