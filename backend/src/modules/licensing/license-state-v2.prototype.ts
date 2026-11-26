/**
 * PROTOTYPE, not wired into the product. Isolated migration of the v1
 * protected state to v2, used only by its own spec on temporary directories.
 * It never reads or creates a key: the caller passes the secret, and a missing
 * or wrong secret fails closed. The database marker is an injected interface so
 * the spec can model crashes; the product version would use one transaction.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, fsyncSync, openSync, readFileSync,
  renameSync, writeSync,
} from 'node:fs';
import { join } from 'node:path';

export type Step = 'AFTER_BACKUP' | 'AFTER_SCHEMA' | 'AFTER_TEMP_WRITE' | 'AFTER_RENAME' | 'AFTER_MARKER';

export interface Marker { committed: boolean; digest: string | null; sequence: number | null; schemaReady: boolean }
export interface MarkerStore { read(): Marker; setSchemaReady(): void; commit(digest: string, sequence: number): void }

export class MigrationError extends Error {
  constructor(message: string, readonly code: 'DAMAGED' | 'ABORTED') { super(message); }
}

const canonical = (o: object) => JSON.stringify(o, Object.keys(o).sort());
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const mac = (secret: Buffer, state: object) => createHmac('sha256', secret).update(canonical(state)).digest('hex');
const crash = (hook: ((s: Step) => void) | undefined, s: Step) => { if (hook) hook(s); };

function durableWrite(path: string, body: string) {
  const temp = `${path}.${process.pid}.tmp`;
  const fd = openSync(temp, 'w', 0o600);
  writeSync(fd, body); fsyncSync(fd); closeSync(fd);
  return temp;
}
function fsyncDir(dir: string) {
  try { const fd = openSync(dir, 'r'); fsyncSync(fd); closeSync(fd); } catch { /* Windows */ }
}

function readSigned(path: string, secret: Buffer): any {
  let parsed: any;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new MigrationError('state unreadable', 'DAMAGED'); }
  if (!parsed?.state || typeof parsed.mac !== 'string') throw new MigrationError('state unsigned', 'DAMAGED');
  const a = Buffer.from(parsed.mac, 'hex'); const b = Buffer.from(mac(secret, parsed.state), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new MigrationError('state integrity check failed', 'DAMAGED');
  return parsed.state;
}

/** Exact preservation check of v2 against the verified v1 backup. */
export function validatePreservation(v1: any, v2: any): void {
  const fail = (m: string) => { throw new MigrationError(`preservation: ${m}`, 'DAMAGED'); };
  if (v2.v !== 2) fail('not v2');
  if (!v1.licenseId || v2.legacyLicenseId !== v1.licenseId) fail('legacy identity');
  const e = v2.licenses?.[v1.licenseId];
  if (!e || Object.keys(v2.licenses).length < 1) fail('legacy entry missing');
  if (JSON.stringify(e.appliedKeys.slice(0, v1.appliedKeys.length)) !== JSON.stringify(v1.appliedKeys)) fail('applied keys changed');
  if (e.maxSeatLimit < v1.maxSeatLimit || e.maxSeatsUsed < v1.maxSeatsUsed) fail('watermark lowered');
  if (e.origin !== 'LEGACY') fail('origin');
  if (v2.installId !== v1.installId || v2.publicKeyFingerprint !== v1.publicKeyFingerprint) fail('installation identity');
  if (v2.sequence <= v1.sequence) fail('sequence');
  if (e.licenseExpiresAt !== v1.licenseExpiresAt && e.appliedKeys.length === v1.appliedKeys.length) fail('expiry changed without a key');
  if (e.perpetual !== v1.perpetual && e.appliedKeys.length === v1.appliedKeys.length) fail('perpetual changed without a key');
}

export function buildV2(v1: any, companyId: string): any {
  const { licenseId, maxSeatLimit, maxSeatsUsed, licenseExpiresAt, perpetual, appliedKeys, ...shared } = v1;
  return {
    ...shared, v: 2, sequence: v1.sequence + 1, legacyLicenseId: licenseId,
    licenses: { [licenseId]: { companyId, companyRef: null, origin: 'LEGACY', maxSeatLimit, maxSeatsUsed, licenseExpiresAt, perpetual, appliedKeys: [...appliedKeys], suspended: false } },
  };
}

/** Start-up precedence. Returns what the process may rely on. */
export function resolveAuthority(dir: string, secret: Buffer, marker: MarkerStore): 'LEGACY' | 'V2' | 'RESUME' | 'COMMIT_PENDING' {
  const path = join(dir, 'license-state.json');
  const m = marker.read();
  if (m.committed) {
    if (!existsSync(path)) throw new MigrationError('v2 state missing', 'DAMAGED');
    const state = readSigned(path, secret);       // never regenerates a key or a file
    if (state.v !== 2) throw new MigrationError('marker says v2 but state is not v2 (no fallback to v1)', 'DAMAGED');
    if (sha(readFileSync(path)) !== m.digest || state.sequence !== m.sequence) throw new MigrationError('state differs from marker', 'DAMAGED');
    return 'V2';
  }
  if (!existsSync(path)) throw new MigrationError('state missing', 'DAMAGED');
  const state = readSigned(path, secret);
  if (state.v === 2) return 'COMMIT_PENDING';
  return m.schemaReady ? 'RESUME' : 'LEGACY';
}

export function migrate(opts: {
  dir: string; secret: Buffer; marker: MarkerStore; companyId: string;
  schemaStep: () => void; hook?: (s: Step) => void; lockHeld: boolean;
}): void {
  const { dir, secret, marker, hook } = opts;
  if (!opts.lockHeld) throw new MigrationError('application must be stopped and the migration lock held', 'ABORTED');
  const path = join(dir, 'license-state.json');
  const bak = join(dir, 'license-state.json.v1.bak');
  const keyBak = join(dir, 'state.key.v1.bak');
  const authority = resolveAuthority(dir, secret, marker);
  if (authority === 'V2') return;
  if (authority === 'COMMIT_PENDING') {
    const v2 = readSigned(path, secret);
    if (!existsSync(bak)) throw new MigrationError('backup missing', 'DAMAGED');
    validatePreservation(readSigned(bak, secret), v2);
    marker.commit(sha(readFileSync(path)), v2.sequence);
    return;
  }
  const v1 = readSigned(path, secret);
  if (!v1.licenseId) throw new MigrationError('unbound v1 state is not migrated', 'ABORTED');
  if (!existsSync(bak)) {
    copyFileSync(path, bak, 1 /* COPYFILE_EXCL */);
    const keyPath = join(dir, 'state.key');
    if (existsSync(keyPath)) copyFileSync(keyPath, keyBak, 1);
  }
  if (sha(readFileSync(bak)) !== sha(readFileSync(path))) throw new MigrationError('v1 changed after backup', 'DAMAGED');
  crash(hook, 'AFTER_BACKUP');
  opts.schemaStep(); marker.setSchemaReady();
  crash(hook, 'AFTER_SCHEMA');
  const v2 = buildV2(v1, opts.companyId);
  const temp = durableWrite(path, JSON.stringify({ state: v2, mac: mac(secret, v2) }, null, 2));
  crash(hook, 'AFTER_TEMP_WRITE');
  renameSync(temp, path); fsyncDir(dir);
  crash(hook, 'AFTER_RENAME');
  validatePreservation(v1, readSigned(path, secret));
  marker.commit(sha(readFileSync(path)), v2.sequence);
  crash(hook, 'AFTER_MARKER');
}
