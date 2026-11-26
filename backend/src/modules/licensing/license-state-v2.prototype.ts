/**
 * PROTOTYPE, not wired into the product. Isolated v1 -> v2 protected-state
 * migration, used only by its own spec on temporary directories. It never
 * reads or creates a key: the caller passes the secret. The database marker is
 * an injected interface so the spec can model crashes.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  chmodSync, closeSync, constants, existsSync, fsyncSync, openSync, readFileSync,
  renameSync, statSync, writeSync,
} from 'node:fs';
import { type KeyObject } from 'node:crypto';
import { verifyKeyV2, type LicensePayloadV2 } from './license-key';
import { join } from 'node:path';

export type Step =
  | 'IN_STATE_BACKUP_COPY' | 'AFTER_STATE_BAK_BEFORE_DIGEST' | 'AFTER_STATE_BACKUP'
  | 'IN_KEY_BACKUP_COPY' | 'AFTER_KEY_BACKUP' | 'AFTER_SCHEMA' | 'AFTER_TEMP_WRITE'
  | 'AFTER_RENAME' | 'AFTER_MARKER';

export interface Marker {
  committed: boolean;
  schemaReady: boolean;
  /** Digest of the migration's own output. Recorded for audit only: it is NOT
   *  checked against later states, so no chain-of-descent claim is made. */
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

/** Durable write: temp file (explicit 0600), fsync file, rename, fsync
 *  directory. `beforeRename` lets a test crash inside the window. Only the
 *  final name is ever visible, and only complete. */
export function durableWrite(
  path: string, body: string | Buffer, exclusive = false, beforeRename?: () => void,
): void {
  if (exclusive && existsSync(path)) throw new MigrationError(`${path} already exists`, 'ABORTED');
  const temp = `${path}.${process.pid}.tmp`;
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
  try { writeSync(fd, typeof body === 'string' ? Buffer.from(body) : body); fsyncSync(fd); } finally { closeSync(fd); }
  if (process.platform !== 'win32') chmodSync(temp, 0o600);
  if (beforeRename) beforeRename();
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


/** Structural rules every accepted v2 state obeys, checked on every start and
 *  every update. Write-once fields and append-only lists are checked against
 *  the previous accepted state in `assertTransition`. */
const SETUP_STATES = ['ACTIVE', 'AWAITING_FIRST_ADMIN'];
const REF = /^[A-Za-z0-9_-]{8,64}$/;
export function assertInvariants(state: any): void {
  const bad = (m: string): never => { throw new MigrationError(`v2 invariant violated: ${m}`, 'DAMAGED'); };
  if (state?.v !== 2 || !Number.isInteger(state.sequence) || state.sequence < 1) bad('version or sequence');
  const ids = Object.keys(state.licenses ?? {});
  if (ids.length === 0) bad('no licence entries');
  if (typeof state.legacyLicenseId !== 'string' || !state.licenses[state.legacyLicenseId]) bad('legacy licence entry missing');
  if (state.licenses[state.legacyLicenseId].origin !== 'LEGACY') bad('legacy entry origin');
  const companyIds = new Set<string>(); const refs = new Set<string>(); const keys = new Set<string>();
  for (const id of ids) {
    const e = state.licenses[id];
    if (typeof e.companyId !== 'string' || !e.companyId) bad('companyId');
    if (companyIds.has(e.companyId)) bad('companyId shared by two licences');
    companyIds.add(e.companyId);
    if (e.companyRef !== null) {
      if (typeof e.companyRef !== 'string' || !REF.test(e.companyRef)) bad('companyRef format');
      if (refs.has(e.companyRef)) bad('companyRef shared by two licences');
      refs.add(e.companyRef);
    } else if (e.origin !== 'LEGACY') bad('a v2 entry needs a companyRef');
    if (!SETUP_STATES.includes(e.setup)) bad('setup state');
    if (e.origin === 'LEGACY' && e.setup !== 'ACTIVE') bad('legacy entry setup');
    if (!Number.isInteger(e.maxSeatLimit) || e.maxSeatLimit < 0) bad('seat limit');
    if (!Number.isInteger(e.maxSeatsUsed) || e.maxSeatsUsed < 0) bad('seat watermark');
    if (typeof e.suspended !== 'boolean' || typeof e.perpetual !== 'boolean') bad('flags');
    if (!Array.isArray(e.appliedKeys)) bad('appliedKeys');
    for (const k of e.appliedKeys) {
      if (typeof k !== 'string' || keys.has(k)) bad('applied key duplicated');
      keys.add(k);
    }
  }
}

/** previous -> next: write-once, append-only, monotonic, one-way. */
export function assertTransition(prev: any, next: any): void {
  assertInvariants(next);
  const bad = (m: string): never => { throw new MigrationError(`v2 transition refused: ${m}`, 'DAMAGED'); };
  if (next.sequence !== prev.sequence + 1) bad('sequence must advance by one');
  if (next.legacyLicenseId !== prev.legacyLicenseId) bad('legacyLicenseId is write-once');
  if (next.installId !== prev.installId || next.publicKeyFingerprint !== prev.publicKeyFingerprint) bad('install identity');
  for (const id of Object.keys(prev.licenses)) {
    const a = prev.licenses[id]; const b = next.licenses[id];
    if (!b) bad(`licence ${id} removed`);
    if (b.companyId !== a.companyId) bad('companyId is write-once');
    if (a.companyRef !== null && b.companyRef !== a.companyRef) bad('companyRef is write-once');
    if (b.origin !== a.origin) bad('origin');
    if (b.appliedKeys.length < a.appliedKeys.length || a.appliedKeys.some((k: string, i: number) => b.appliedKeys[i] !== k)) bad('appliedKeys is append-only');
    if (b.maxSeatsUsed < a.maxSeatsUsed) bad('seat watermark must not fall');
    if (a.setup === 'ACTIVE' && b.setup !== 'ACTIVE') bad('setup is one-way');
  }
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
    assertInvariants(state);
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
  assertTransition(cur, next);
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
    // A restored database may be older than the file: the marker row AND the
    // schema can be gone. Re-run the idempotent schema step before committing.
    opts.schemaStep(); marker.setSchemaReady();
    marker.commit(sha(canonical(v2)), v2.sequence);
    return;
  }

  const v1 = readSigned(path, secret);
  if (!v1.licenseId) throw new MigrationError('unbound v1 state is not migrated', 'ABORTED');
  const d = sha(readFileSync(path));
  // Backups are written complete-or-absent (temp, fsync, rename, 0600). The
  // digest file is written after the backup, so a crash can leave a complete
  // backup without its digest: that is completed only when the backup provably
  // equals the CURRENT source. A temp file left by a crash is ignored.
  if (!existsSync(bak)) {
    if (existsSync(bakDigestFile) && readFileSync(bakDigestFile, 'utf8').trim() !== d) {
      throw new MigrationError('v1 changed after backup', 'DAMAGED');
    }
    durableWrite(bak, readFileSync(path), true, () => hook(opts.hook, 'IN_STATE_BACKUP_COPY'));
  }
  hook(opts.hook, 'AFTER_STATE_BAK_BEFORE_DIGEST');
  if (!existsSync(bakDigestFile)) {
    if (sha(readFileSync(bak)) !== d) throw new MigrationError('backup does not equal the v1 state', 'DAMAGED');
    durableWrite(bakDigestFile, `${d}\n`, true);
  }
  const savedDigest = readFileSync(bakDigestFile, 'utf8').trim();
  verifiedBackup(bak, savedDigest, secret, true);
  if (savedDigest !== d) throw new MigrationError('v1 changed after backup', 'DAMAGED');
  hook(opts.hook, 'AFTER_STATE_BACKUP');
  if (existsSync(keyPath)) {
    if (!existsSync(keyBak)) {
      durableWrite(keyBak, readFileSync(keyPath), true, () => hook(opts.hook, 'IN_KEY_BACKUP_COPY'));
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

/** State-acceptance rules for a verified KYN2 key. Pure: returns the next
 *  state, never mutates. The caller has already verified the signature with
 *  verifyKeyV2 against the vendor public key; this function only applies the
 *  rules that depend on the state (replay, known licence ids, company
 *  binding, and which company a key may touch). */
export function applyKeyV2(
  state: any, payload: LicensePayloadV2, ctx: { machineId: string; newCompanyId: string; now: Date },
): any {
  const refuse = (m: string): never => { throw new MigrationError(m, 'ABORTED'); };
  const next = JSON.parse(JSON.stringify(state));
  const entries = Object.entries<any>(next.licenses);
  if (entries.some(([, e]) => e.appliedKeys.includes(payload.keyId))) refuse('this key was already used');
  const months = (t: any) => {
    if (!t) return { perpetual: false, at: null as string | null };
    if (t.kind === 'PERPETUAL') return { perpetual: true, at: null };
    const d = new Date(ctx.now); d.setUTCMonth(d.getUTCMonth() + t.months);
    return { perpetual: false, at: d.toISOString() };
  };
  if (payload.type === 'COMPANY_ACTIVATION') {
    if (payload.machineId !== ctx.machineId) refuse('the key is for another machine');
    if (next.licenses[payload.licenseId] || payload.licenseId === next.legacyLicenseId) refuse('this licence id is already known');
    if (entries.some(([, e]) => e.companyRef === payload.companyRef)) refuse('this company reference already exists');
    const t = months(payload.term);
    next.licenses[payload.licenseId] = {
      companyId: ctx.newCompanyId, companyRef: payload.companyRef, origin: 'V2', setup: 'AWAITING_FIRST_ADMIN',
      suspended: false, maxSeatLimit: payload.seats?.value ?? 0, maxSeatsUsed: 0,
      licenseExpiresAt: t.at, perpetual: t.perpetual, appliedKeys: [payload.keyId],
    };
    return next;
  }
  const entry = next.licenses[payload.licenseId];
  if (!entry) refuse('this key is for a licence this installation does not have');
  if (entry.companyRef === null) {
    // First v2 key of the migrated legacy licence: binds its companyRef, once.
    if (payload.licenseId !== next.legacyLicenseId) refuse('company reference missing');
    if (entries.some(([, e]) => e.companyRef === payload.companyRef)) refuse('this company reference already exists');
    entry.companyRef = payload.companyRef;
  } else if (entry.companyRef !== payload.companyRef) refuse('the key is for another company');
  if (payload.type === 'RENEWAL') {
    const t = months(payload.term); entry.licenseExpiresAt = t.at; entry.perpetual = t.perpetual;
  } else if (payload.type === 'SEATS') {
    const v = payload.seats?.value ?? 0;
    const limit = payload.seats?.mode === 'INCREASE' ? entry.maxSeatLimit + v : v;
    if (limit < entry.maxSeatsUsed) refuse('the seat limit would be below the seats in use');
    entry.maxSeatLimit = limit;
  } else refuse('this key type is not applied to a company yet (transfer semantics are not defined)');
  entry.appliedKeys.push(payload.keyId);
  return next;
}

/** First-admin provisioning for a company in AWAITING_FIRST_ADMIN. The
 *  capability is the signed key text itself (verified here with the vendor
 *  public key), never a caller flag. Order, chosen so every crash point is
 *  recoverable and nothing can create a second admin:
 *    1. verify the key text, machine, type and companyRef against the entry;
 *    2. if the DB already has the company's admin (crash after step 3), skip 3;
 *    3. createAdmin() runs in the DB (its own unique constraint is the second
 *       lock: one admin per company);
 *    4. flip the entry to ACTIVE through updateV2 (durable file, then floor).
 *  A retry with the same key after a crash between 3 and 4 only flips. */
export function provisionFirstAdmin(opts: {
  dir: string; secret: Buffer; marker: MarkerStore; keyText: string; publicKey: KeyObject;
  machineId: string; adminExists: () => boolean; createAdmin: () => void; hook?: (s: 'AFTER_ADMIN') => void;
}): void {
  let payload: LicensePayloadV2;
  try { payload = verifyKeyV2(opts.keyText, opts.publicKey).payload; }
  catch { throw new MigrationError('a verified signed activation key is required', 'ABORTED'); }
  if (payload.type !== 'COMPANY_ACTIVATION') throw new MigrationError('wrong key type', 'ABORTED');
  if (payload.machineId !== opts.machineId) throw new MigrationError('the key is for another machine', 'ABORTED');
  if (resolveAuthority(opts.dir, opts.secret, opts.marker) !== 'V2') throw new MigrationError('not in v2', 'DAMAGED');
  const state = readSigned(join(opts.dir, 'license-state.json'), opts.secret);
  const entry = state.licenses[payload.licenseId];
  if (!entry || entry.companyRef !== payload.companyRef) throw new MigrationError('key is for another company', 'ABORTED');
  if (entry.setup !== 'AWAITING_FIRST_ADMIN') throw new MigrationError('first-admin setup is closed', 'ABORTED');
  if (!entry.appliedKeys.includes(payload.keyId)) throw new MigrationError('key was not the activating key', 'ABORTED');
  if (!opts.adminExists()) opts.createAdmin();
  if (opts.hook) opts.hook('AFTER_ADMIN');
  updateV2(opts.dir, opts.secret, opts.marker, (s) => { s.licenses[payload.licenseId].setup = 'ACTIVE'; });
}
