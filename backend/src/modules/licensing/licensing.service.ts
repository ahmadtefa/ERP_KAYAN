import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  constants,
  existsSync,
  promises as fs,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { arch, hostname, networkInterfaces, platform } from 'node:os';
import { join, resolve } from 'node:path';

import { PrismaService } from '../../common/prisma/prisma.service';
import {
  activationEnd,
  daysRemaining,
  isPerpetual,
  renewalEnd,
} from './license-duration';
import {
  ActivationRequest,
  buildRequestCode,
  LicenseKeyError,
  LicensePayload,
  loadPublicKey,
  ParsedLicenseKey,
  publicKeyFingerprint,
  verifyKey,
} from './license-key';
import {
  ClockState,
  EnforcementMode,
  LicenseStateError,
  LicenseStore,
} from './license-store';
import {
  LicenceBackupArchive,
  LicenceBackupRecord,
} from './licence-backup-archive';

/**
 * The offline licence, as the program enforces it.
 *
 * The product holds only the operator's **public** key. Every key that changes
 * anything is an Ed25519-signed statement by the operator; this service reads
 * it, checks it against this machine and the licence already installed, and
 * refuses anything else - including a valid key of the wrong type.
 *
 * Two things live outside PostgreSQL on purpose:
 *
 *  * the **watermarks** (highest seats used, highest limit, furthest expiry,
 *    last moment the program was seen running), so restoring an older backup
 *    cannot lower them;
 *  * the **spent keys**, so re-entering the same key is refused even if the
 *    database row for it were lost.
 *
 * `license_installations`, `license_keys`, `license_seat_usage` and
 * `license_events` hold the operational state the screens read.
 */

export type LicenseState = 'UNLICENSED' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';

export interface LicenseSeatStatus {
  /** 0 means "no licence yet"; it does not mean "unlimited forever". */
  limit: number;
  used: number;
  available: number | null;
}

export interface LicenseStatus {
  state: LicenseState;
  /** True only when the licence policy is enforced and this installation may
   *  not be used for business. */
  blocked: boolean;
  enforcement: EnforcementMode;
  configured: boolean;
  licenseId: string | null;
  machineId: string;
  installId: string;
  issuedAt: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  perpetual: boolean;
  daysRemaining: number | null;
  expiringSoon: boolean;
  seats: LicenseSeatStatus;
  clock: {
    state: ClockState;
    lastSeenAt: string | null;
    note: string | null;
  };
  publicKeyFingerprint: string | null;
  requestCode: string;
  serverTime: string;
}

export interface LicenseActor {
  userId?: string | null;
  ipAddress?: string | null;
}

export interface ReserveSeatInput {
  userId: string;
  username: string;
  reason: 'SETUP_ADMIN' | 'USER_CREATE';
  idempotencyKey?: string | null;
}

/** Differences below ten minutes are a clock drifting, not a rolled-back date. */
const CLOCK_WARN_MS = 10 * 60_000;
/** A single jump this large is not a clock drift. */
const CLOCK_MAJOR_MS = 72 * 3_600_000;
/** How many warning-level rollbacks inside a week amount to a pattern. */
const CLOCK_SUSPECT_LIMIT = 3;
const CLOCK_SUSPECT_WINDOW_MS = 7 * 24 * 3_600_000;
const CLOCK_CHECK_INTERVAL_MS = 60_000;
const STATUS_CACHE_MS = 3_000;

export interface LicensingOptions {
  directory?: string;
  publicKeyText?: string | null;
  enforcement?: EnforcementMode;
  clock?: () => Date;
  appVersion?: string;
  machineId?: string;
  /** In tests, skip reading registry/network for a machine id. */
  trustStore?: LicenseStore;
  /**
   * The protected licence folder Setup created, when this copy is an installed
   * one. Left undefined the service looks for it itself (see
   * [installedLicenceDirectory]); tests pass it explicitly, or pass `null` to
   * say "this is a development copy".
   */
  installedDirectory?: string | null;
}

@Injectable()
export class LicensingService implements OnModuleInit {
  private readonly logger = new Logger('Licensing');
  private readonly directory: string;
  private readonly publicKeyTextOverride: string | null;
  private readonly clock: () => Date;
  private readonly appVersion: string;
  private readonly machineIdOverride: string | null;
  /**
   * The licence folder that belongs to the installer, or null in a copy that
   * was never installed. It is the difference between "a development machine
   * may be configured by whoever runs it" and "a customer machine's licence
   * settings cannot be changed by the person using the program".
   */
  private readonly installedDirectory: string | null;
  private readonly preserveTrustState: boolean;

  private trustStore?: LicenseStore;
  private enforcementExplicit = false;
  private store!: LicenseStore;
  private installedStateError: 'LICENSE_STATE_DAMAGED' | null = null;
  private publicKeyPem: string | null = null;
  private publicKeyPrint: string | null = null;
  // Last completed check, for non-blocking health diagnostics only. A guard
  // decision always uses its own fresh check, never this shared observation.
  private installedKeyAvailable = false;
  private enforcement: EnforcementMode = 'warn';
  private lastClockCheck = 0;
  private lastStatus: { at: number; value: LicenseStatus } | null = null;
  private ready: Promise<void> | null = null;
  /** Timestamped licence copies; created on first use. */
  private archive?: LicenceBackupArchive;
  private lastLicenceBackup: LicenceBackupRecord | null = null;
  private resolvedMachineId: string | null = null;
  private machineIdWriteFailed = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // Not a provider: the options are a plain object the tests pass in, so
    // Nest must not try to resolve it from the container.
    @Optional() options: LicensingOptions = {},
  ) {
    // An installed copy keeps its licence state where Setup put it, and
    // nowhere else: LICENSE_STATE_DIR is part of the environment of whoever
    // started the program, so honouring it there would let any user move the
    // licence state to a folder they can rewrite.
    this.installedDirectory =
      options.installedDirectory === undefined
        ? installedLicenceDirectory()
        : options.installedDirectory;
    this.directory =
      options.directory ??
      this.installedDirectory ??
      process.env.LICENSE_STATE_DIR ??
      defaultStateDirectory();
    // The installer markers themselves could be missing. Do not treat the
    // default Windows state folder as disposable merely because of that.
    this.preserveTrustState = Boolean(this.installedDirectory) ||
      (platform() === 'win32' &&
        resolve(this.directory).toLowerCase() === resolve(defaultStateDirectory()).toLowerCase());
    this.publicKeyTextOverride = options.publicKeyText ?? null;
    this.clock = options.clock ?? (() => new Date());
    this.appVersion =
      options.appVersion ??
      process.env.KAYAN_APP_VERSION ??
      readBackendVersion();
    // On an installed copy the machine id comes from the machine, never from
    // LICENSE_MACHINE_ID: that variable would let a key issued for one
    // computer be used on another. Tests pass the id in directly.
    this.machineIdOverride =
      options.machineId ??
      (this.installedDirectory
        ? null
        : (process.env.LICENSE_MACHINE_ID ?? '').trim() || null);
    this.trustStore = options.trustStore;
    if (options.enforcement) {
      this.enforcement = options.enforcement;
      this.enforcementExplicit = true;
    } else if (this.preserveTrustState) {
      // The guard must fail closed even if bootstrap fails before it can read
      // the state or public key from a protected Windows state directory.
      this.enforcement = 'enforce';
    }
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureReady();
    } catch (error) {
      // A licence subsystem that cannot start must never take the program
      // down: the guard fails closed for business routes but the operator can
      // still reach the licence screen and the backups.
      this.logger.error(`Licensing did not start: ${describeError(error)}`);
    }
  }

  // ─────────────────────────────────────────────────────────────── readiness

  private ensureReady(): Promise<void> {
    if (!this.ready) {
      // A bootstrap that failed - typically because the database was not up
      // yet - must not be remembered as a permanent verdict: the next request
      // tries again instead of the installation staying unlicensed until the
      // service is restarted.
      this.ready = this.bootstrap().catch((error) => {
        this.ready = null;
        throw error;
      });
    }
    return this.ready;
  }

  private async bootstrap(): Promise<void> {
    this.openStore();
    this.loadKey();
    this.resolveEnforcement();
    await this.reconcile();
    await this.runClockCheck(true);
    // Keep reporting the failure until the restored store, database and clock
    // have all completed bootstrap, not merely until the JSON could be read.
    this.installedStateError = null;
    this.logger.log(
      `Licence mode ${this.enforcement}; public key ${
        this.publicKeyPrint ?? 'none'
      }; state ${this.directory}${
        this.installedDirectory ? ' (installed copy)' : ' (development copy)'
      }; machine ${this.machineId()}`,
    );
  }

  private openStore(allowArchiveRestore = true): void {
    // Never initialize a blank trust store over an existing installation.
    // A verified mirror is a valid recovery source when the primary is absent.
    if (
      this.installedStateError &&
      !existsSync(join(this.directory, 'license-state.json')) &&
      !existsSync(join(this.directory, 'license-state.backup.json'))
    ) {
      throw new ServiceUnavailableException({
        code: 'LICENSE_STATE_DAMAGED',
        detail: 'Licence state recovery is incomplete. Preserve the damaged file and restore a current trusted backup from this installation before retrying.',
      });
    }
    try {
      this.store = this.trustStore ?? new LicenseStore(this.directory);
      // A previous bootstrap attempt may have failed before a verified mirror
      // was restored. Clear that diagnostic only after the store opens cleanly.
      this.installedStateError = null;
      if (this.store.recoveredFromBackup) {
        this.logger.warn(
          'KAYAN-LICENCE-STATE-RECOVERED: restored the primary protected state from its authenticated mirror; the damaged copy was preserved.',
        );
      }
    } catch (error) {
      if (
        error instanceof LicenseStateError &&
        (error.code === 'TAMPERED' || error.code === 'UNREADABLE')
      ) {
        // Neither protected copy could be authenticated. Before failing
        // closed, try the timestamped licence backups: those are authenticated
        // with this installation's own key, so a verified one is a safe
        // recovery source, and one restore attempt is all this gets.
        if (allowArchiveRestore && this.restoreFromLicenceArchive()) {
          this.openStore(false);
          return;
        }
        // Do not discard or recreate the trust store: its anti-rollback
        // watermarks cannot be reconstructed safely from a possibly older
        // database. Fail closed.
        this.enforcement = 'enforce';
        this.installedStateError = 'LICENSE_STATE_DAMAGED';
        throw new ServiceUnavailableException({
          code: 'LICENSE_STATE_DAMAGED',
          detail: 'تعذر التحقق من ملف حالة الترخيص. احتفظ بالملف التالف وتواصل مع الدعم لاستعادة نسخة موثوقة وحديثة من الجهاز نفسه؛ لا تحذف الملف ولا تعِد التثبيت. / The licence state cannot be verified. Preserve the damaged file and contact support to restore a current trusted backup from this installation; do not delete it or reinstall.',
        });
      }
      throw error;
    }
  }

  /**
   * Restores the protected state from the newest authenticated licence backup.
   *
   * Returns true only when a snapshot verified, was written and re-verified;
   * every other outcome leaves the installation failing closed, because a
   * licence that cannot be authenticated must never be invented.
   */
  private restoreFromLicenceArchive(): boolean {
    // A caller-supplied trust store is a test seam, not an installation.
    if (this.trustStore) return false;
    try {
      const outcome = this.licenceArchive().restoreNewestVerified();
      if (!outcome) {
        this.logger.error(
          'No authenticated licence backup could be restored; the licence state stays fail-closed.',
        );
        return false;
      }
      this.installedStateError = null;
      this.logger.warn(
        `KAYAN-LICENCE-STATE-RESTORED: restored the protected state from backup ${outcome.restored.id} (captured ${outcome.restored.capturedAt}); ${outcome.rejected.length} backup(s) refused; damaged files preserved.`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Licence backup recovery failed: ${describeError(error)}`,
      );
      return false;
    }
  }

  /**
   * Writes a timestamped, verified copy of the licence beside the program's
   * data. Called after a successful full backup, before a restore, and after a
   * key is applied - never for a licence that does not authenticate.
   */
  captureLicenceBackup(
    reason: string,
  ): LicenceBackupRecord | null {
    try {
      const safe = reason.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'manual';
      const record = this.licenceArchive().capture(safe);
      this.lastLicenceBackup = record;
      return record;
    } catch (error) {
      // A backup of the database must not fail because the licence copy could
      // not be written; the reason is logged and reported by status.
      this.logger.warn(
        `The licence backup was not written: ${describeError(error)}`,
      );
      return null;
    }
  }

  /** The most recent verified licence backup, for the backup screens. */
  lastLicenceBackupRecord(): LicenceBackupRecord | null {
    return this.lastLicenceBackup;
  }

  private licenceArchive(): LicenceBackupArchive {
    if (!this.archive) {
      this.archive = new LicenceBackupArchive(this.directory, {
        machineId: this.machineId(),
        clock: this.clock,
        logger: {
          log: (message: string) => this.logger.log(message),
          warn: (message: string) => this.logger.warn(message),
        },
      });
    }
    return this.archive;
  }

  private loadKey(): void {
    // Bootstrap can retry after an earlier partial failure. Never carry a key
    // from that failed attempt into a later attempt with a missing/bad file.
    this.publicKeyPem = null;
    this.publicKeyPrint = null;
    this.installedKeyAvailable = false;
    const candidates: string[] = [];

    if (this.installedDirectory) {
      // The installed key file is the only key this copy accepts. Both
      // LICENSE_PUBLIC_KEY and LICENSE_PUBLIC_KEY_FILE are set by whoever
      // starts the program, and a key chosen that way would verify a licence
      // signed by the user. The file itself is writable only by
      // Administrators and the PostgreSQL service account.
      const installedKey = join(this.installedDirectory, 'public-key.pem');
      const text = readTextIfPresent(installedKey);
      if (text) {
        candidates.push(text);
      } else {
        this.logger.error(
          `This is an installed copy but its licence key file is missing (${installedKey}). ` +
            'No key can be verified until the installation is repaired.',
        );
      }
      this.adoptPublicKey(candidates);
      return;
    }

    if (this.publicKeyTextOverride) candidates.push(this.publicKeyTextOverride);
    const inline = (process.env.LICENSE_PUBLIC_KEY ?? '').trim();
    if (inline) candidates.push(inline);
    const file =
      (process.env.LICENSE_PUBLIC_KEY_FILE ?? '').trim() ||
      join(this.directory, 'public-key.pem');
    const fromFile = readTextIfPresent(file);
    if (fromFile) candidates.push(fromFile);
    this.adoptPublicKey(candidates);
  }

  /** Uses the first candidate that really is an Ed25519 public key. */
  private adoptPublicKey(candidates: string[]): void {
    for (const candidate of candidates) {
      try {
        const key = loadPublicKey(candidate);
        const fingerprint = publicKeyFingerprint(key);
        const recorded = this.store.current.publicKeyFingerprint;
        if (this.preserveTrustState && recorded && recorded !== fingerprint) {
          // A valid but different key is not a verified key transition. Keep
          // the recorded fingerprint and fail closed until support restores
          // the installed key or an approved migration is implemented.
          this.logger.error('The installed licence verification key differs from the protected state. Business operations are blocked.');
          return;
        }
        this.store.update((state) => {
          state.publicKeyFingerprint = fingerprint;
        });
        // Do not report the key as configured if persisting its fingerprint
        // failed: callers must never use a partially initialized key.
        this.publicKeyPem = candidate;
        this.publicKeyPrint = fingerprint;
        this.installedKeyAvailable = true;
        return;
      } catch (error) {
        this.logger.warn(
          `A configured licence public key was rejected: ${(error as Error).message}`,
        );
      }
    }
    this.logger.warn(
      'No licence public key is configured. Keys cannot be verified until one is installed.',
    );
  }

  /**
   * Revalidate the installed public-key source at each protected request and
   * immediately before a licence mutation. Do not use a time-based cache:
   * removal or replacement must fail the next check. Only a small regular
   * file is read, asynchronously; concurrent requests make independent
   * decisions and do not overwrite the protected fingerprint or loaded key.
   * Health only reports the last completed observation and never waits on IO.
   * A filesystem change *after* this check cannot cancel an in-flight action.
   */
  private async verificationKeyAvailable(): Promise<boolean> {
    if (!this.installedDirectory) return Boolean(this.publicKeyPrint);
    if (!this.publicKeyPem || !this.publicKeyPrint || !this.store.current.publicKeyFingerprint) {
      this.installedKeyAvailable = false;
      return false;
    }
    const path = join(this.installedDirectory, 'public-key.pem');
    const maxBytes = 16 * 1024;
    let file: Awaited<ReturnType<typeof fs.open>> | undefined;
    let valid = false;
    try {
      const before = await fs.lstat(path);
      if (!before.isFile() || before.size <= 0 || before.size > maxBytes) throw new Error('invalid public key file');
      const flags = platform() === 'win32'
        ? constants.O_RDONLY
        : constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
      file = await fs.open(path, flags);
      const opened = await file.stat();
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const after = await fs.lstat(path);
      const sameFile = (a: typeof before, b: typeof before) =>
        a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino &&
        a.size === b.size && a.mtimeMs === b.mtimeMs;
      if (!sameFile(before, opened) || !sameFile(opened, after) || bytesRead !== opened.size) {
        throw new Error('public key file changed during verification');
      }
      const fingerprint = publicKeyFingerprint(loadPublicKey(buffer.subarray(0, bytesRead).toString('utf8')));
      valid = fingerprint === this.publicKeyPrint && fingerprint === this.store.current.publicKeyFingerprint;
    } catch {
      // Missing, unreadable, malformed or different key: fail closed without
      // logging file contents or changing any protected state.
      valid = false;
    } finally {
      if (file) await file.close().catch(() => undefined);
    }
    this.installedKeyAvailable = valid;
    return valid;
  }

  /**
   * The mode, in order of authority: an explicit constructor option, the
   * environment, what this installation recorded the first time it enforced,
   * and finally the safe default.
   *
   * Recording the mode is what stops "delete the key file" from downgrading a
   * licensed installation: the file's own memory says it was enforcing.
   */
  private resolveEnforcement(): void {
    if (this.enforcementExplicit) return;

    // An installed copy enforces, always - even if its key file has been
    // removed, in which case no key can verify and the installation stays
    // blocked until it is repaired. Nothing in the environment can turn this
    // off: those two files are written by Setup into a folder the person using
    // the program cannot change.
    if (this.installedDirectory) {
      if (!this.publicKeyPrint) {
        this.logger.error(
          'This installation is meant to enforce licences but its public key file ' +
            'is missing, so no licence can be verified. Business operations stay ' +
            'blocked until the installation is repaired.',
        );
      }
      this.enforcement = 'enforce';
      this.store.update((state) => {
        state.enforcement = this.enforcement;
      });
      return;
    }

    const env = (process.env.LICENSE_ENFORCEMENT ?? '').trim().toLowerCase();
    if (env === 'off' || env === 'warn' || env === 'enforce') {
      this.enforcement = env;
    } else if (this.store.current.enforcement) {
      this.enforcement = this.store.current.enforcement;
    } else {
      this.enforcement = this.publicKeyPrint ? 'enforce' : 'warn';
    }

    // The recorded mode can be raised, never lowered: once this installation
    // has enforced licences, an environment variable set by the person using
    // the program cannot quietly return it to "warn".
    if (this.store.current.enforcement === 'enforce' && this.enforcement !== 'enforce') {
      this.logger.warn(
        `Refusing to lower licence enforcement from enforce to ${this.enforcement}: ` +
          'this installation already enforced licences.',
      );
      this.enforcement = 'enforce';
    }

    this.store.update((state) => {
      state.enforcement = this.enforcement;
    });
  }

  // ──────────────────────────────────────────────────────────────── identity

  /**
   * This computer's licence identity, as recorded for this installation.
   *
   * The recorded identity is kept in the protected licence folder so that a
   * temporary failure of a *weaker* signal (a registry read, a disabled
   * network adapter) can never quietly change who this computer is and
   * invalidate a licence that is still correct.
   */
  machineId(): string {
    // Resolved once per process: the licence screens ask for it on every
    // status call, and the answer cannot change while the program runs.
    if (this.resolvedMachineId) return this.resolvedMachineId;
    if (this.machineIdOverride) {
      this.resolvedMachineId = this.machineIdOverride;
      return this.machineIdOverride;
    }
    const recorded = this.readRecordedMachineId();
    const resolved = machineIdentity();
    const choice = chooseMachineIdentity(recorded, resolved);
    if (choice.reusedRecorded && recorded !== resolved.id) {
      this.logger.warn(
        `The machine identity could not be read from the strongest source; keeping the identity recorded for this installation (${recorded}).`,
      );
    }
    this.recordMachineId(choice.id, recorded);
    this.resolvedMachineId = choice.id;
    return choice.id;
  }

  private machineIdPath(): string {
    return join(this.directory, 'machine-id');
  }

  private readRecordedMachineId(): string | null {
    try {
      const text = readFileSync(this.machineIdPath(), 'utf8').trim();
      return /^KM-[A-Z0-9-]{8,}$/.test(text) ? text : null;
    } catch {
      return null;
    }
  }

  private recordMachineId(id: string, recorded: string | null): void {
    if (recorded === id || this.machineIdWriteFailed) return;
    try {
      // Atomic replace, so a power cut cannot leave a half-written identity.
      const temp = `${this.machineIdPath()}.${process.pid}.tmp`;
      writeFileSync(temp, `${id}\n`, { mode: 0o600 });
      renameSync(temp, this.machineIdPath());
    } catch (error) {
      // A directory this program cannot write is reported by the state store
      // itself; identity must still work for this run, and a warning per
      // request would only bury the real error.
      this.machineIdWriteFailed = true;
      this.logger.warn(
        `The machine identity could not be recorded: ${describeError(error)}`,
      );
    }
  }

  installId(): string {
    return this.store.current.installId;
  }

  // ──────────────────────────────────────────────────────────────── status

  async status(options: { fresh?: boolean } = {}): Promise<LicenseStatus> {
    await this.ensureReady();
    const keyAvailable = await this.verificationKeyAvailable();
    const cached = this.lastStatus;
    if (
      !options.fresh &&
      cached &&
      cached.value.configured === keyAvailable &&
      this.clock().getTime() - cached.at < STATUS_CACHE_MS
    ) {
      return cached.value;
    }

    await this.runClockCheck(false);

    const row = await this.licenseRow();
    const used = await this.usedSeats();
    const now = this.clock();
    const store = this.store.current;

    let state: LicenseState;
    if (!row) state = 'UNLICENSED';
    else if (row.status === 'SUSPENDED' || store.clockState === 'TAMPERED') {
      state = 'SUSPENDED';
    } else if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
      state = 'EXPIRED';
    } else {
      state = 'ACTIVE';
    }

    const expiresAt = row?.expiresAt ?? null;
    const perpetual = row ? isPerpetual(row.expiresAt) : false;
    const days = daysRemaining(expiresAt, now);
    const limit = row?.seatLimit ?? 0;
    const blocked =
      this.enforcement === 'enforce' && (state !== 'ACTIVE' || !keyAvailable);

    const value: LicenseStatus = {
      state,
      blocked,
      enforcement: this.enforcement,
      configured: keyAvailable,
      licenseId: row?.licenseId ?? store.licenseId,
      machineId: this.machineId(),
      installId: store.installId,
      issuedAt: row?.issuedAt?.toISOString() ?? null,
      startsAt: row?.startsAt?.toISOString() ?? null,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      perpetual,
      daysRemaining: perpetual ? null : days,
      expiringSoon: perpetual ? false : days !== null && days <= 14 && state === 'ACTIVE',
      seats: {
        limit,
        used,
        available: limit > 0 ? Math.max(limit - used, 0) : null,
      },
      clock: {
        state: store.clockState === 'OK' && row?.clockState === 'WARNING'
          ? 'WARNING'
          : store.clockState,
        lastSeenAt: store.lastSeenAt,
        note: row?.clockNote ?? null,
      },
      publicKeyFingerprint: this.publicKeyPrint,
      requestCode: this.requestCodeObject().code,
      serverTime: now.toISOString(),
    };
    this.lastStatus = { at: now.getTime(), value };
    return value;
  }

  /**
   * What the desktop shell may know before anybody has signed in: whether this
   * copy enforces licences, and whether a verification key is installed.
   *
   * It reads memory only - no database, no clock check - because it is served
   * from the health route, which must answer even when the database cannot.
   * The shell compares it with what the installation's settings demand and
   * refuses to open the program against a server that quietly stopped
   * enforcing (turning LICENSE_ENFORCEMENT down and pointing the program at a
   * second server is otherwise a working way round the licence).
   */
  licenseSummary(): { enforcement: EnforcementMode; configured: boolean; stateError?: 'LICENSE_STATE_DAMAGED' } {
    // Retry in the background when an operator has restored a trusted backup.
    // Never make the health route wait for the database. Until bootstrap has
    // actually completed it continues to report the failure and fail closed.
    if (this.installedStateError && !this.ready) {
      void this.ensureReady().catch(() => undefined);
    }
    return {
      enforcement: this.enforcement,
      configured: this.installedDirectory ? this.installedKeyAvailable : Boolean(this.publicKeyPrint),
      ...(this.installedStateError ? { stateError: this.installedStateError } : {}),
    };
  }

  async isBlocked(): Promise<boolean> {
    try {
      const status = await this.status();
      return status.blocked;
    } catch (error) {
      // The licence could not be read at all. A failure to establish that a
      // licence is valid is never permission to work: the guard blocks and the
      // reason is logged, and the licence/backup/sign-in routes stay reachable
      // so the installation can be put right without losing anything.
      this.logger.error(
        `The licence state could not be read, so business operations are blocked: ${(error as Error).message}`,
      );
      return true;
    }
  }

  requestCodeObject(): { code: string; request: ActivationRequest } {
    const request: ActivationRequest = {
      v: 1,
      machineId: this.machineId(),
      installId: this.store ? this.store.current.installId : 'unknown',
      appVersion: this.appVersion,
      requestedAt: this.clock().toISOString(),
      nonce: randomBytes(8).toString('hex'),
    };
    return { code: buildRequestCode(request), request };
  }

  async requestCode(): Promise<{ code: string; machineId: string; appVersion: string }> {
    await this.ensureReady();
    const { code } = this.requestCodeObject();
    return { code, machineId: this.machineId(), appVersion: this.appVersion };
  }

  // ──────────────────────────────────────────────────────────────── keys

  private async assertVerificationKey(): Promise<void> {
    if (!(await this.verificationKeyAvailable())) {
      throw new ServiceUnavailableException({
        detail: 'The installed licence verification key is unavailable or does not match the protected fingerprint. Preserve the data and contact support.',
        code: 'LICENSE_PUBLIC_KEY_MISSING',
      });
    }
  }

  activate(key: string, actor: LicenseActor = {}): Promise<LicenseStatus> {
    return this.applyKey(key, 'ACTIVATION', actor);
  }

  renew(key: string, actor: LicenseActor = {}): Promise<LicenseStatus> {
    return this.applyKey(key, 'RENEWAL', actor);
  }

  addSeats(key: string, actor: LicenseActor = {}): Promise<LicenseStatus> {
    return this.applyKey(key, 'SEATS', actor);
  }

  transfer(key: string, actor: LicenseActor = {}): Promise<LicenseStatus> {
    return this.applyKey(key, 'TRANSFER', actor);
  }

  private async applyKey(
    rawKey: string,
    expected: LicensePayload['type'],
    actor: LicenseActor,
  ): Promise<LicenseStatus> {
    await this.ensureReady();
    await this.assertVerificationKey();
    const parsed = this.verify(rawKey);
    const payload = parsed.payload;

    // The type is part of what the operator signed. A seats key presented as
    // an activation key (or the reverse) is refused here, before any row is
    // touched, so it cannot become a second grant of something else.
    if (payload.type !== expected) {
      throw new ForbiddenException({
        detail:
          `This is a ${describeType(payload.type)} key, and this screen applies ` +
          `${describeType(expected)} keys. Use the matching screen.`,
        code: 'LICENSE_KEY_WRONG_TYPE',
      });
    }

    const now = this.clock();
    const issuedAt = new Date(payload.issuedAt);
    if (issuedAt.getTime() > now.getTime() + 86_400_000) {
      throw new ForbiddenException({
        detail:
          'This key is dated in the future relative to this computer. Check the date and time of the machine, then try again.',
        code: 'LICENSE_KEY_FUTURE',
      });
    }

    const existing = await this.licenseRow();
    const replay = await this.prisma.licenseKeyRecord.findUnique({
      where: { keyId: payload.keyId },
    });
    if (replay) {
      throw new ForbiddenException({
        detail:
          'This key was already used on this installation. A key is spent once it has been applied; ask the supplier for a new one.',
        code: 'LICENSE_KEY_ALREADY_USED',
      });
    }
    if (
      existing &&
      this.store.current.appliedKeys.includes(payload.keyId)
    ) {
      throw new ForbiddenException({
        detail:
          'This key was already used on this installation. A key is spent once it has been applied; ask the supplier for a new one.',
        code: 'LICENSE_KEY_ALREADY_USED',
      });
    }

    if (payload.type === 'ACTIVATION' || payload.type === 'TRANSFER') {
      if (payload.machineId !== this.machineId()) {
        throw new ForbiddenException({
          detail:
            'This key was issued for a different computer. Send the supplier the activation code shown on this screen so a key for this machine can be issued.',
          code: 'LICENSE_KEY_WRONG_MACHINE',
        });
      }
    }
    if (payload.type !== 'ACTIVATION' && existing) {
      if (existing.licenseId !== payload.licenseId) {
        throw new ForbiddenException({
          detail:
            'This key belongs to a different licence from the one installed on this computer.',
          code: 'LICENSE_KEY_WRONG_LICENSE',
        });
      }
    }
    // A renewal or a seat increase changes something that must already be
    // there. A transfer is the opposite: it arrives on a machine that has no
    // licence precisely because the licence is being moved onto it.
    if (
      (payload.type === 'RENEWAL' || payload.type === 'SEATS') &&
      !existing
    ) {
      throw new ForbiddenException({
        detail:
          'There is no licence on this computer to change. Apply a new activation key first.',
        code: 'LICENSE_NOT_INSTALLED',
      });
    }
    if (payload.type === 'ACTIVATION' && existing) {
      throw new ForbiddenException({
        detail:
          'This computer already holds a licence. Use a renewal key to extend it or a seat key to raise the limit; a second activation key would replace nothing.',
        code: 'LICENSE_ALREADY_ACTIVE',
      });
    }
    if (payload.type === 'TRANSFER' && !payload.state) {
      throw new ForbiddenException({
        detail: 'The transfer key carries no licence state to move.',
        code: 'LICENSE_KEY_INCOMPLETE',
      });
    }

    const used = await this.usedSeats();
    // Recheck after asynchronous preflight work, immediately before starting
    // a transaction that would spend the key or alter licence entitlements.
    await this.assertVerificationKey();

    const result = await this.prisma.$transaction(async (tx) => {
      // Writing the key first is the anti-replay lock: the unique keyId makes
      // a concurrent second attempt with the same key fail before it can
      // grant anything.
      await tx.licenseKeyRecord.create({
        data: {
          keyId: payload.keyId,
          licenseId: payload.licenseId,
          type: payload.type,
          payloadJson: parsed.payloadJson,
          machineId: payload.machineId,
          appliedBy: actor.userId ?? null,
          ipAddress: actor.ipAddress ?? null,
          note: payload.note ?? null,
        },
      });

      switch (payload.type) {
        case 'ACTIVATION':
          return this.insertOrUpdateOnActivation(tx, payload, used, now);
        case 'RENEWAL':
          return this.applyRenewal(tx, payload, existing!, now);
        case 'SEATS':
          return this.applySeats(tx, payload, existing!, used);
        case 'TRANSFER':
          return this.applyTransfer(tx, payload, used);
        default:
          throw new ForbiddenException({
            detail: 'The key type is not supported by this version.',
            code: 'LICENSE_KEY_WRONG_TYPE',
          });
      }
    });

    // The file watermarks are written after the transaction commits: they are
    // a second, independent record, not the transaction itself.
    this.store.update((state) => {
      state.appliedKeys = [...state.appliedKeys, payload.keyId];
      state.licenseId = payload.licenseId;
      state.maxSeatsUsed = Math.max(state.maxSeatsUsed, result.seatsUsed);
      state.maxSeatLimit = Math.max(state.maxSeatLimit, result.seatLimit);
      if (result.perpetual) {
        state.perpetual = true;
        state.licenseExpiresAt = null;
      } else if (result.expiresAt) {
        const previous = state.licenseExpiresAt
          ? new Date(state.licenseExpiresAt)
          : null;
        if (!previous || result.expiresAt > previous) {
          state.licenseExpiresAt = result.expiresAt.toISOString();
        }
      }
      state.clockState = 'OK';
      state.clockSuspects = [];
      state.lastSeenAt = now.toISOString();
    });

    this.lastStatus = null;
    await this.prisma.licenseEvent.create({
      data: {
        licenseId: payload.licenseId,
        type: payload.type,
        detail:
          `key ${payload.keyId} applied` +
          (result.expiresAt
            ? `; expires ${result.expiresAt.toISOString()}`
            : '; perpetual') +
          `; seats ${result.seatLimit}`,
      },
    });
    this.logger.log(
      `${payload.type} key ${payload.keyId} applied for licence ${payload.licenseId}: seats ${result.seatLimit}, ${
        result.expiresAt ? `expires ${result.expiresAt.toISOString()}` : 'perpetual'
      }`,
    );
    // A new key is exactly the moment a verified copy is worth keeping: the
    // state just changed, and an older backup would no longer describe it.
    this.captureLicenceBackup(`licence-${payload.type.toLowerCase()}`);
    return this.status({ fresh: true });
  }

  private verify(rawKey: string): ParsedLicenseKey {
    if (!this.publicKeyPem) {
      throw new ServiceUnavailableException({
        detail:
          'This installation has no licence verification key, so it cannot check any key. The program was not built for issuing licences; install the public key supplied with the product.',
        code: 'LICENSE_PUBLIC_KEY_MISSING',
      });
    }
    try {
      return verifyKey(rawKey, loadPublicKey(this.publicKeyPem));
    } catch (error) {
      if (error instanceof LicenseKeyError) {
        throw new ForbiddenException({
          detail: error.message,
          code: `LICENSE_KEY_${error.code}`,
        });
      }
      throw error;
    }
  }

  // ──────────────────────────────────────────────── per-type application

  private async insertOrUpdateOnActivation(
    tx: PrismaLike,
    payload: LicensePayload,
    used: number,
    now: Date,
  ): Promise<AppliedOutcome> {
    const term = payload.term!;
    const startsAt = now;
    const expiresAt = activationEnd(term, startsAt);
    const seatLimit =
      payload.seats && payload.seats.mode !== 'PRESERVE'
        ? payload.seats.value
        : 0;

    await tx.licenseInstallation.create({
      data: {
        licenseId: payload.licenseId,
        machineId: payload.machineId!,
        customerRef: payload.note ?? null,
        issuedAt: new Date(payload.issuedAt),
        startsAt,
        expiresAt,
        seatLimit,
        status: 'ACTIVE',
        lastKeyId: payload.keyId,
        lastSeenAt: now,
        clockState: 'OK',
      },
    });
    // Rows written before a licence existed (the migration's backfill and any
    // account created during first-run setup) now belong to this licence.
    await tx.licenseSeatUsage.updateMany({
      where: { licenseId: null },
      data: { licenseId: payload.licenseId },
    });
    return {
      expiresAt,
      seatLimit: Math.max(seatLimit, used),
      seatsUsed: Math.max(used, 0),
      perpetual: isPerpetual(expiresAt),
    };
  }

  private async applyRenewal(
    tx: PrismaLike,
    payload: LicensePayload,
    existing: LicenseRow,
    now: Date,
  ): Promise<AppliedOutcome> {
    const term = payload.term!;
    let expiresAt: Date | null;
    if (term.kind === 'PERPETUAL') {
      // An operator may turn a temporary licence permanent. It is a renewal
      // in the sense that it replaces the end date, and it is explicit.
      expiresAt = null;
    } else {
      expiresAt = renewalEnd(existing.expiresAt, term.months, now);
    }
    await tx.licenseInstallation.update({
      where: { licenseId: existing.licenseId },
      data: {
        expiresAt,
        status: 'ACTIVE',
        lastKeyId: payload.keyId,
        lastSeenAt: now,
        clockState: 'OK',
        clockNote: null,
      },
    });
    return {
      expiresAt,
      seatLimit: existing.seatLimit,
      seatsUsed: await this.seatsUsedInTx(tx, existing.seatLimit),
      perpetual: isPerpetual(expiresAt),
    };
  }

  private async applySeats(
    tx: PrismaLike,
    payload: LicensePayload,
    existing: LicenseRow,
    used: number,
  ): Promise<AppliedOutcome> {
    const grant = payload.seats!;
    const limit =
      grant.mode === 'INCREASE'
        ? existing.seatLimit + grant.value
        : grant.value;
    if (limit < used) {
      throw new ForbiddenException({
        detail:
          `This key would set the seat limit to ${limit}, but ${used} account(s) ` +
          'are already in use and a removed account never returns its seat. ' +
          'Ask the supplier for a key that covers at least that many.',
        code: 'LICENSE_SEATS_BELOW_USED',
      });
    }
    await tx.licenseInstallation.update({
      where: { licenseId: existing.licenseId },
      data: {
        seatLimit: limit,
        lastKeyId: payload.keyId,
        lastSeenAt: this.clock(),
      },
    });
    return {
      expiresAt: existing.expiresAt,
      seatLimit: limit,
      seatsUsed: used,
      perpetual: isPerpetual(existing.expiresAt),
    };
  }

  private async applyTransfer(
    tx: PrismaLike,
    payload: LicensePayload,
    used: number,
  ): Promise<AppliedOutcome> {
    const state = payload.state!;
    if (state.seatLimit < used) {
      throw new ForbiddenException({
        detail:
          `The licence being moved records ${state.seatLimit} seat(s), but this ` +
          `installation already holds ${used} account(s). Ask the supplier for a ` +
          'seat key for the new machine before transferring.',
        code: 'LICENSE_SEATS_BELOW_USED',
      });
    }
    const expiresAt = state.expiresAt ? new Date(state.expiresAt) : null;
    const data = {
      machineId: payload.machineId!,
      issuedAt: new Date(state.issuedAt),
      startsAt: new Date(state.startsAt),
      expiresAt,
      seatLimit: state.seatLimit,
      status: 'ACTIVE',
      lastKeyId: payload.keyId,
      lastSeenAt: this.clock(),
      clockState: 'OK',
      clockNote: null,
    };
    await tx.licenseInstallation.upsert({
      where: { licenseId: payload.licenseId },
      create: { licenseId: payload.licenseId, ...data },
      update: data,
    });
    await tx.licenseSeatUsage.updateMany({
      where: { licenseId: null },
      data: { licenseId: payload.licenseId },
    });
    // The new machine may not have had every account the old one had at the
    // moment of transfer (for instance when the backup is still coming). The
    // generator's count is authoritative; make up the difference with a
    // marker row so the customer cannot create those seats again.
    const local = await tx.licenseSeatUsage.count();
    if (state.seatsUsed > local) {
      for (let index = local; index < state.seatsUsed; index += 1) {
        await tx.licenseSeatUsage.create({
          data: {
            licenseId: payload.licenseId,
            username: `(transferred ${index + 1})`,
            reason: 'TRANSFER_WATERMARK',
          },
        });
      }
    }
    return {
      expiresAt,
      seatLimit: state.seatLimit,
      seatsUsed: Math.max(local, state.seatsUsed),
      perpetual: isPerpetual(expiresAt),
    };
  }

  // ──────────────────────────────────────────────────────────────── seats

  /**
   * Reserves one seat inside the caller's transaction.
   *
   * The advisory lock is what makes concurrent creations safe: two requests
   * that arrive together are serialised on this key, so the second one counts
   * the first one's row and is refused when the limit is reached. A unique
   * idempotency key makes a retried request a no-op rather than a second seat.
   */
  async reserveSeat(
    tx: PrismaLike,
    input: ReserveSeatInput,
  ): Promise<{ reserved: boolean; alreadyApplied: boolean; used: number; limit: number }> {
    await this.ensureReady();
    // `pg_advisory_xact_lock` returns void, which the query API cannot
    // deserialize; `$executeRawUnsafe` runs the same statement and reports the
    // row count, which is all this needs. The lock is held until the caller's
    // transaction ends.
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext('kayan.license.seats'))",
    );

    if (input.idempotencyKey) {
      const prior = await tx.licenseSeatUsage.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (prior) {
        const row = await this.licenseRowIn(tx);
        return {
          reserved: false,
          alreadyApplied: true,
          used: await tx.licenseSeatUsage.count(),
          limit: row?.seatLimit ?? 0,
        };
      }
    }

    const row = await this.licenseRowIn(tx);
    const limit = row?.seatLimit ?? 0;
    let used = await tx.licenseSeatUsage.count();

    // A restored backup can leave the database behind the file watermark.
    // The difference is written back as marker rows so every later count sees
    // the same number, and no seat is quietly handed back.
    const watermark = this.store.current.maxSeatsUsed;
    if (watermark > used) {
      for (let index = used; index < watermark; index += 1) {
        await tx.licenseSeatUsage.create({
          data: {
            licenseId: row?.licenseId ?? null,
            username: `(restored ${index + 1})`,
            reason: 'RESTORE_WATERMARK',
          },
        });
      }
      used = watermark;
    }

    if (limit > 0 && used >= limit) {
      throw new ForbiddenException({
        detail:
          `This licence allows ${limit} user account(s) and all of them are in use. ` +
          'Deleting or deactivating an account does not return its seat. Ask the ' +
          'supplier for a seat-increase key, then apply it on the licence screen.',
        code: 'LICENSE_SEATS_EXHAUSTED',
        license: { limit, used, available: 0 },
      });
    }

    await tx.licenseSeatUsage.create({
      data: {
        licenseId: row?.licenseId ?? null,
        userId: input.userId,
        username: input.username,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    // Written before the caller's transaction commits on purpose: if that
    // transaction rolls back, the watermark is one seat too high, which can
    // only ever refuse a seat, never grant a free one. A failure to write the
    // file must not fail the account creation.
    try {
      this.store.update((state) => {
        state.maxSeatsUsed = Math.max(state.maxSeatsUsed, used + 1);
        state.maxSeatLimit = Math.max(state.maxSeatLimit, limit);
      });
    } catch (error) {
      this.logger.error(
        `Seat ${used + 1} was reserved but the licence state file could not be updated: ${(error as Error).message}`,
      );
    }
    this.lastStatus = null;
    return { reserved: true, alreadyApplied: false, used: used + 1, limit };
  }

  private async seatsUsedInTx(tx: PrismaLike, _limit: number): Promise<number> {
    const count = await tx.licenseSeatUsage.count();
    return Math.max(count, this.store.current.maxSeatsUsed);
  }

  async usedSeats(): Promise<number> {
    const count = await this.prisma.licenseSeatUsage.count();
    return Math.max(count, this.store.current.maxSeatsUsed);
  }

  // ─────────────────────────────────────────────────────────── clock & restore

  /**
   * Compares the wall clock with the highest moment this installation was
   * last seen at, and with the newest licence event in the database.
   *
   * A clock a few minutes behind is a drifting CMOS battery. A clock days
   * behind, seen more than once, is someone moving the date back to get past
   * an expiry - and a restored database whose newest event is in the future
   * is the same thing done by restore.
   */
  async runClockCheck(force: boolean): Promise<void> {
    const now = this.clock();
    const elapsed = now.getTime() - this.lastClockCheck;
    // A negative elapsed time means the clock moved backwards since the last
    // check: that is exactly the moment to check, not a reason to wait.
    if (!force && elapsed >= 0 && elapsed < CLOCK_CHECK_INTERVAL_MS) {
      return;
    }
    this.lastClockCheck = now.getTime();

    const store = this.store.current;
    const dbRow = await this.licenseRow();
    const lastSeenCandidates: Date[] = [];
    if (store.lastSeenAt) lastSeenCandidates.push(new Date(store.lastSeenAt));
    if (dbRow?.lastSeenAt) lastSeenCandidates.push(dbRow.lastSeenAt);

    const newestEvent = await this.prisma.licenseEvent.findFirst({
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    if (newestEvent?.occurredAt) lastSeenCandidates.push(newestEvent.occurredAt);

    const newestUser = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (newestUser?.createdAt) lastSeenCandidates.push(newestUser.createdAt);

    const lastSeen = lastSeenCandidates.reduce<Date | null>(
      (latest, candidate) =>
        !latest || candidate.getTime() > latest.getTime() ? candidate : latest,
      null,
    );

    if (!lastSeen) {
      this.advance(now);
      return;
    }

    const rollback = lastSeen.getTime() - now.getTime();
    if (rollback < CLOCK_WARN_MS) {
      this.advance(now);
      return;
    }

    const suspects = [
      ...store.clockSuspects.filter(
        (at) => now.getTime() - new Date(at).getTime() < CLOCK_SUSPECT_WINDOW_MS,
      ),
      now.toISOString(),
    ];
    const known = store.clockState === 'TAMPERED';
    const major = rollback >= CLOCK_MAJOR_MS;
    const repeated = suspects.length >= CLOCK_SUSPECT_LIMIT;
    const tampered = known || major || repeated;

    const note =
      `The system date (${now.toISOString()}) is ${Math.round(
        rollback / 3_600_000,
      )} hour(s) earlier than the last time this program was seen running ` +
      `(${lastSeen.toISOString()}).`;

    this.store.update((state) => {
      state.clockSuspects = suspects;
      state.clockState = tampered ? 'TAMPERED' : 'WARNING';
      state.lastSeenAt = lastSeen.toISOString();
    });

    if (tampered) {
      if (dbRow && dbRow.status !== 'SUSPENDED') {
        await this.prisma.licenseInstallation.update({
          where: { licenseId: dbRow.licenseId },
          data: { status: 'SUSPENDED', clockState: 'TAMPERED', clockNote: note },
        });
      }
      await this.prisma.licenseEvent.create({
        data: {
          licenseId: dbRow?.licenseId ?? store.licenseId,
          type: 'CLOCK_TAMPERED',
          detail: note,
        },
      });
      this.logger.error(`Clock check: ${note} The licence is suspended.`);
    } else {
      if (dbRow && dbRow.clockState !== 'WARNING') {
        await this.prisma.licenseInstallation.update({
          where: { licenseId: dbRow.licenseId },
          data: { clockState: 'WARNING', clockNote: note },
        });
      }
      await this.prisma.licenseEvent.create({
        data: {
          licenseId: dbRow?.licenseId ?? store.licenseId,
          type: 'CLOCK_WARNING',
          detail: note,
        },
      });
      this.logger.warn(`Clock check: ${note}`);
    }
    this.lastStatus = null;
  }

  private advance(now: Date): void {
    const store = this.store.current;
    if (!store.lastSeenAt || now.getTime() > new Date(store.lastSeenAt).getTime()) {
      this.store.update((state) => {
        state.lastSeenAt = now.toISOString();
        if (state.clockState === 'WARNING') {
          state.clockState = 'OK';
          state.clockSuspects = [];
        }
      });
    }
  }

  /**
   * Called at startup and after every restore.
   *
   * Repairs the database from the watermarks when the database is behind:
   * a restored backup is older than the licence it carries, and the customer
   * must not be able to re-spend seats or lose a term they were granted.
   */
  async reconcile(): Promise<void> {
    if (!this.ensureReadyUnlessBootstrapping()) return;
    const row = await this.licenseRow();
    const store = this.store.current;
    const used = await this.prisma.licenseSeatUsage.count();

    this.store.update((state) => {
      state.maxSeatsUsed = Math.max(state.maxSeatsUsed, used);
      if (row) {
        state.maxSeatLimit = Math.max(state.maxSeatLimit, row.seatLimit);
        state.licenseId = row.licenseId;
        if (row.expiresAt) {
          const previous = state.licenseExpiresAt
            ? new Date(state.licenseExpiresAt)
            : null;
          if (!previous || row.expiresAt.getTime() > previous.getTime()) {
            state.licenseExpiresAt = row.expiresAt.toISOString();
          }
        } else {
          state.perpetual = true;
        }
      }
    });

    if (!row) return;

    let changed = false;

    // The store remembers a longer term than the database: the database came
    // back from an older backup (or was reset), so the term is restored.
    if (this.store.current.perpetual && row.expiresAt !== null) {
      await this.prisma.licenseInstallation.update({
        where: { licenseId: row.licenseId },
        data: { expiresAt: null },
      });
      changed = true;
    } else if (
      row.expiresAt &&
      this.store.current.licenseExpiresAt &&
      new Date(this.store.current.licenseExpiresAt).getTime() >
        row.expiresAt.getTime()
    ) {
      await this.prisma.licenseInstallation.update({
        where: { licenseId: row.licenseId },
        data: { expiresAt: new Date(this.store.current.licenseExpiresAt) },
      });
      changed = true;
    }
    if (this.store.current.maxSeatLimit > row.seatLimit) {
      await this.prisma.licenseInstallation.update({
        where: { licenseId: row.licenseId },
        data: { seatLimit: this.store.current.maxSeatLimit },
      });
      changed = true;
    }

    if (changed) {
      await this.prisma.licenseEvent.create({
        data: {
          licenseId: row.licenseId,
          type: 'RESTORED_FROM_WATERMARK',
          detail:
            'The database was behind the licence watermarks (a restored copy or a reset); the term and seat limit were restored from the protected state file.',
        },
      });
      this.lastStatus = null;
    }
  }

  /**
   * Called from bootstrap(), before `ready` resolves - so it must not wait on
   * `ready`, and must do nothing at all if the store never opened. Returns
   * false in that case so the caller skips its work instead of dereferencing
   * a store that does not exist.
   */
  private ensureReadyUnlessBootstrapping(): boolean {
    return Boolean(this.store);
  }

  /** Lets an administrator who has fixed the clock clear a suspension. */
  async confirmClock(actor: LicenseActor): Promise<LicenseStatus> {
    await this.ensureReady();
    await this.assertVerificationKey();
    const row = await this.licenseRow();
    if (!row) {
      throw new ForbiddenException({
        detail: 'There is no licence on this computer.',
        code: 'LICENSE_NOT_INSTALLED',
      });
    }
    const now = this.clock();
    const store = this.store.current;
    const lastSeen = store.lastSeenAt ? new Date(store.lastSeenAt) : null;
    if (lastSeen && now.getTime() < lastSeen.getTime() - CLOCK_WARN_MS) {
      throw new ForbiddenException({
        detail:
          'The system date is still earlier than the last recorded run. Correct the date and time of this computer first, then confirm again.',
        code: 'LICENSE_CLOCK_STILL_BEHIND',
      });
    }
    await this.prisma.licenseInstallation.update({
      where: { licenseId: row.licenseId },
      data: { status: 'ACTIVE', clockState: 'OK', clockNote: null },
    });
    this.store.update((state) => {
      state.clockState = 'OK';
      state.clockSuspects = [];
      state.lastSeenAt = now.toISOString();
    });
    await this.prisma.licenseEvent.create({
      data: {
        licenseId: row.licenseId,
        type: 'CLOCK_CONFIRMED',
        detail: `clock confirmed at ${now.toISOString()} by ${
          actor.userId ?? 'an administrator'
        }`,
      },
    });
    this.lastStatus = null;
    return this.status({ fresh: true });
  }

  async events(limit = 50): Promise<
    Array<{ type: string; detail: string | null; occurredAt: string }>
  > {
    const rows = await this.prisma.licenseEvent.findMany({
      orderBy: { occurredAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((row) => ({
      type: row.type,
      detail: row.detail,
      occurredAt: row.occurredAt.toISOString(),
    }));
  }

  // ──────────────────────────────────────────────────────────────── helpers

  /** True when the licence is enforced. */
  isEnforced(): boolean {
    return this.enforcement === 'enforce';
  }

  private async licenseRow(): Promise<LicenseRow | null> {
    const row = await this.prisma.licenseInstallation.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    return row ?? null;
  }

  private async licenseRowIn(tx: PrismaLike): Promise<LicenseRow | null> {
    const row = await tx.licenseInstallation.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    return row ?? null;
  }
}

type LicenseRow = {
  licenseId: string;
  machineId: string;
  seatLimit: number;
  expiresAt: Date | null;
  issuedAt: Date;
  startsAt: Date;
  status: string;
  clockState: string;
  clockNote: string | null;
  lastSeenAt: Date | null;
};

type AppliedOutcome = {
  expiresAt: Date | null;
  seatLimit: number;
  seatsUsed: number;
  perpetual: boolean;
};

/** The subset of Prisma's transaction client this service uses. */
export type PrismaLike = {
  $executeRawUnsafe(query: string): Promise<number>;
  licenseInstallation: {
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
    findFirst(args: unknown): Promise<LicenseRow | null>;
  };
  licenseKeyRecord: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
  };
  licenseSeatUsage: {
    create(args: unknown): Promise<unknown>;
    count(): Promise<number>;
    findUnique(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
  };
  licenseEvent: { create(args: unknown): Promise<unknown> };
};

function describeType(type: LicensePayload['type']): string {
  switch (type) {
    case 'ACTIVATION':
      return 'new activation';
    case 'RENEWAL':
      return 'renewal';
    case 'SEATS':
      return 'seat increase';
    case 'TRANSFER':
      return 'licence transfer';
  }
}

/**
 * The licence folder Setup creates on a Windows installation, or null when
 * this copy was never installed.
 *
 * `C:\ProgramData` is spelled out first rather than read from the environment:
 * the environment belongs to whoever launched the program, and this is the one
 * path in the product that must not be redirectable by the person using it.
 * The folder is created with write access for Administrators and the
 * PostgreSQL service account only, so an ordinary user cannot replace the
 * public key or rewrite the recorded enforcement. The environment is consulted
 * only when the standard folder is absent, which keeps installations on a
 * computer whose Windows drive is not C: working.
 */
export function installedLicenceDirectory(): string | null {
  if (platform() !== 'win32') return null;
  const candidates: string[] = ['C:\\ProgramData\\KAYAN-ERP\\license'];
  if (process.env.ProgramData) {
    candidates.push(join(process.env.ProgramData, 'KAYAN-ERP', 'license'));
  }
  for (const candidate of candidates) {
    // The folder alone proves nothing: any run of the program creates it for
    // its state file. It is the installer's two files that say this copy is
    // meant to require a licence - the operator's public key, and the marker
    // that records enforcement was switched on. Both are written by Setup
    // into a folder only Administrators can change.
    if (
      existsSync(join(candidate, 'public-key.pem')) ||
      existsSync(join(candidate, 'enforcement.required'))
    ) {
      return candidate;
    }
  }
  return null;
}

/** The text of a file, or null when it is absent or unreadable. */
function readTextIfPresent(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Where the protected state lives when nothing says otherwise. */
export function defaultStateDirectory(): string {
  if (process.env.ProgramData) {
    return join(process.env.ProgramData, 'KAYAN-ERP', 'license');
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '.';
  return join(home, '.kayan', 'license');
}

function readBackendVersion(): string {
  // One level from src/, one more from dist/src/.
  for (const relative of ['../../../package.json', '../../../../package.json']) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require(relative) as { version?: string };
      if (pkg?.version) return pkg.version;
    } catch {
      // Try the next layout.
    }
  }
  return '0.0.0';
}

/** A failure line that is never empty, even for a driver error with no text. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const name = error.name || 'Error';
    const message = error.message || String(error);
    return code ? `${name} ${String(code)}: ${message}` : `${name}: ${message}`;
  }
  return String(error);
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function base32(buffer: Buffer, length: number): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && output.length < length) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (output.length >= length) break;
  }
  return output;
}

/**
 * A machine id the operator can ask for over the phone: stable across
 * restarts, hostname changes and network changes on Windows (it is built from
 * the registry's MachineGuid), and short enough to read aloud.
 *
 * It is derived, not stored, so it needs no file and cannot drift between the
 * service and the desktop shell. Reinstalling Windows changes the MachineGuid;
 * that is a new machine id and needs a transfer key, by design.
 */
export type MachineIdentitySource = 'machine-guid' | 'host-mac';

export interface MachineIdentity {
  id: string;
  /** How the identity was derived; `host-mac` is the weaker fallback. */
  source: MachineIdentitySource;
}

/**
 * Derives this computer's licence identity.
 *
 * On Windows the identity is the machine's own GUID, which is stable across
 * reinstalls, updates and disk repairs and does not depend on the company name,
 * the database or anything the user can edit. Everywhere else (development) it
 * is a hash of the platform, the host name and the first non-virtual MAC
 * address - enough to keep a test machine distinct, never used to sell a
 * licence.
 */
export function machineIdentity(): MachineIdentity {
  const parts: string[] = [platform(), arch()];
  const guid = windowsMachineGuid();
  if (guid) {
    parts.push(`guid:${guid}`);
  } else {
    parts.push(`host:${hostname()}`);
    const mac = firstMacAddress();
    if (mac) parts.push(`mac:${mac}`);
  }
  const digest = createHash('sha256').update(parts.join('|')).digest();
  const body = base32(digest, 20);
  return {
    source: guid ? 'machine-guid' : 'host-mac',
    id: `KM-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(
      12,
      16,
    )}-${body.slice(16, 20)}`,
  };
}

export function machineFingerprint(): string {
  return machineIdentity().id;
}

/**
 * Decides which identity to use, given what was recorded for this installation.
 *
 * The rule that matters: a *weaker* source must never replace a recorded
 * identity. If the registry read fails, or a network adapter is disabled, the
 * fallback hash changes - and silently adopting it would invalidate a licence
 * that is perfectly valid. So the recorded identity wins over the fallback.
 * A change in the machine GUID itself is a real hardware change and is
 * reported, because hiding it would let one computer's licence appear on
 * another.
 */
export function chooseMachineIdentity(
  recorded: string | null,
  resolved: MachineIdentity,
): { id: string; reusedRecorded: boolean } {
  if (recorded && resolved.source !== 'machine-guid') {
    return { id: recorded, reusedRecorded: recorded !== resolved.id };
  }
  return { id: resolved.id, reusedRecorded: false };
}

function windowsMachineGuid(): string | null {
  if (platform() !== 'win32') return null;
  try {
    const output = execFileSync(
      'reg',
      [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid',
      ],
      { encoding: 'utf8', timeout: 3_000, windowsHide: true },
    );
    const match = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{16,})/.exec(output);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function firstMacAddress(): string | null {
  const interfaces = networkInterfaces();
  const names = Object.keys(interfaces).sort();
  for (const name of names) {
    for (const entry of interfaces[name] ?? []) {
      if (entry.internal) continue;
      if (!entry.mac || entry.mac === '00:00:00:00:00:00') continue;
      return entry.mac.toLowerCase();
    }
  }
  return null;
}
