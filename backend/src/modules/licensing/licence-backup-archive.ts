import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import {
  LicenseStateError,
  LicenseTrustState,
  readStateSecret,
  verifyStateDocument,
} from './license-store';

/**
 * Timestamped, verified copies of an installation's licence, kept beside the
 * program's data so that damaged licence files are recoverable without the
 * customer deleting anything or reinstalling.
 *
 * The protected licence folder holds two copies of the trust state (primary and
 * authenticated mirror), which covers a single damaged write. It does not cover
 * a folder that is wiped, a disk that is repaired, or both copies being damaged
 * by the same event - the cases this archive exists for. Each capture is:
 *
 *  * authenticated - every file is hashed and the manifest is MAC'd with the
 *    installation's own state key, so an edited copy is refused rather than
 *    restored;
 *  * bound to the machine - the manifest records the machine identity, and a
 *    copy taken on another computer is refused even though its MAC is valid;
 *  * monotonically safe - restoring never lowers a watermark. The restored
 *    state is the union of every authenticated snapshot's watermarks and spent
 *    keys, so a backup cannot roll seats, expiry or anti-replay marks back, and
 *    cannot grant a term that no authenticated snapshot ever recorded;
 *  * atomic - captures are built in a temporary folder and renamed into place,
 *    restores are written through temp files and renamed over the target, and
 *    the damaged originals are kept for diagnosis;
 *  * retained ten deep - the oldest copy is deleted only after a newer capture
 *    has been written and verified.
 *
 * What this is not: the archive is not a second signing authority. A licence
 * key is still bound to a machine by the operator's Ed25519 signature, so
 * copying this folder to another computer cannot make a licence work there.
 */

export const LICENCE_BACKUP_RETENTION = 10;
/** The folder name used inside a development state directory. */
export const LICENCE_BACKUP_DIR_NAME = 'LicenceBackups';
const MANIFEST = 'manifest.json';
const NAME_PATTERN = /^licence-\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const AUDIT_LOG = 'operations.log';
const KEEP_DAMAGED = 5;

/** Files that make up "the licence" on disk, in capture order. */
const SNAPSHOT_FILES = [
  'license-state.json',
  'license-state.backup.json',
  'public-key.pem',
  'enforcement.required',
  'state.key',
] as const;

export interface LicenceBackupFile {
  name: string;
  sha256: string;
  bytes: number;
}

export interface LicenceBackupStateSummary {
  sequence: number;
  installId: string;
  licenseId: string | null;
  licenseExpiresAt: string | null;
  maxSeatLimit: number;
  maxSeatsUsed: number;
  lastSeenAt: string | null;
  appliedKeys: string[];
  publicKeyFingerprint: string | null;
}

export interface LicenceBackupManifest {
  v: 1;
  id: string;
  capturedAt: string;
  reason: string;
  machineId: string | null;
  files: LicenceBackupFile[];
  state: LicenceBackupStateSummary;
  mac: string;
}

export interface LicenceBackupRecord {
  id: string;
  path: string;
  capturedAt: string;
  reason: string;
  machineId: string | null;
  files: LicenceBackupFile[];
  state: LicenceBackupStateSummary;
}

export interface LicenceRestoreOutcome {
  restored: LicenceBackupRecord;
  /** Snapshots that were examined and refused, newest first. */
  rejected: { id: string; reason: string }[];
  /** Damaged files moved aside rather than overwritten. */
  preserved: string[];
  /** Watermarks raised above the chosen snapshot by the union rule. */
  merged: string[];
}

export interface LicenceBackupOptions {
  /** Where captures live. Defaults to a folder beside the licence state. */
  backupDirectory?: string;
  /** The installation's state key, as configured. Read from the folder when absent. */
  secret?: string;
  /** This computer's identity. Verified against a snapshot before restoring it. */
  machineId?: string | null;
  clock?: () => Date;
  retention?: number;
  logger?: { log(message: string): void; warn(message: string): void };
}

/**
 * Where captures live.
 *
 * On Windows this is the documented `%ProgramData%\KAYAN-ERP\LicenceBackups`:
 * beside the licence folder, writable by the service account, and outside the
 * installation directory that Setup replaces. Everywhere else - development
 * copies and tests - it stays inside the state folder, so two installations on
 * one machine never read each other's captures.
 */
export function defaultLicenceBackupDirectory(licenceDirectory: string): string {
  if (process.platform === 'win32') {
    const programData = process.env.ProgramData ?? process.env.PROGRAMDATA;
    if (programData) return join(programData, 'KAYAN-ERP', 'LicenceBackups');
  }
  return join(licenceDirectory, LICENCE_BACKUP_DIR_NAME);
}

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

function canonicalManifest(
  manifest: Omit<LicenceBackupManifest, 'mac'>,
): string {
  return JSON.stringify({
    v: manifest.v,
    id: manifest.id,
    capturedAt: manifest.capturedAt,
    reason: manifest.reason,
    machineId: manifest.machineId,
    files: manifest.files,
    state: manifest.state,
  });
}

/** The same canonical spelling LicenseStore authenticates. */
function canonicalState(state: LicenseTrustState): string {
  return JSON.stringify(state, Object.keys(state).sort());
}

function stateMac(state: LicenseTrustState, secret: Buffer): string {
  return createHmac('sha256', secret).update(canonicalState(state)).digest('hex');
}

function writeDurable(path: string, body: string | Buffer, mode = 0o600): void {
  const fd = openSync(path, 'w', mode);
  try {
    writeFileSync(fd, body);
    // Durability before the rename: a power cut must not leave a truncated
    // capture that looks complete.
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeAtomic(
  path: string,
  body: string | Buffer,
  mode = 0o600,
): void {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeDurable(temp, body, mode);
    renameSync(temp, path);
  } catch (error) {
    try {
      rmSync(temp, { force: true });
    } catch {
      // Nothing else to do: the temp file is ignored by every reader anyway.
    }
    throw error;
  }
}

export class LicenceBackupArchive {
  private readonly directory: string;
  private readonly secretOverride?: string;
  private readonly machineId: string | null;
  private readonly clock: () => Date;
  private readonly retention: number;
  private readonly logger?: LicenceBackupOptions['logger'];

  constructor(
    private readonly licenceDirectory: string,
    options: LicenceBackupOptions = {},
  ) {
    this.directory =
      options.backupDirectory ??
      process.env.KAYAN_LICENCE_BACKUP_DIR?.trim() ??
      defaultLicenceBackupDirectory(licenceDirectory);
    this.secretOverride = options.secret;
    this.machineId = options.machineId ?? null;
    this.clock = options.clock ?? (() => new Date());
    this.retention = Math.max(1, options.retention ?? LICENCE_BACKUP_RETENTION);
    this.logger = options.logger;
  }

  get backupDirectory(): string {
    return this.directory;
  }

  /** The key this archive authenticates with, or null when none is available. */
  private secret(): Buffer | null {
    return readStateSecret(this.licenceDirectory, this.secretOverride);
  }

  private mac(body: Omit<LicenceBackupManifest, 'mac'>, secret: Buffer): string {
    return createHmac('sha256', secret)
      .update(canonicalManifest(body))
      .digest('hex');
  }

  private audit(
    entry: Record<string, unknown>,
    options: { create?: boolean } = {},
  ): void {
    try {
      // A read-only path (list, restore, a skipped capture) must not create a
      // folder as a side effect: an installation with no archive stays exactly
      // as it was, and a failed restore changes nothing on disk.
      if (!options.create && !existsSync(this.directory)) return;
      if (options.create) mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const line = JSON.stringify({
        at: this.clock().toISOString(),
        ...entry,
      });
      const path = join(this.directory, AUDIT_LOG);
      // Append: two processes capturing at once never rewrite each other.
      const fd = openSync(path, 'a', 0o600);
      try {
        writeFileSync(fd, `${line}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      // Logging must never be the reason a licence backup fails.
      this.logger?.warn(
        `The licence backup log could not be written: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Writes one timestamped, verified copy of the licence.
   *
   * Refuses when the live licence state cannot be authenticated: a "backup" of
   * a damaged file is worse than no backup, because it would later be offered
   * as a restore candidate.
   */
  capture(reason: string): LicenceBackupRecord {
    const secret = this.secret();
    if (!secret) {
      throw this.refuse(
        reason,
        'state-key-unavailable',
        'The licence state key is not available, so a verified licence backup cannot be authenticated.',
        'UNREADABLE',
      );
    }
    const snapshot: { name: string; body: Buffer }[] = [];
    for (const name of SNAPSHOT_FILES) {
      const path = join(this.licenceDirectory, name);
      if (!existsSync(path)) continue;
      const body = readFileSync(path);
      snapshot.push({ name, body });
    }
    const primary = snapshot.find((f) => f.name === 'license-state.json');
    const mirror = snapshot.find(
      (f) => f.name === 'license-state.backup.json',
    );
    if (!primary && !mirror) {
      throw this.refuse(
        reason,
        'no-licence-state',
        'There is no licence state to back up.',
        'UNREADABLE',
      );
    }
    const verifiedStates: LicenseTrustState[] = [];
    for (const file of [primary, mirror]) {
      if (!file) continue;
      try {
        verifiedStates.push(
          verifyStateDocument(
            file.body.toString('utf8'),
            secret,
            `licence backup source ${file.name}`,
          ),
        );
      } catch (error) {
        // One damaged copy is fine as long as the other authenticates: the
        // capture then records the verified one.
        this.logger?.warn(
          `Skipping an unauthenticated licence state while capturing a backup (${file.name}): ${
            (error as Error).message
          }`,
        );
      }
    }
    if (verifiedStates.length === 0) {
      throw this.refuse(
        reason,
        'state-not-authentic',
        'The licence state is not authentic; no trusted backup was written.',
        'TAMPERED',
      );
    }
    const state = verifiedStates.reduce((a, b) =>
      b.sequence > a.sequence ? b : a,
    );

    const at = this.clock();
    const id = randomBytes(4).toString('hex');
    const name = `licence-${at
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z')}-${id}`;
    const files: LicenceBackupFile[] = snapshot.map((file) => ({
      name: file.name,
      sha256: sha256(file.body),
      bytes: file.body.length,
    }));
    const body: Omit<LicenceBackupManifest, 'mac'> = {
      v: 1,
      id: name,
      capturedAt: at.toISOString(),
      reason,
      machineId: this.machineId,
      files,
      state: {
        sequence: state.sequence,
        installId: state.installId,
        licenseId: state.licenseId,
        licenseExpiresAt: state.licenseExpiresAt,
        maxSeatLimit: state.maxSeatLimit,
        maxSeatsUsed: state.maxSeatsUsed,
        lastSeenAt: state.lastSeenAt,
        appliedKeys: state.appliedKeys,
        publicKeyFingerprint: state.publicKeyFingerprint,
      },
    };
    const manifest: LicenceBackupManifest = {
      ...body,
      mac: this.mac(body, secret),
    };

    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    // Build the whole capture under a name no reader accepts, then rename it
    // into place in one step: an interrupted capture is invisible.
    const staging = join(this.directory, `.tmp-${name}`);
    const final = join(this.directory, name);
    try {
      rmSync(staging, { recursive: true, force: true });
      mkdirSync(staging, { recursive: true, mode: 0o700 });
      for (const file of snapshot) {
        writeDurable(join(staging, file.name), file.body);
      }
      writeDurable(
        join(staging, MANIFEST),
        JSON.stringify(manifest, null, 2),
      );
      // Verify what was actually written before it can be renamed into place.
      // The staging folder is not named after the capture, so the manifest's
      // own id is the expected one here.
      this.readManifest(staging, secret, name);
      renameSync(staging, final);
      this.readManifest(final, secret);
    } catch (error) {
      try {
        rmSync(staging, { recursive: true, force: true });
      } catch {
        // A leftover staging folder is ignored by list()/restore().
      }
      this.audit({ event: 'capture-failed', reason, detail: (error as Error).message });
      throw error;
    }

    this.audit({ event: 'capture', id: name, reason, sequence: state.sequence });
    this.logger?.log(
      `Licence backup ${name} written and verified (${files.length} files, state sequence ${state.sequence}).`,
    );
    this.prune();
    return { ...body, path: final };
  }

  /** Records a refused capture and returns the error to throw. */
  private refuse(
    reason: string,
    detail: string,
    message: string,
    code: 'UNREADABLE' | 'TAMPERED' | 'WRITE_FAILED',
  ): LicenseStateError {
    this.audit({ event: 'capture-failed', reason, detail }, { create: true });
    return new LicenseStateError(message, code);
  }

  private prune(): void {
    const records = this.list();
    if (records.length <= this.retention) return;
    // Delete from the oldest end only, and only copies whose manifest and file
    // hashes still verify: an older copy that is damaged stays where it is for
    // diagnosis rather than being silently destroyed.
    const doomed = records.slice(this.retention);
    for (const record of doomed) {
      try {
        this.verifyRecord(record);
      } catch {
        continue;
      }
      rmSync(record.path, { recursive: true, force: true });
      this.audit({
        event: 'prune',
        id: record.id,
        capturedAt: record.capturedAt,
      });
    }
  }

  /** Captures newest first. Unreadable or stray folders are skipped. */
  list(): LicenceBackupRecord[] {
    let names: string[];
    try {
      names = readdirSync(this.directory);
    } catch {
      return [];
    }
    const records: LicenceBackupRecord[] = [];
    for (const name of names) {
      if (!NAME_PATTERN.test(name)) continue;
      const path = join(this.directory, name);
      try {
        if (!statSync(path).isDirectory()) continue;
        const secret = this.secret();
        if (!secret) return [];
        records.push(this.readManifest(path, secret));
      } catch {
        continue;
      }
    }
    return records.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }

  private readManifest(
    path: string,
    secret: Buffer,
    expectedId?: string,
  ): LicenceBackupRecord {
    let manifest: LicenceBackupManifest;
    try {
      manifest = JSON.parse(readFileSync(join(path, MANIFEST), 'utf8'));
    } catch {
      throw new LicenseStateError(
        `The licence backup ${path} has no readable manifest.`,
        'UNREADABLE',
      );
    }
    const { mac, ...body } = manifest ?? ({} as LicenceBackupManifest);
    if (
      !manifest ||
      manifest.v !== 1 ||
      typeof mac !== 'string' ||
      typeof manifest.id !== 'string' ||
      !Array.isArray(manifest.files) ||
      manifest.id !== (expectedId ?? path.split(/[\\/]/).pop())
    ) {
      throw new LicenseStateError(
        `The licence backup ${path} has an invalid manifest.`,
        'TAMPERED',
      );
    }
    const expected = Buffer.from(this.mac(body, secret), 'hex');
    const actual = Buffer.from(mac, 'hex');
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new LicenseStateError(
        `The licence backup ${path} failed its integrity check.`,
        'TAMPERED',
      );
    }
    const record: LicenceBackupRecord = { ...body, path };
    this.verifyRecord(record);
    return record;
  }

  /** Re-hashes each recorded file; a capture that changed on disk is refused. */
  verifyRecord(record: LicenceBackupRecord): void {
    for (const file of record.files) {
      const body = readFileSync(join(record.path, file.name));
      if (body.length !== file.bytes || sha256(body) !== file.sha256) {
        throw new LicenseStateError(
          `The licence backup ${record.id} no longer matches its manifest (${file.name}).`,
          'TAMPERED',
        );
      }
    }
  }

  /**
   * Restores the newest snapshot that authenticates on this computer.
   *
   * Every candidate is checked for its MAC, its file hashes and its machine
   * identity. A snapshot that fails is recorded and the next one is tried; if
   * none qualifies, nothing is written and the caller must keep failing closed.
   */
  restoreNewestVerified(): LicenceRestoreOutcome | null {
    const secret = this.secret();
    const records = this.list();
    const rejected: { id: string; reason: string }[] = [];
    if (!secret || records.length === 0) {
      this.audit({ event: 'restore-skipped', detail: 'no authentic backup available' });
      return null;
    }

    let allNames: string[] = [];
    try {
      allNames = readdirSync(this.directory).filter((name) =>
        NAME_PATTERN.test(name),
      );
    } catch {
      allNames = [];
    }
    const readable = new Set(records.map((record) => record.id));
    for (const name of allNames) {
      if (!readable.has(name)) {
        // Present but unusable: damaged manifest, damaged files, or a folder
        // renamed by hand. It is reported, never silently skipped.
        rejected.push({ id: name, reason: 'unreadable-backup' });
      }
    }

    const states: { record: LicenceBackupRecord; state: LicenseTrustState }[] = [];
    for (const record of records) {
      if (record.machineId && this.machineId && record.machineId !== this.machineId) {
        rejected.push({ id: record.id, reason: 'machine-mismatch' });
        continue;
      }
      try {
        const text = readFileSync(
          join(record.path, 'license-state.json'),
          'utf8',
        );
        states.push({
          record,
          state: verifyStateDocument(text, secret, `licence backup ${record.id}`),
        });
      } catch (error) {
        rejected.push({ id: record.id, reason: (error as Error).message });
      }
    }
    if (states.length === 0) {
      this.audit({ event: 'restore-failed', rejected });
      return null;
    }

    const chosen = states[0];
    const merged: string[] = [];
    // Watermarks are a floor, not a snapshot: restore the union of everything
    // that authenticated, so a restore can never hand back seats, a term or a
    // spent-key slot that the installation had already used.
    const restored: LicenseTrustState = JSON.parse(JSON.stringify(chosen.state));
    for (const other of states) {
      const candidate = other.state;
      if (candidate.maxSeatLimit > restored.maxSeatLimit) {
        restored.maxSeatLimit = candidate.maxSeatLimit;
        merged.push(`maxSeatLimit=${candidate.maxSeatLimit}`);
      }
      if (candidate.maxSeatsUsed > restored.maxSeatsUsed) {
        restored.maxSeatsUsed = candidate.maxSeatsUsed;
        merged.push(`maxSeatsUsed=${candidate.maxSeatsUsed}`);
      }
      if (
        candidate.licenseExpiresAt &&
        (!restored.licenseExpiresAt ||
          Date.parse(candidate.licenseExpiresAt) > Date.parse(restored.licenseExpiresAt))
      ) {
        restored.licenseExpiresAt = candidate.licenseExpiresAt;
        restored.perpetual = candidate.perpetual || restored.perpetual;
        merged.push(`licenseExpiresAt=${candidate.licenseExpiresAt}`);
      }
      if (
        candidate.lastSeenAt &&
        (!restored.lastSeenAt ||
          Date.parse(candidate.lastSeenAt) > Date.parse(restored.lastSeenAt))
      ) {
        restored.lastSeenAt = candidate.lastSeenAt;
        merged.push(`lastSeenAt=${candidate.lastSeenAt}`);
      }
      for (const key of candidate.appliedKeys) {
        if (!restored.appliedKeys.includes(key)) {
          restored.appliedKeys.push(key);
          merged.push(`appliedKey:${key}`);
        }
      }
    }
    const highestSequence = states.reduce(
      (max, entry) => Math.max(max, entry.state.sequence),
      0,
    );
    if (restored.sequence <= highestSequence) restored.sequence = highestSequence + 1;

    const preserved = this.preserveDamaged();
    const dir = this.licenceDirectory;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const body = JSON.stringify(
      { state: restored, mac: stateMac(restored, secret) },
      null,
      2,
    );
    // The mirror first, then the primary: the same order the store uses, so a
    // failure in between leaves two authenticated copies rather than none.
    writeAtomic(join(dir, 'license-state.backup.json'), body);
    writeAtomic(join(dir, 'license-state.json'), body);

    for (const name of ['public-key.pem', 'enforcement.required'] as const) {
      const source = join(chosen.record.path, name);
      const target = join(dir, name);
      // Never overwrite a key or marker that is already there: a rotated key is
      // an installer-approved transition, not something a backup may undo.
      if (existsSync(source) && !existsSync(target)) {
        writeAtomic(target, readFileSync(source));
      }
    }
    const restoredKey = join(chosen.record.path, 'state.key');
    const keyPath = join(dir, 'state.key');
    if (!existsSync(keyPath) && existsSync(restoredKey)) {
      writeAtomic(keyPath, readFileSync(restoredKey));
    }

    // Re-verify after the restore: the decision is the verification, not the
    // write.
    const written = readFileSync(join(dir, 'license-state.json'), 'utf8');
    const verified = verifyStateDocument(written, secret, 'restored licence state');
    if (verified.sequence !== restored.sequence) {
      this.audit({ event: 'restore-unverified', id: chosen.record.id });
      throw new LicenseStateError(
        'The restored licence state did not verify after it was written.',
        'WRITE_FAILED',
      );
    }

    this.audit({
      event: 'restore',
      id: chosen.record.id,
      capturedAt: chosen.record.capturedAt,
      sequence: restored.sequence,
      rejected,
      preserved,
      merged,
    });
    this.logger?.log(
      `Licence state restored from backup ${chosen.record.id} (captured ${chosen.record.capturedAt}); ${rejected.length} backup(s) refused.`,
    );
    return { restored: chosen.record, rejected, preserved, merged };
  }

  private preserveDamaged(): string[] {
    const preserved: string[] = [];
    const stamp = this.clock().toISOString().replace(/[:.]/g, '-');
    for (const name of [
      'license-state.json',
      'license-state.backup.json',
    ] as const) {
      const path = join(this.licenceDirectory, name);
      if (!existsSync(path)) continue;
      const moved = join(
        this.licenceDirectory,
        `${name.replace(/\.json$/, '')}.damaged-${stamp}.json`,
      );
      try {
        renameSync(path, moved);
        preserved.push(moved.split(/[\\/]/).pop() as string);
      } catch {
        // If the damaged file cannot be moved aside, the restore below is
        // refused by the caller: overwriting evidence is worse than failing.
        throw new LicenseStateError(
          'The damaged licence state could not be preserved, so it was not overwritten.',
          'WRITE_FAILED',
        );
      }
    }
    this.pruneDamaged();
    return preserved;
  }

  private pruneDamaged(): void {
    let names: string[];
    try {
      names = readdirSync(this.licenceDirectory);
    } catch {
      return;
    }
    const damaged = names
      .filter((name) => /^license-state(\.backup)?\.damaged-.*\.json$/.test(name))
      .sort();
    for (const name of damaged.slice(0, Math.max(0, damaged.length - KEEP_DAMAGED))) {
      try {
        rmSync(join(this.licenceDirectory, name), { force: true });
      } catch {
        // Diagnosis files are optional; never fail a restore over them.
      }
    }
  }
}
