import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The trust anchor that lives beside the database, not inside it.
 *
 * A licence that only knows its own state in PostgreSQL cannot tell the
 * difference between "the customer created three accounts yesterday" and "the
 * customer restored yesterday's backup": both look like three accounts. This
 * file remembers the highest seat count ever seen, the last moment the program
 * was trusted to be running, and which keys were already spent - and it is
 * authenticated with a key that is not in the database, so editing the rows or
 * restoring an older dump cannot lower those marks.
 *
 * What this is not: it is not a defence against the owner of the machine. The
 * file, the key beside it and the database are all files on their computer; a
 * determined owner can delete all three. The point is that it cannot happen by
 * accident or by restoring a backup, and that every attempt leaves a record.
 */

export type EnforcementMode = 'off' | 'warn' | 'enforce';
export type ClockState = 'OK' | 'WARNING' | 'TAMPERED';

export interface LicenseTrustState {
  v: 1;
  installId: string;
  /** The highest wall-clock moment this installation has been observed at. */
  lastSeenAt: string | null;
  /** Highest number of used seats ever observed. Never decreases. */
  maxSeatsUsed: number;
  /** Highest seat limit ever granted. Never decreases. */
  maxSeatLimit: number;
  /** Keys already applied, so a replayed key is refused before the database. */
  appliedKeys: string[];
  licenseId: string | null;
  /** The furthest expiry ever granted; null while none was, or if perpetual. */
  licenseExpiresAt: string | null;
  perpetual: boolean;
  clockState: ClockState;
  /** Moments at which the clock looked rolled back. */
  clockSuspects: string[];
  /** Set once an administrator/installer chose a mode; it outranks a missing key. */
  enforcement: EnforcementMode | null;
  publicKeyFingerprint: string | null;
  sequence: number;
}

const MAX_APPLIED_KEYS = 500;
const MAX_SUSPECTS = 50;

export class LicenseStateError extends Error {
  constructor(
    message: string,
    readonly code: 'UNREADABLE' | 'TAMPERED' | 'WRITE_FAILED',
  ) {
    super(message);
    this.name = 'LicenseStateError';
  }
}

export function emptyState(installId: string): LicenseTrustState {
  return {
    v: 1,
    installId,
    lastSeenAt: null,
    maxSeatsUsed: 0,
    maxSeatLimit: 0,
    appliedKeys: [],
    licenseId: null,
    licenseExpiresAt: null,
    perpetual: false,
    clockState: 'OK',
    clockSuspects: [],
    enforcement: null,
    publicKeyFingerprint: null,
    sequence: 0,
  };
}

/** Deterministic JSON, so the MAC covers exactly one spelling of the state. */
function canonical(state: LicenseTrustState): string {
  return JSON.stringify(state, Object.keys(state).sort());
}

/**
 * The authentication key of an installation's protected state, read without
 * ever creating one. A caller that only wants to *verify* a copy - the licence
 * backup archive, a restore decision - must not be able to mint a new key that
 * would make an old, valid state impossible to check.
 */
export function readStateSecret(
  directory: string,
  explicit?: string,
): Buffer | null {
  const fromEnv = explicit ?? (process.env.LICENSE_STATE_SECRET ?? '').trim();
  if (fromEnv) return createHash('sha256').update(fromEnv).digest();
  const keyPath = join(directory, 'state.key');
  let text: string;
  try {
    text = readFileSync(keyPath, 'utf8').trim();
  } catch {
    return null;
  }
  if (text.length < 32) return null;
  return createHash('sha256').update(text).digest();
}

/**
 * Authenticates one stored state document (`{state, mac}`) with a known key.
 * Kept separate from the file walk so the same check can be applied to a copy
 * that is not (or not yet) in the licence folder.
 */
export function verifyStateDocument(
  text: string,
  secret: Buffer,
  label = 'licence state',
): LicenseTrustState {
  let parsed: { state?: unknown; mac?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LicenseStateError(
      `The ${label} is not readable JSON`,
      'UNREADABLE',
    );
  }
  if (
    !parsed ||
    parsed.state === null ||
    typeof parsed.state !== 'object' ||
    Array.isArray(parsed.state) ||
    typeof parsed.mac !== 'string'
  ) {
    throw new LicenseStateError(
      `The ${label} has no signed state`,
      'TAMPERED',
    );
  }
  const state = parsed.state as LicenseTrustState;
  const expected = createHmac('sha256', secret)
    .update(canonical(state))
    .digest('hex');
  const actual = Buffer.from(parsed.mac, 'hex');
  const wanted = Buffer.from(expected, 'hex');
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    throw new LicenseStateError(
      `The ${label} failed its integrity check`,
      'TAMPERED',
    );
  }
  if (
    state.v !== 1 ||
    !Number.isSafeInteger(state.sequence) ||
    state.sequence < 0
  ) {
    throw new LicenseStateError(
      `The ${label} uses an unsupported or invalid format`,
      'UNREADABLE',
    );
  }
  return state;
}

const CLOCK_SEVERITY: Record<ClockState, number> = {
  OK: 0,
  WARNING: 1,
  TAMPERED: 2,
};

function laterMoment(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * Resolves two authenticated states that claim the same sequence.
 *
 * Two processes (the program and the repair tool, or two windows of the
 * program) can each write once before either reads the other's result. Both
 * copies are then authenticated, both are honest, and neither is "the right
 * one" - so the answer is the conservative union of the two: no watermark goes
 * down, no spent key is forgotten, nothing is invented. The result is written
 * back with a higher sequence so the next start has a single truth.
 *
 * Copies that disagree about *whose* installation this is are not a race:
 * they are refused.
 */
export function mergeTrustStates(
  a: LicenseTrustState,
  b: LicenseTrustState,
): LicenseTrustState {
  if (a.installId !== b.installId) {
    throw new LicenseStateError(
      'The two protected licence states belong to different installations.',
      'TAMPERED',
    );
  }
  if (
    a.publicKeyFingerprint &&
    b.publicKeyFingerprint &&
    a.publicKeyFingerprint !== b.publicKeyFingerprint
  ) {
    throw new LicenseStateError(
      'The two protected licence states name different verification keys.',
      'TAMPERED',
    );
  }
  const appliedKeys = [...a.appliedKeys];
  for (const key of b.appliedKeys) {
    if (!appliedKeys.includes(key)) appliedKeys.push(key);
  }
  const clockSuspects = [...a.clockSuspects];
  for (const moment of b.clockSuspects) {
    if (!clockSuspects.includes(moment)) clockSuspects.push(moment);
  }
  clockSuspects.sort();
  const licenseExpiresAt =
    a.perpetual || b.perpetual
      ? null
      : laterMoment(a.licenseExpiresAt, b.licenseExpiresAt);
  const perpetual = a.perpetual || b.perpetual;
  return {
    v: 1,
    installId: a.installId,
    lastSeenAt: laterMoment(a.lastSeenAt, b.lastSeenAt),
    maxSeatsUsed: Math.max(a.maxSeatsUsed, b.maxSeatsUsed),
    maxSeatLimit: Math.max(a.maxSeatLimit, b.maxSeatLimit),
    appliedKeys: appliedKeys.slice(-MAX_APPLIED_KEYS),
    // A licence id is only ambiguous if the two copies name different ones at
    // the same sequence; the copy with the further term wins so a concurrent
    // renewal is not thrown away.
    licenseId:
      a.licenseId === b.licenseId
        ? a.licenseId
        : [a, b]
            .sort(
              (x, y) =>
                (y.perpetual ? Number.MAX_SAFE_INTEGER : Date.parse(y.licenseExpiresAt ?? '') || 0) -
                (x.perpetual ? Number.MAX_SAFE_INTEGER : Date.parse(x.licenseExpiresAt ?? '') || 0),
            )[0]
            .licenseId,
    licenseExpiresAt,
    perpetual,
    clockState:
      CLOCK_SEVERITY[a.clockState] >= CLOCK_SEVERITY[b.clockState]
        ? a.clockState
        : b.clockState,
    clockSuspects: clockSuspects.slice(-MAX_SUSPECTS),
    enforcement: a.enforcement ?? b.enforcement,
    publicKeyFingerprint: a.publicKeyFingerprint ?? b.publicKeyFingerprint,
    sequence: Math.max(a.sequence, b.sequence) + 1,
  };
}

export class LicenseStore {
  private state: LicenseTrustState;
  private readonly secret: Buffer;
  private _recoveredFromBackup = false;

  /** True when startup recovered the primary trust file from its verified mirror. */
  get recoveredFromBackup(): boolean {
    return this._recoveredFromBackup;
  }

  private get backupPath(): string {
    return join(this.directory, 'license-state.backup.json');
  }

  constructor(
    private readonly directory: string,
    options: { secret?: string } = {},
  ) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.secret = this.resolveSecret(options.secret);
    this.state = this.load();
  }

  get path(): string {
    return join(this.directory, 'license-state.json');
  }

  get current(): LicenseTrustState {
    return this.state;
  }

  /** Applies a change and persists it atomically before returning. */
  update(change: (state: LicenseTrustState) => void): LicenseTrustState {
    const next: LicenseTrustState = JSON.parse(JSON.stringify(this.state));
    change(next);
    next.appliedKeys = next.appliedKeys.slice(-MAX_APPLIED_KEYS);
    next.clockSuspects = next.clockSuspects.slice(-MAX_SUSPECTS);
    next.sequence = this.state.sequence + 1;
    next.maxSeatsUsed = Math.max(next.maxSeatsUsed, this.state.maxSeatsUsed);
    next.maxSeatLimit = Math.max(next.maxSeatLimit, this.state.maxSeatLimit);
    this.persist(next);
    this.state = next;
    return next;
  }

  /** Re-reads the file, for the restore path and for tests. */
  reload(): LicenseTrustState {
    // Use the same authenticated primary/mirror selection as startup. In
    // particular, a missing primary is recoverable when the mirror verifies.
    this.state = this.load();
    return this.state;
  }

  private resolveSecret(explicit?: string): Buffer {
    const fromEnv =
      explicit ?? (process.env.LICENSE_STATE_SECRET ?? '').trim();
    if (fromEnv) return createHash('sha256').update(fromEnv).digest();

    // No configured secret: keep one beside the state, readable only by the
    // account that runs the backend. Generated once.
    const keyPath = join(this.directory, 'state.key');
    if (existsSync(keyPath)) {
      // A key without its state can mean an existing trust file was lost or
      // moved. Never silently replace its watermarks with an empty state.
      if (!existsSync(this.path) && !existsSync(this.backupPath)) {
        throw new LicenseStateError('The licence state file and its verified backup are missing but the authentication key exists.', 'UNREADABLE');
      }
      let text: string;
      try {
        text = readFileSync(keyPath, 'utf8').trim();
      } catch {
        throw new LicenseStateError('The licence state authentication key cannot be read.', 'UNREADABLE');
      }
      if (text.length >= 32) return createHash('sha256').update(text).digest();
      // Never overwrite an existing authentication key: it may be the only
      // way to verify an intact backup of this installation's licence state.
      throw new LicenseStateError('The licence state authentication key is invalid.', 'UNREADABLE');
    }
    if (existsSync(this.path) || existsSync(this.backupPath)) {
      // An existing state without its authentication key cannot be verified.
      // Creating a new key would make a valid old state impossible to check.
      throw new LicenseStateError('The licence state authentication key is missing.', 'UNREADABLE');
    }
    const generated = randomBytes(32).toString('hex');
    try {
      // A second process may create the key between the existence check and
      // this write. Exclusive creation must never replace that key.
      writeFileSync(keyPath, generated, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new LicenseStateError('The licence state key was created concurrently; retry after initialization completes.', 'UNREADABLE');
      }
      throw error;
    }
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      // Windows ACLs are the installer's job; the file is inside ProgramData.
    }
    return createHash('sha256').update(generated).digest();
  }

  private mac(state: LicenseTrustState): string {
    return createHmac('sha256', this.secret).update(canonical(state)).digest('hex');
  }

  private load(): LicenseTrustState {
    const primaryExists = existsSync(this.path);
    const backupExists = existsSync(this.backupPath);
    if (!primaryExists && !backupExists) {
      const created = emptyState(randomBytes(16).toString('hex'));
      this.persist(created);
      return created;
    }

    let primary: LicenseTrustState | null = null;
    let backup: LicenseTrustState | null = null;
    let primaryError: unknown;
    let backupError: unknown;

    if (primaryExists) {
      try {
        primary = this.readVerified(this.path);
      } catch (error) {
        primaryError = error;
      }
    }
    if (backupExists) {
      try {
        backup = this.readVerified(this.backupPath);
      } catch (error) {
        backupError = error;
      }
    }

    if (primary && backup) {
      if (
        primary.sequence === backup.sequence &&
        canonical(primary) !== canonical(backup)
      ) {
        // Two writers raced. Both copies authenticated, so the safe answer is
        // their union with a higher sequence, never a fail-closed lockout and
        // never a silent choice that could lower a watermark.
        const merged = mergeTrustStates(primary, backup);
        this.persist(merged);
        return merged;
      }
      // Both copies are independently authenticated. Keep the newest sequence
      // so an interrupted two-file write cannot roll the trust state backwards.
      const newest = backup.sequence > primary.sequence ? backup : primary;
      if (newest === backup) this._recoveredFromBackup = true;
      if (
        newest.sequence !== primary.sequence ||
        newest.sequence !== backup.sequence
      ) {
        this.persist(newest);
      }
      return newest;
    }

    if (primary) {
      // Existing installations gain the mirror on their first successful
      // startup after this upgrade. A broken mirror is replaced only from a
      // primary copy whose MAC has already been verified.
      this.persist(primary);
      return primary;
    }

    if (backup) {
      // Preserve the damaged primary for diagnosis. The backup is accepted
      // only after its MAC is checked with this installation's existing key.
      if (primaryExists) {
        const damaged = join(
          this.directory,
          `license-state.damaged-${Date.now()}.json`,
        );
        renameSync(this.path, damaged);
      }
      this._recoveredFromBackup = true;
      this.persist(backup);
      return backup;
    }

    // Neither copy can be authenticated. Preserve the original failure and
    // fail closed; never create a fresh trust store over an existing key.
    throw primaryError ?? backupError ?? new LicenseStateError(
      'No verifiable licence state is available.',
      'UNREADABLE',
    );
  }

  private readVerified(path: string): LicenseTrustState {
    // Same authentication as verifyStateDocument, but this copy's full path is
    // part of the diagnostic: a damaged file has to be findable.
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      throw new LicenseStateError(
        `The licence state file ${path} cannot be read`,
        'UNREADABLE',
      );
    }
    return verifyStateDocument(text, this.secret, `licence state file ${path}`);
  }

  private persist(state: LicenseTrustState): void {
    const body = JSON.stringify({ state, mac: this.mac(state) }, null, 2);
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      // Write the verified mirror first. If the process stops between the two
      // atomic renames, load() compares authenticated sequence numbers and
      // chooses the newest complete copy.
      this.writeAtomic(this.backupPath, body);
      this.writeAtomic(this.path, body);
    } catch (error) {
      throw new LicenseStateError(
        `The licence state and its protected backup could not be written: ${(error as Error).message}`,
        'WRITE_FAILED',
      );
    }
  }

  private writeAtomic(path: string, body: string): void {
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, body, { mode: 0o600 });
    renameSync(temp, path);
  }
}
