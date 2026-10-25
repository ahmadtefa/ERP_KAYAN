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
import { arch, hostname, networkInterfaces, platform } from 'node:os';
import { join } from 'node:path';

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
}

@Injectable()
export class LicensingService implements OnModuleInit {
  private readonly logger = new Logger('Licensing');
  private readonly directory: string;
  private readonly publicKeyTextOverride: string | null;
  private readonly clock: () => Date;
  private readonly appVersion: string;
  private readonly machineIdOverride: string | null;

  private trustStore?: LicenseStore;
  private enforcementExplicit = false;
  private store!: LicenseStore;
  private storeQuarantined = false;
  private publicKeyPem: string | null = null;
  private publicKeyPrint: string | null = null;
  private enforcement: EnforcementMode = 'warn';
  private lastClockCheck = 0;
  private lastStatus: { at: number; value: LicenseStatus } | null = null;
  private ready: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // Not a provider: the options are a plain object the tests pass in, so
    // Nest must not try to resolve it from the container.
    @Optional() options: LicensingOptions = {},
  ) {
    this.directory =
      options.directory ??
      process.env.LICENSE_STATE_DIR ??
      defaultStateDirectory();
    this.publicKeyTextOverride = options.publicKeyText ?? null;
    this.clock = options.clock ?? (() => new Date());
    this.appVersion =
      options.appVersion ??
      process.env.KAYAN_APP_VERSION ??
      readBackendVersion();
    this.machineIdOverride =
      options.machineId ?? ((process.env.LICENSE_MACHINE_ID ?? '').trim() || null);
    this.trustStore = options.trustStore;
    if (options.enforcement) {
      this.enforcement = options.enforcement;
      this.enforcementExplicit = true;
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
    this.logger.log(
      `Licence mode ${this.enforcement}; public key ${
        this.publicKeyPrint ?? 'none'
      }; machine ${this.machineId()}`,
    );
  }

  private openStore(): void {
    try {
      this.store = this.trustStore ?? new LicenseStore(this.directory);
    } catch (error) {
      if (error instanceof LicenseStateError && error.code === 'TAMPERED') {
        // A state file that fails its integrity check is a signal, not a
        // reason to brick the installation: move it aside, keep the database
        // counters, and record the fact. It is reported as a clock warning so
        // the screen says something is wrong.
        this.storeQuarantined = true;
        const quarantine = `${join(
          this.directory,
          `license-state.quarantined-${Date.now()}.json`,
        )}`;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const fs = require('node:fs') as typeof import('node:fs');
          fs.renameSync(join(this.directory, 'license-state.json'), quarantine);
        } catch {
          // Nothing to move, or no permission: the fresh store still works.
        }
        this.logger.error(
          `The licence state failed its integrity check and was set aside (${error.message}). Starting a new one; the database counters still apply.`,
        );
        this.store = new LicenseStore(this.directory);
      } else {
        throw error;
      }
    }
  }

  private loadKey(): void {
    const candidates: string[] = [];
    if (this.publicKeyTextOverride) candidates.push(this.publicKeyTextOverride);
    const inline = (process.env.LICENSE_PUBLIC_KEY ?? '').trim();
    if (inline) candidates.push(inline);
    const file =
      (process.env.LICENSE_PUBLIC_KEY_FILE ?? '').trim() ||
      join(this.directory, 'public-key.pem');
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('node:fs') as typeof import('node:fs');
      if (fs.existsSync(file)) candidates.push(fs.readFileSync(file, 'utf8'));
    } catch {
      // An unreadable key file is the same as no key: reported below.
    }

    for (const candidate of candidates) {
      try {
        const key = loadPublicKey(candidate);
        this.publicKeyPem = candidate;
        this.publicKeyPrint = publicKeyFingerprint(key);
        this.store.update((state) => {
          state.publicKeyFingerprint = this.publicKeyPrint;
        });
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
   * The mode, in order of authority: an explicit constructor option, the
   * environment, what this installation recorded the first time it enforced,
   * and finally the safe default.
   *
   * Recording the mode is what stops "delete the key file" from downgrading a
   * licensed installation: the file's own memory says it was enforcing.
   */
  private resolveEnforcement(): void {
    if (this.enforcementExplicit) return;
    const env = (process.env.LICENSE_ENFORCEMENT ?? '').trim().toLowerCase();
    if (env === 'off' || env === 'warn' || env === 'enforce') {
      this.enforcement = env;
    } else if (this.store.current.enforcement) {
      this.enforcement = this.store.current.enforcement;
    } else {
      this.enforcement = this.publicKeyPrint ? 'enforce' : 'warn';
    }
    this.store.update((state) => {
      state.enforcement = this.enforcement;
    });
  }

  // ──────────────────────────────────────────────────────────────── identity

  machineId(): string {
    if (this.machineIdOverride) return this.machineIdOverride;
    return machineFingerprint();
  }

  installId(): string {
    return this.store.current.installId;
  }

  // ──────────────────────────────────────────────────────────────── status

  async status(options: { fresh?: boolean } = {}): Promise<LicenseStatus> {
    await this.ensureReady();
    const cached = this.lastStatus;
    if (
      !options.fresh &&
      cached &&
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
      this.enforcement === 'enforce' && state !== 'ACTIVE';

    const value: LicenseStatus = {
      state,
      blocked,
      enforcement: this.enforcement,
      configured: Boolean(this.publicKeyPrint),
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

  async isBlocked(): Promise<boolean> {
    try {
      const status = await this.status();
      return status.blocked;
    } catch (error) {
      // The licence could not be read at all. Blocking every screen on a
      // database hiccup would be worse than the risk it protects against, so
      // the guard lets the request through and the failure is logged.
      this.logger.error(
        `The licence state could not be read: ${(error as Error).message}`,
      );
      return false;
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
export function machineFingerprint(): string {
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
  return `KM-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(
    12,
    16,
  )}-${body.slice(16, 20)}`;
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
