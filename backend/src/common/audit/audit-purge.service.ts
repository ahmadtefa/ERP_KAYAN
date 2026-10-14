import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Deleting the audit trail, on purpose, with a reason.
 *
 * The audit trail is append-only in the database itself: a trigger refuses
 * every UPDATE and every DELETE unless the session has announced that it is a
 * purge (`kayan.allow_audit_purge`). That guard exists so that no ordinary user
 * — and no ordinary code path — can quietly rewrite the history of who did
 * what.
 *
 * Two operations genuinely have to remove rows from that trail, and only two:
 *
 *   * restoring a company's JSON backup over the company it replaces;
 *   * resetting a company's data to the first-run state.
 *
 * Both are destructive by design, both take a verified backup first, both are
 * behind an administrator permission, and both must leave a record that they
 * happened. This service is the only place in the program that turns the
 * trigger's guard off, and it does so under four rules:
 *
 *  1. **Inside the caller's transaction.** `set_config(..., is_local = true)`
 *     lasts exactly as long as the transaction that set it. It cannot leak to
 *     another connection, another request or the process itself; if the
 *     transaction rolls back, the setting is gone with it.
 *  2. **Around the deletion and nothing else.** The guard covers the rows
 *     being removed and the statements that removal drags with it: deleting a
 *     user makes PostgreSQL itself issue `UPDATE audit_logs SET "userId" =
 *     NULL` for its `ON DELETE SET NULL` foreign key — and the trigger refuses
 *     *every* UPDATE, whether the guard is on or not, because an edit is an
 *     edit and history is not to be rewritten. Those references are therefore
 *     cleared before the owner row goes, by [detachUserLinks], which takes the
 *     rows out under the guard and writes them straight back unchanged except
 *     for the cleared column. It goes back on before the same transaction
 *     starts writing, so a restore's inserts and a reset's bookkeeping run
 *     under the full protection.
 *  3. **Never without a reason.** An empty reason is a programming error and
 *     is refused, so a purge can never be anonymous in the code.
 *  4. **Never silently.** The purge writes its own audit row, in the same
 *     transaction, naming the operation, the caller, the row count and the
 *     reason. If that insert fails the whole transaction fails: a purge that
 *     cannot be recorded does not happen.
 *
 * Nothing outside this file sets that setting, and nothing but the two
 * administrator operations above calls this service. A raw SQL DELETE issued
 * anywhere else — a psql window, a migration, a query in a controller — still
 * hits the trigger and is still refused, and no UPDATE anywhere is ever
 * allowed.
 */
export const AUDIT_PURGE_SETTING = 'kayan.allow_audit_purge';

/// What a purge is for. Kept as a closed set so an unexpected caller cannot
/// invent its own reason string.
export type AuditPurgeReason =
  | 'company-json-restore'
  | 'company-data-reset';

export interface AuditPurgeRequest {
  /// The company whose trail is being purged. `null` purges the rows that
  /// belong to no company (a failed sign-in against a username that does not
  /// exist is recorded that way) and is only used by a full reset.
  companyId: string | null;
  reason: AuditPurgeReason;
  /// Who asked for it, so the record names a person rather than an event.
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /// Anything else worth keeping with the record (a file name, a summary).
  detail?: Record<string, unknown>;
}

const REASONS: readonly AuditPurgeReason[] = [
  'company-json-restore',
  'company-data-reset',
];

/// Extras for [AuditPurgeService.purge]. Passed separately from the request
/// because they do not describe the purge, they describe what the caller is
/// about to do next.
export interface AuditPurgeOptions {
  /// The users of this company are deleted by the caller, in this same
  /// transaction, after the purge. Their links in the surviving trail are
  /// cleared first — see [AuditPurgeService.detachUserLinks].
  detachLinksToUsersOf?: string | null;
}

@Injectable()
export class AuditPurgeService {
  private readonly logger = new Logger('AuditPurge');

  /// Names the scratch tables of [detachUserLinks] uniquely, so two detachments
  /// in one transaction cannot read each other's rows.
  private detachments = 0;

  /// Turns the guard off for the rest of the transaction. The caller must put
  /// it back with [closeGuard] in a `finally`, so a thrown error cannot leave
  /// it open for the rest of the work.
  async openGuard(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$queryRawUnsafe(
      `SELECT set_config('${AUDIT_PURGE_SETTING}', 'on', true)`,
    );
  }

  /// Turns the guard back on. The setting is transaction-local, so a rollback
  /// would clear it anyway; saying so explicitly narrows the window to the
  /// statements that genuinely need it.
  async closeGuard(tx: Prisma.TransactionClient): Promise<void> {
    await tx
      .$queryRawUnsafe(`SELECT set_config('${AUDIT_PURGE_SETTING}', 'off', true)`)
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not switch the audit guard back on inside the transaction: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /// Removes the rows a purge is allowed to remove and writes the record of
  /// having done so. Assumes the guard is already off — either because the
  /// caller opened it with [openGuard], or because [purge] did.
  ///
  /// `options.record = false` removes the rows without announcing them yet;
  /// the caller then owes [recordPurge] in the same transaction. A restore does
  /// that, because its record names the administrator and the restore deletes
  /// and re-creates every account of the company: the row has to be written
  /// once the accounts are back.
  async removeTrail(
    tx: Prisma.TransactionClient,
    request: AuditPurgeRequest,
    options: { record?: boolean } = {},
  ): Promise<number> {
    this.assertAllowed(request);

    const result = await tx.auditLog.deleteMany({
      where: request.companyId ? { companyId: request.companyId } : {},
    });
    const deleted = result.count;

    if (options.record === false) {
      this.logger.warn(
        `Audit trail purged for ${
          request.companyId ?? 'rows without a company'
        } (${request.reason}): ${deleted} row(s) removed; the record follows ` +
          'before this transaction ends',
      );
      return deleted;
    }

    await this.recordPurge(tx, request, deleted);
    return deleted;
  }

  /// The account a trail row is allowed to point at, or `null`.
  ///
  /// A restore replaces a company's accounts with the accounts in the file, so
  /// the administrator who asked for it may no longer exist by the time the
  /// record is written. The identifier then stays out of the foreign key (the
  /// row is written with no user) and travels in the record's own JSON instead:
  /// the trail still says who asked, and the database is never asked to point
  /// at a person who is not there.
  async actorUserIdFor(
    tx: Prisma.TransactionClient,
    candidate?: string | null,
  ): Promise<string | null> {
    if (!candidate) return null;
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT id FROM users WHERE id = $1::uuid LIMIT 1',
      candidate,
    );
    return rows.length > 0 ? candidate : null;
  }

  /// Writes the purge into the trail — the row that says an operation erased
  /// history, who asked for it, and how much went.
  ///
  /// Written in the caller's transaction: an operation that erases the trail
  /// must not be able to erase the fact that it did. If this insert fails, the
  /// whole transaction fails.
  async recordPurge(
    tx: Prisma.TransactionClient,
    request: AuditPurgeRequest,
    removedRows: number,
  ): Promise<void> {
    this.assertAllowed(request);

    const actor = await this.actorUserIdFor(tx, request.actorUserId);

    await tx.auditLog.create({
      data: {
        companyId: request.companyId,
        userId: actor,
        action: 'AUDIT_PURGED',
        entity: 'audit_logs',
        entityId: request.companyId,
        ipAddress: request.ipAddress ?? null,
        userAgent: request.userAgent ?? null,
        afterJson: {
          reason: request.reason,
          removedRows,
          // When the account that asked for the purge is itself gone, the
          // record keeps its identifier without pointing the foreign key at a
          // person who does not exist.
          ...(request.actorUserId && !actor
            ? { actorAccountId: request.actorUserId }
            : {}),
          ...(request.detail ?? {}),
        } as never,
      },
    });

    this.logger.warn(
      `Audit trail purged for ${
        request.companyId ?? 'rows without a company'
      } (${request.reason}): ${removedRows} row(s) removed, the purge recorded`,
    );
  }

  /// Removes the rows and records it, opening and closing the guard around the
  /// work. The one-shot form, for an operation that has nothing else to delete.
  async purge(
    tx: Prisma.TransactionClient,
    request: AuditPurgeRequest,
    options: AuditPurgeOptions = {},
  ): Promise<number> {
    this.assertAllowed(request);
    await this.openGuard(tx);
    try {
      // The caller is about to delete the company's users in this same
      // transaction. Their references in the trail are cleared first, or the
      // foreign key's own UPDATE runs into the trigger (see [detachUserLinks]).
      let effective = request;
      if (options.detachLinksToUsersOf) {
        const detached = await this.detachUserLinks(tx, options.detachLinksToUsersOf, {
          // The company's own rows are deleted a moment later anyway.
          keepCompanyId: options.detachLinksToUsersOf,
        });
        effective = {
          ...request,
          detail: { ...(request.detail ?? {}), detachedLinksToUsers: detached },
        };
      }
      return await this.removeTrail(tx, effective);
    } finally {
      await this.closeGuard(tx);
    }
  }

  /// Clears `audit_logs.userId` on the rows that point at a user of
  /// [usersCompanyId].
  ///
  /// Why this exists. `audit_logs.userId` is declared `ON DELETE SET NULL`, so
  /// deleting one of those users makes PostgreSQL run `UPDATE audit_logs SET
  /// "userId" = NULL` by itself — and the append-only trigger refuses every
  /// UPDATE, by design and without asking about any guard: an edit is an edit,
  /// and history must not be rewritable. The reference is therefore cleared the
  /// only way history allows. The affected rows are copied to a temporary
  /// table, deleted under the audited guard and written straight back with the
  /// same `id`, the same `createdAt` and the same content, minus the link to a
  /// person who is about to stop existing. The end state is exactly the one the
  /// foreign key was asking for; the rows themselves are never edited.
  ///
  /// Rows of the company being wiped are left alone ([`keepCompanyId`]): they
  /// are deleted a moment later and rewriting them would be wasted work.
  ///
  /// Must be called inside a transaction that has the guard open and that also
  /// performs the user deletion, so the window never outlives the operation.
  async detachUserLinks(
    tx: Prisma.TransactionClient,
    usersCompanyId: string,
    options: { keepCompanyId?: string | null } = {},
  ): Promise<number> {
    const doomed = `SELECT id FROM users WHERE "companyId" = $1::uuid`;
    const keep = options.keepCompanyId
      ? ` AND "companyId" IS DISTINCT FROM $2::uuid`
      : '';
    const values = options.keepCompanyId
      ? [usersCompanyId, options.keepCompanyId]
      : [usersCompanyId];
    const columns =
      'id, "companyId", "userId", action, entity, "entityId", "beforeJson", ' +
      '"afterJson", "ipAddress", "userAgent", "createdAt"';
    const scratch = `kayan_audit_links_${(this.detachments += 1)}`;

    await tx.$executeRawUnsafe(
      `CREATE TEMP TABLE ${scratch} ON COMMIT DROP AS ` +
        `SELECT ${columns} FROM audit_logs WHERE "userId" IN (${doomed})${keep}`,
      ...values,
    );
    const cleared = await tx.$executeRawUnsafe(
      `DELETE FROM audit_logs WHERE "userId" IN (${doomed})${keep}`,
      ...values,
    );
    if (cleared > 0) {
      await tx.$executeRawUnsafe(
        `INSERT INTO audit_logs (${columns}) ` +
          `SELECT id, "companyId", NULL, action, entity, "entityId", "beforeJson", ` +
          `"afterJson", "ipAddress", "userAgent", "createdAt" FROM ${scratch}`,
      );
      this.logger.warn(
        `Audit trail: cleared the user link on ${cleared} row(s) that pointed at ` +
          `a user of company ${usersCompanyId}; the rows themselves were kept.`,
      );
    }
    return cleared;
  }

  private assertAllowed(request: AuditPurgeRequest): void {
    if (!request || !REASONS.includes(request.reason)) {
      throw new BadRequestException(
        'An audit purge needs one of the operations that is allowed to perform it.',
      );
    }
  }
}
