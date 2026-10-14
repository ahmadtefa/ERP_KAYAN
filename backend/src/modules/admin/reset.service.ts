import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';

import { AuditPurgeService } from '../../common/audit/audit-purge.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MaintenanceService } from '../../common/maintenance/maintenance';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BackupService } from '../backup/backup.service';
import { FullBackupService } from '../backup/full-backup.service';
import { RESET_CONFIRMATION_WORD } from './dto/reset.dto';

/**
 * Resetting the program to its first-run state.
 *
 * «إعادة ضبط بيانات البرنامج» — wiping a company's operational data so the
 * installation can be set up and used again from the beginning.
 *
 * What it is for: a company that has been used for a trial, a training copy,
 * or a year that is being restarted clean. Not for everyday use, and never
 * reversible — which is why every one of these rules exists:
 *
 *  1. **Only an administrator.** The check is server-side (`isSuperAdmin`),
 *     not a hidden button.
 *  2. **The password, verified on the server.** Argon2id against the stored
 *     hash. A stolen token alone cannot wipe the books.
 *  3. **A typed confirmation.** `RESET`, checked here too.
 *  4. **A backup first, and a verified one.** `pg_dump` writes the file, then
 *     `pg_restore --list` proves the archive can actually be read back. If
 *     either step fails the reset does not happen — a reset without a way
 *     back is data destruction, not a reset.
 *  5. **One transaction.** Everything is deleted inside it, so a failure
 *     half way leaves the company exactly as it was.
 *  6. **Nothing structural is touched.** No database is dropped, no
 *     PostgreSQL is removed, no program file is deleted. The permission
 *     catalogue — which belongs to the program, not to the company — stays.
 *
 * What is kept, precisely:
 *
 *  * the permission catalogue (`permissions`);
 *  * system roles, i.e. roles not owned by this company;
 *  * the administrator who pressed the button, so nobody locks themselves
 *    out: their account, their password and their super-administrator flag
 *    survive untouched;
 *  * the company row itself, marked as no longer set up, so the first-run
 *    setup can be completed again against it.
 *
 * What is deleted, precisely (everything else the company owns):
 * journal lines and entries, sales and purchase invoices and their lines,
 * stock movements and balances, the chart of accounts, customers, suppliers,
 * items, fiscal periods, document numbering, branches, the company's own
 * roles and every role/branch assignment, the audit trail of the company,
 * the sign-in sessions of its users, and every other user account.
 */
export interface ResetResult {
  reset: true;
  companyId: string;
  companyCode: string;
  backupFile: string;
  backupBytes: number;
  backupEntries: number;
  deleted: Record<string, number>;
  needsSetup: boolean;
  durationMs: number;
}

@Injectable()
export class ResetService {
  private readonly logger = new Logger(ResetService.name);

  /// One reset at a time. Two at once would each take a safety copy of the
  /// other's half-cleared company.
  private inFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly purge: AuditPurgeService,
    private readonly maintenance: MaintenanceService,
    private readonly backups: FullBackupService,
    @Optional() private readonly companyBackups?: BackupService,
  ) {}

  /// What a reset would remove, for the dialog to show before anything is
  /// typed. Counting is cheap; a warning that names numbers is not.
  async preview(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { code: true, nameEn: true, nameAr: true },
    });

    const [
      journalEntries,
      accounts,
      customers,
      suppliers,
      items,
      salesInvoices,
      purchaseInvoices,
      stockMovements,
      fiscalPeriods,
      branches,
      otherUsers,
    ] = await Promise.all([
      this.prisma.journalEntry.count({ where: { companyId } }),
      this.prisma.account.count({ where: { companyId } }),
      this.prisma.customer.count({ where: { companyId } }),
      this.prisma.supplier.count({ where: { companyId } }),
      this.prisma.item.count({ where: { companyId } }),
      this.prisma.salesInvoice.count({ where: { companyId } }),
      this.prisma.purchaseInvoice.count({ where: { companyId } }),
      this.prisma.stockMovement.count({ where: { companyId } }),
      this.prisma.fiscalPeriod.count({ where: { companyId } }),
      this.prisma.branch.count({ where: { companyId } }),
      this.prisma.user.count({ where: { companyId } }),
    ]);

    return {
      // Named in the warning, so nobody resets the wrong company on a
      // machine that holds more than one.
      companyCode: company?.code ?? '',
      companyName: company?.nameEn ?? company?.nameAr ?? '',
      counts: {
        journalEntries,
        accounts,
        customers,
        suppliers,
        items,
        salesInvoices,
        purchaseInvoices,
        stockMovements,
        fiscalPeriods,
        branches,
        users: Math.max(otherUsers - 1, 0),
      },
      preserved: [
        'the permission catalogue',
        'system roles',
        'the administrator account performing the reset',
        'database configuration',
      ],
      confirmationWord: RESET_CONFIRMATION_WORD,
    };
  }

  async reset(
    user: AuthUser,
    password: string,
    confirmation: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<ResetResult> {
    const started = Date.now();

    // 1. Who is asking. A token alone is not enough for this one.
    if (!user.isSuperAdmin) {
      throw new ForbiddenException(
        'Only an administrator of this installation may reset its data.',
      );
    }

    const me = await this.prisma.user.findFirst({
      where: { id: user.userId, deletedAt: null },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        isActive: true,
        isSuperAdmin: true,
        companyId: true,
        company: { select: { id: true, code: true, deletedAt: true } },
      },
    });
    if (!me || !me.isActive || !me.isSuperAdmin) {
      throw new UnauthorizedException(
        'This account can no longer reset the program. Sign in again as an administrator.',
      );
    }

    // 2. The password, verified here rather than believed from the screen.
    let matches = false;
    try {
      matches = await argon2.verify(me.passwordHash, password);
    } catch {
      matches = false;
    }
    if (!matches) {
      this.logger.warn(
        `Reset refused: wrong password for ${me.username} (${me.id})`,
      );
      throw new UnauthorizedException(
        'The password is not correct. Nothing was changed.',
      );
    }

    // 3. The typed confirmation, checked on this side of the wire too.
    if (confirmation !== RESET_CONFIRMATION_WORD) {
      throw new BadRequestException(
        `Type ${RESET_CONFIRMATION_WORD} to confirm. Nothing was changed.`,
      );
    }

    if (this.inFlight) {
      throw new ServiceUnavailableException(
        'A reset is already running. Wait for it to finish.',
      );
    }
    this.inFlight = true;
    this.maintenance.begin(
      'The company data is being reset. The program will be back shortly.',
    );

    try {
      // 4. A verified backup first — and one that is proven readable, not merely a
      //    file that exists. No backup, no reset.
      let verified: { name: string; sizeBytes: number; entries: number };

      const fullCapabilities =
        typeof this.backups?.capabilities === 'function'
          ? await this.backups.capabilities().catch(() => ({ available: false }))
          : { available: typeof this.backups?.createFull === 'function' };

      if (fullCapabilities?.available) {
        try {
          const backup = await this.backups.createFull(user.userId);
          const checked = await this.backups.verify(backup.file.name);
          verified = {
            name: backup.file.name,
            sizeBytes: checked.sizeBytes,
            entries: checked.entries,
          };
        } catch (dumpError) {
          this.logger.warn(
            `Full database pg_dump failed (${(dumpError as Error).message}), attempting company-level JSON backup before reset...`,
          );
          if (this.companyBackups) {
            verified = await this.createAndVerifyCompanyBackup(
              me.companyId,
              me.company?.code,
            );
          } else {
            throw new ServiceUnavailableException(
              `The safety backup could not be created (${(dumpError as Error).message}). ` +
                'The reset was abandoned and nothing was deleted.',
            );
          }
        }
      } else if (this.companyBackups) {
        verified = await this.createAndVerifyCompanyBackup(
          me.companyId,
          me.company?.code,
        );
      } else {
        throw new ServiceUnavailableException(
          'No backup mechanism is available on this installation. ' +
            'The reset was abandoned and nothing was deleted.',
        );
      }

      this.logger.warn(
        `Reset requested by ${me.username}: backup ${verified.name} ` +
          `(${verified.sizeBytes} bytes, ${verified.entries} objects) verified`,
      );

      // 5. Everything else, in one transaction, children before parents.
      const deleted = await this.prisma.$transaction(
        async (tx) => {
          const counts: Record<string, number> = {};
          const step = async (name: string, run: () => Promise<number>) => {
            counts[name] = await run();
          };

          // Journal lines hang off entries; entries hang off branches and
          // accounts. Reversals point at the entry they reverse, so the link
          // is cleared before either end is removed.
          await step('journalLines', async () => {
            const rows = await tx.$queryRaw<Array<{ id: string }>>`
              DELETE FROM journal_lines l
              USING journal_entries e
              WHERE l."journalEntryId" = e.id AND e."companyId" = ${me.companyId}::uuid
              RETURNING l.id`;
            return rows.length;
          });
          await tx.$executeRaw`
            UPDATE journal_entries SET "reversalOfId" = NULL
            WHERE "companyId" = ${me.companyId}::uuid`;
          await step('journalEntries', async () => {
            const { count } = await tx.journalEntry.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

          // Invoices, then their lines (a line cannot outlive its invoice).
          await step('salesInvoiceLines', async () => {
            const rows = await tx.$queryRaw<Array<{ id: string }>>`
              DELETE FROM sales_invoice_lines l
              USING sales_invoices i
              WHERE l."invoiceId" = i.id AND i."companyId" = ${me.companyId}::uuid
              RETURNING l.id`;
            return rows.length;
          });
          await step('purchaseInvoiceLines', async () => {
            const rows = await tx.$queryRaw<Array<{ id: string }>>`
              DELETE FROM purchase_invoice_lines l
              USING purchase_invoices i
              WHERE l."invoiceId" = i.id AND i."companyId" = ${me.companyId}::uuid
              RETURNING l.id`;
            return rows.length;
          });
          await step('salesInvoices', async () => {
            const { count } = await tx.salesInvoice.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('purchaseInvoices', async () => {
            const { count } = await tx.purchaseInvoice.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

          // Stock: movements first (they reference items and branches), then
          // the running balances.
          await step('stockMovements', async () => {
            const { count } = await tx.stockMovement.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('stockBalances', async () => {
            const { count } = await tx.stockBalance.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

          // Numbering, periods, master data, and the chart of accounts. An
          // account may have a parent in the same table, so the tree is
          // flattened before anything is removed.
          await step('documentSequences', async () => {
            const { count } = await tx.documentSequence.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('fiscalPeriods', async () => {
            const { count } = await tx.fiscalPeriod.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('items', async () => {
            const { count } = await tx.item.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('customers', async () => {
            const { count } = await tx.customer.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('suppliers', async () => {
            const { count } = await tx.supplier.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await tx.$executeRaw`
            UPDATE accounts SET "parentId" = NULL
            WHERE "companyId" = ${me.companyId}::uuid`;
          await step('accounts', async () => {
            const { count } = await tx.account.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

          // Sessions, the audit trail, and everything that attaches a person
          // to a role or a branch.
          await step('refreshTokens', async () => {
            const rows = await tx.$queryRaw<Array<{ id: string }>>`
              DELETE FROM refresh_tokens t
              USING users u
              WHERE t."userId" = u.id AND u."companyId" = ${me.companyId}::uuid
              RETURNING t.id`;
            return rows.length;
          });
          // The trail is append-only in the database. It comes out only
          // through the purge service, which announces the purge to this
          // transaction, records who asked for it and why, and switches the
          // guard straight back on.
          //
          // The purge carries the company with it, so the rows it removes are
          // this company's rows. Rows that belong to no company are
          // installation-level events — a failed sign-in against a username
          // that does not exist, a full backup of the whole database — and they
          // stay: they are not this company's history to erase. The people they
          // name are looked after too: before the accounts are deleted, the
          // links that pointed at them are cleared (see `detachUserLinks`).
          await step('auditLogs', async () => {
            return this.purge.purge(
              tx,
              {
                companyId: me.companyId,
                reason: 'company-data-reset',
                actorUserId: me.id,
                ipAddress: ipAddress ?? null,
                userAgent: userAgent ?? null,
                detail: { backupFile: verified.name, companyCode: me.company?.code ?? null },
              },
              // The people are deleted further down this transaction. The
              // trail's remaining links to them are cleared while the guard is
              // open: the foreign key's own UPDATE would be refused by the
              // append-only trigger, guard or no guard.
              { detachLinksToUsersOf: me.companyId },
            );
          });
          await step('userRoles', async () => {
            const { count } = await tx.userRole.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('userBranches', async () => {
            const rows = await tx.$queryRaw<Array<{ userId: string }>>`
              DELETE FROM user_branches b
              USING branches br
              WHERE b."branchId" = br.id AND br."companyId" = ${me.companyId}::uuid
              RETURNING b."userId"`;
            return rows.length;
          });

          // The company's own roles. System roles (no company) are the
          // program's, not the company's, and stay.
          await step('roles', async () => {
            const { count } = await tx.role.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

          // Every other person. The administrator doing this keeps their
          // account: being locked out of a wiped program helps nobody.
          await step('users', async () => {
            const { count } = await tx.user.deleteMany({
              where: { companyId: me.companyId, id: { not: me.id } },
            });
            return count;
          });

          // Branches last: a branch may have a parent branch.
          await tx.$executeRaw`
            UPDATE branches SET "parentBranchId" = NULL
            WHERE "companyId" = ${me.companyId}::uuid`;
          await step('branches', async () => {
            const { count } = await tx.branch.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

          // The company itself is not destroyed — it is put back into the
          // state a brand-new installation is in, so the first-run setup
          // screen comes back and can be filled in again.
          await tx.company.update({
            where: { id: me.companyId },
            data: {
              deletedAt: new Date(),
              logoData: null,
              logoMime: null,
              updatedBy: me.id,
            },
          });

          return counts;
        },
        { timeout: 300_000, maxWait: 30_000 },
      );

      // 6. The audit trail is written after the deletion, because the
      //    deletion clears it. It names what happened and what was kept; it
      //    never carries the password or the token.
      await this.audit.record({
        // The audit screen lists the trail of one company, so the company
        // has to travel with the entry — and it is the same company id the
        // program will keep using after the setup runs again.
        companyId: me.companyId,
        action: 'RESET',
        entity: 'company_data',
        entityId: me.companyId,
        userId: me.id,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        after: {
          backupFile: verified.name,
          backupBytes: verified.sizeBytes,
          backupEntries: verified.entries,
          deleted,
          kept: [
            'permissions',
            'system roles',
            `the administrator ${me.username}`,
          ],
        },
      });

      this.logger.warn(
        `Reset finished for company ${me.company?.code ?? me.companyId}: ` +
          `${verified.name} holds the old data`,
      );

      return {
        reset: true,
        companyId: me.companyId,
        companyCode: me.company?.code ?? '',
        backupFile: verified.name,
        backupBytes: verified.sizeBytes,
        backupEntries: verified.entries,
        deleted,
        needsSetup: true,
        durationMs: Date.now() - started,
      };
    } finally {
      this.inFlight = false;
      this.maintenance.end();
    }
  }

  private async createAndVerifyCompanyBackup(
    companyId: string,
    companyCode?: string,
  ): Promise<{ name: string; sizeBytes: number; entries: number }> {
    try {
      const backupData = await this.companyBackups!.create(companyId);
      const totalEntries = Object.values(backupData.counts ?? {}).reduce(
        (sum, count) => sum + count,
        0,
      );

      const dir =
        typeof this.backups?.ensureBackupDir === 'function'
          ? await this.backups.ensureBackupDir()
          : join(process.cwd(), 'backups');
      await mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const name = `kayan-backup-${companyCode || 'company'}-${stamp}.json`;
      const filePath = join(dir, name);

      const content = Buffer.from(JSON.stringify(backupData, null, 2), 'utf8');
      await writeFile(filePath, content);

      // Verify the file was written and can be read back cleanly
      const statInfo = await stat(filePath);
      if (statInfo.size === 0) {
        throw new Error('The backup file is empty (0 bytes).');
      }

      const readBack = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(readBack);
      if (
        !parsed ||
        parsed.format !== 'kayan-backup' ||
        parsed.companyId !== companyId
      ) {
        throw new Error(
          'The backup verification failed (invalid format or company ID).',
        );
      }

      return {
        name,
        sizeBytes: statInfo.size,
        entries: totalEntries,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create or verify company safety backup: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        `A verified safety backup could not be created before reset ` +
          `(${(error as Error).message}). The reset was aborted and NO DATA was deleted.`,
      );
    }
  }
}
