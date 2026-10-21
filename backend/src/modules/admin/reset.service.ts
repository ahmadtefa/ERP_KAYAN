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
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { basename, join } from 'path';

import { AuditPurgeService } from '../../common/audit/audit-purge.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MaintenanceService } from '../../common/maintenance/maintenance';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BackupService } from '../backup/backup.service';
import { FullBackupService } from '../backup/full-backup.service';
import { uploadsDir } from '../company/company.service';
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
        company: { select: { id: true, code: true, deletedAt: true, logoPath: true } },
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

          // Delete business rows in explicit foreign-key order. In particular,
          // allocations and returns point back at invoices/lines; cash books,
          // opening balances and stock documents point at accounts, parties,
          // branches and warehouses. Clearing the small self-references first
          // keeps the whole reset inside this transaction without cascading to
          // program/runtime data.
          await step('cashVoucherAllocations', async () => {
            const { count } = await tx.cashVoucherAllocation.deleteMany({
              where: { voucher: { companyId: me.companyId } },
            });
            return count;
          });

          await tx.salesInvoiceLine.updateMany({
            where: { invoice: { companyId: me.companyId } },
            data: { originalLineId: null },
          });
          await tx.salesInvoice.updateMany({
            where: { companyId: me.companyId },
            data: { originalInvoiceId: null },
          });
          await tx.purchaseInvoiceLine.updateMany({
            where: { invoice: { companyId: me.companyId } },
            data: { originalLineId: null },
          });
          await tx.purchaseInvoice.updateMany({
            where: { companyId: me.companyId },
            data: { originalInvoiceId: null },
          });

          // Cash vouchers/transfers and reconciliations all hold restrictive
          // references to cash accounts and other business masters.
          await step('cashVouchers', async () => {
            const { count } = await tx.cashVoucher.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('cashTransfers', async () => {
            const { count } = await tx.cashTransfer.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('bankReconciliations', async () => {
            const { count } = await tx.bankReconciliation.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('cashAccounts', async () => {
            const { count } = await tx.cashAccount.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

          await step('stockDocumentLines', async () => {
            const { count } = await tx.stockDocumentLine.deleteMany({
              where: { document: { companyId: me.companyId } },
            });
            return count;
          });
          await step('stockDocuments', async () => {
            const { count } = await tx.stockDocument.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('openingBalanceLines', async () => {
            const { count } = await tx.openingBalanceLine.deleteMany({
              where: { openingBalance: { companyId: me.companyId } },
            });
            return count;
          });
          await step('openingBalances', async () => {
            const { count } = await tx.openingBalance.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

          await step('salesInvoiceLines', async () => {
            const { count } = await tx.salesInvoiceLine.deleteMany({
              where: { invoice: { companyId: me.companyId } },
            });
            return count;
          });
          await step('purchaseInvoiceLines', async () => {
            const { count } = await tx.purchaseInvoiceLine.deleteMany({
              where: { invoice: { companyId: me.companyId } },
            });
            return count;
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

          await step('salesOrderLines', async () => {
            const { count } = await tx.salesOrderLine.deleteMany({
              where: { order: { companyId: me.companyId } },
            });
            return count;
          });
          await step('purchaseOrderLines', async () => {
            const { count } = await tx.purchaseOrderLine.deleteMany({
              where: { order: { companyId: me.companyId } },
            });
            return count;
          });
          await step('salesOrders', async () => {
            const { count } = await tx.salesOrder.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('purchaseOrders', async () => {
            const { count } = await tx.purchaseOrder.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

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

          // Journal entries have a self-reference for reversals and lines that
          // restrict account/cost-center deletion. Flatten and remove them now.
          await tx.journalEntry.updateMany({
            where: { companyId: me.companyId },
            data: { reversalOfId: null },
          });
          await step('journalLines', async () => {
            const { count } = await tx.journalLine.deleteMany({
              where: { entry: { companyId: me.companyId } },
            });
            return count;
          });
          await step('journalEntries', async () => {
            const { count } = await tx.journalEntry.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

          await step('itemUnits', async () => {
            const { count } = await tx.itemUnit.deleteMany({
              where: { item: { companyId: me.companyId } },
            });
            return count;
          });
          await step('priceListItems', async () => {
            const { count } = await tx.priceListItem.deleteMany({
              where: { priceList: { companyId: me.companyId } },
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
          await step('items', async () => {
            const { count } = await tx.item.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('priceLists', async () => {
            const { count } = await tx.priceList.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('itemCategories', async () => {
            const { count } = await tx.itemCategory.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('costCenters', async () => {
            const { count } = await tx.costCenter.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

          await tx.account.updateMany({
            where: { companyId: me.companyId },
            data: { parentId: null },
          });
          await step('accounts', async () => {
            const { count } = await tx.account.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('companySettings', async () => {
            const { count } = await tx.companySetting.deleteMany({
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
          await step('documentSequences', async () => {
            const { count } = await tx.documentSequence.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

          await step('warehouses', async () => {
            const { count } = await tx.warehouse.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });

          // Revoke every session, including the administrator's; the client
          // signs out as soon as this transaction succeeds.
          await step('refreshTokens', async () => {
            const rows = await tx.$queryRaw<Array<{ id: string }>>`
              DELETE FROM refresh_tokens t
              USING users u
              WHERE t."userId" = u.id AND u."companyId" = ${me.companyId}::uuid
              RETURNING t.id`;
            return rows.length;
          });
          await step('userPermissions', async () => {
            const { count } = await tx.userPermission.deleteMany({
              where: { user: { companyId: me.companyId } },
            });
            return count;
          });
          await step('userRoles', async () => {
            const { count } = await tx.userRole.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          await step('userBranches', async () => {
            const { count } = await tx.userBranch.deleteMany({
              where: { branch: { companyId: me.companyId } },
            });
            return count;
          });
          await step('rolePermissions', async () => {
            const { count } = await tx.rolePermission.deleteMany({
              where: { role: { companyId: me.companyId } },
            });
            return count;
          });

          // The trail is append-only in the database. The purge service is the
          // only permitted path and records the purge before accounts go.
          await step('auditLogs', async () =>
            this.purge.purge(
              tx,
              {
                companyId: me.companyId,
                reason: 'company-data-reset',
                actorUserId: me.id,
                ipAddress: ipAddress ?? null,
                userAgent: userAgent ?? null,
                detail: { backupFile: verified.name, companyCode: me.company?.code ?? null },
              },
              { detachLinksToUsersOf: me.companyId },
            ),
          );

          await step('roles', async () => {
            const { count } = await tx.role.deleteMany({
              where: { companyId: me.companyId },
            });
            return count;
          });
          // Keep the administrator who will complete first-run setup, but do
          // not carry a stale lockout from the company that was just reset.
          await tx.user.update({
            where: { id: me.id },
            data: {
              failedLoginCount: 0,
              lockedUntil: null,
              tokenVersion: { increment: 1 },
            },
          });
          await step('users', async () => {
            const { count } = await tx.user.deleteMany({
              where: { companyId: me.companyId, id: { not: me.id } },
            });
            return count;
          });
          await tx.branch.updateMany({
            where: { companyId: me.companyId },
            data: { parentBranchId: null },
          });
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
              logoPath: null,
              updatedBy: me.id,
            },
          });

          return counts;
        },
        { timeout: 300_000, maxWait: 30_000 },
      );

      // The company logo is business data too. Clear the database reference
      // transactionally above, then remove only its application-managed file.
      if (me.company?.logoPath) {
        await unlink(join(uploadsDir(), basename(me.company.logoPath))).catch(() => {});
      }

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
      await this.companyBackups!.inspect(backupData, companyId);
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
      await writeFile(filePath, content, { mode: 0o600 });

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
      await this.companyBackups!.inspect(parsed, companyId);

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
