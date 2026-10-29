import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { basename, join } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';

import { PeriodStatus, Prisma } from '@prisma/client';

import {
  AuditPurgeRequest,
  AuditPurgeService,
} from '../../common/audit/audit-purge.service';
import { AuditService } from '../../common/audit/audit.service';
import { LicensingService } from '../licensing/licensing.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { reconcileRestoredAccess } from './restore-access';
import {
  LOGO_MAX_BYTES,
  logoDimensions,
  uploadsDir,
  validateLogo,
} from '../company/company.service';

/// The file format. Kept as a constant so a backup taken today can still be
/// recognised by a later version of the program.
export const BACKUP_FORMAT = 'kayan-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  companyId: string;
  companyCode: string;
  companyName: string;
  /// Portable profile fields. The installation-specific company code/ID are
  /// deliberately not restored; they identify the target company, not its
  /// display profile. Older version-1 files may omit this payload.
  companyProfile?: {
    nameEn: string;
    nameAr: string;
    taxId: string | null;
    commercialRegistration: string | null;
    addressEn: string | null;
    addressAr: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    currency: string;
    timezone: string;
    logoBase64: string | null;
    logoMime: string | null;
  };
  counts: Record<string, number>;
  tables: Record<string, Array<Record<string, unknown>>>;
}

/// Who asked for the restore and what they agreed to. The identity travels
/// into the transaction so the audit trail names a person, not an event.
export interface RestoreOptions {
  replace: boolean;
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RestoreSummary {
  companyId: string;
  companyName: string;
  createdAt: string;
  replaced: boolean;
  written: Record<string, number>;
  total: number;
}

/// The database client a restore writes through.
///
/// Reads and the pre-flight counts use the root client; everything a restore
/// deletes or inserts goes through the transaction's own client, so the whole
/// restore is one unit of work. Using the root client inside the transaction —
/// which is what this file used to do — sends each statement to a different
/// connection from the pool, and a failure half way then leaves a company that
/// is neither the old one nor the new one.
type RestoreClient = Prisma.TransactionClient | PrismaService;

/// One table in the backup.
///
/// `company` tables carry a companyId of their own. `child` tables do not -
/// a sales invoice line, for instance, belongs to the company only through its
/// invoice - so they are read and written through their parent.
interface TableSpec {
  /// The name in the file and in the Prisma client.
  model: string;
  scope: 'company' | 'child';
  /// For a child: the table it hangs from and the column that points at it.
  parent?: string;
  foreignKey?: string;
  /// For a child whose parent has no companyId of its own (a journal line
  /// allocation hangs from a journal line, which hangs from the entry). The
  /// relation filter that reaches the company in one step.
  companyWhere?: (companyId: string) => Record<string, unknown>;
  /// Rows of this table may point at another row of the same table (an account
  /// has a parent account). Those are written parents first.
  selfReferencing?: boolean;
  /// The scalar column that names the parent row in this same table.
  selfReferenceField?: string;
}

/// Backs everything up as one JSON file, and puts it back again.
///
/// Why JSON rather than a copy of the database files: the file has to survive
/// being moved to another machine, another PostgreSQL version and another
/// version of this program, and it has to be readable by a person who wants to
/// check what is inside it. A copy of the database files is none of those.
///
/// A backup covers one company. That is the unit a user thinks in, and it
/// means a restore can never quietly mix two companies' books together.
///
/// The order of this list is the order rows are written: everything a row
/// points at comes before it. Restoring in any other order breaks a foreign
/// key, which is exactly what a half-restore looks like.
const TABLES: TableSpec[] = [
  // Insert parents before dependants. Restore deletes this list in reverse,
  // so every foreign-key dependant is removed before its parent.
  {
    model: 'branch',
    scope: 'company',
    selfReferencing: true,
    selfReferenceField: 'parentBranchId',
  },
  { model: 'role', scope: 'company' },
  { model: 'rolePermission', scope: 'child', parent: 'role', foreignKey: 'roleId' },
  { model: 'user', scope: 'company' },
  { model: 'userPermission', scope: 'child', parent: 'user', foreignKey: 'userId' },
  { model: 'userRole', scope: 'company' },
  { model: 'userBranch', scope: 'child', parent: 'user', foreignKey: 'userId' },
  { model: 'fiscalPeriod', scope: 'company' },
  {
    model: 'account',
    scope: 'company',
    selfReferencing: true,
    selfReferenceField: 'parentId',
  },
  { model: 'costCenter', scope: 'company' },
  { model: 'companySetting', scope: 'company' },
  { model: 'priceList', scope: 'company' },
  { model: 'itemCategory', scope: 'company' },
  { model: 'customer', scope: 'company' },
  { model: 'supplier', scope: 'company' },
  { model: 'item', scope: 'company' },
  { model: 'itemUnit', scope: 'child', parent: 'item', foreignKey: 'itemId' },
  { model: 'warehouse', scope: 'company' },
  { model: 'priceListItem', scope: 'child', parent: 'priceList', foreignKey: 'priceListId' },
  { model: 'stockBalance', scope: 'company' },
  { model: 'stockMovement', scope: 'company' },
  {
    model: 'journalEntry',
    scope: 'company',
    selfReferencing: true,
    selfReferenceField: 'reversalOfId',
  },
  { model: 'journalLine', scope: 'child', parent: 'journalEntry', foreignKey: 'journalEntryId' },
  {
    // The split of one journal line across several cost centres. It is not a
    // column on the line: a line can belong to several centres at once, and a
    // backup that dropped these rows would silently move every split amount
    // into "unallocated" when the file was restored.
    model: 'journalLineAllocation',
    scope: 'child',
    companyWhere: (companyId) => ({ line: { entry: { companyId } } }),
  },
  { model: 'salesOrder', scope: 'company' },
  { model: 'salesOrderLine', scope: 'child', parent: 'salesOrder', foreignKey: 'orderId' },
  { model: 'purchaseOrder', scope: 'company' },
  { model: 'purchaseOrderLine', scope: 'child', parent: 'purchaseOrder', foreignKey: 'orderId' },
  {
    model: 'salesInvoice',
    scope: 'company',
    selfReferencing: true,
    selfReferenceField: 'originalInvoiceId',
  },
  {
    model: 'salesInvoiceLine',
    scope: 'child',
    parent: 'salesInvoice',
    foreignKey: 'invoiceId',
    selfReferencing: true,
    selfReferenceField: 'originalLineId',
  },
  {
    model: 'purchaseInvoice',
    scope: 'company',
    selfReferencing: true,
    selfReferenceField: 'originalInvoiceId',
  },
  {
    model: 'purchaseInvoiceLine',
    scope: 'child',
    parent: 'purchaseInvoice',
    foreignKey: 'invoiceId',
    selfReferencing: true,
    selfReferenceField: 'originalLineId',
  },
  { model: 'stockDocument', scope: 'company' },
  { model: 'stockDocumentLine', scope: 'child', parent: 'stockDocument', foreignKey: 'documentId' },
  // Quotations point at the invoice they became, so they follow sales
  // invoices. The content snapshot is a column on the quotation, so an issued
  // offer survives the round trip exactly as it was sent.
  {
    model: 'quotation',
    scope: 'company',
    selfReferencing: true,
    selfReferenceField: 'revisionOfId',
  },
  {
    model: 'quotationTable',
    scope: 'child',
    companyWhere: (companyId) => ({ quotation: { companyId } }),
  },
  {
    model: 'quotationLine',
    scope: 'child',
    companyWhere: (companyId) => ({ table: { quotation: { companyId } } }),
  },
  {
    model: 'quotationEvent',
    scope: 'child',
    companyWhere: (companyId) => ({ quotation: { companyId } }),
  },
  { model: 'openingBalance', scope: 'company' },
  { model: 'openingBalanceLine', scope: 'child', parent: 'openingBalance', foreignKey: 'openingBalanceId' },
  { model: 'cashAccount', scope: 'company' },
  { model: 'bankReconciliation', scope: 'company' },
  { model: 'cashVoucher', scope: 'company' },
  { model: 'cashTransfer', scope: 'company' },
  { model: 'cashVoucherAllocation', scope: 'child', parent: 'cashVoucher', foreignKey: 'voucherId' },
  // The asset register points at accounts, branches and cost centres, all
  // written above; a depreciation charge points at its run and its asset.
  { model: 'fixedAsset', scope: 'company' },
  { model: 'depreciationRun', scope: 'company' },
  { model: 'assetDepreciation', scope: 'company' },
  { model: 'documentSequence', scope: 'company' },
  { model: 'auditLog', scope: 'company' },
];

/// Tables that are deliberately left out, and why. A backup file that silently
/// omits something is worse than one that says what it omits.
const OMITTED: Record<string, string> = {
  permission: 'the list of permissions is part of the program, not of the data',
  refreshToken: 'sign-in sessions should not come back to life when a backup is restored',
  backupRun: 'backup history describes files on this installation, not portable company business data',
};

@Injectable()
export class BackupService {
  private readonly logger = new Logger('BackupService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    /// The one place that is allowed to remove audit rows, and only inside the
    /// caller's transaction, with a reason, and never silently.
    private readonly purge: AuditPurgeService,
    /// The licence is installation-level state that a company file cannot
    /// carry; the restore asks it to re-assert its watermarks afterwards.
    private readonly licensing: LicensingService,
  ) {}

  /// ───────────────────────────────────────────────────────── taking one

  async create(companyId: string): Promise<BackupFile> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new BadRequestException('Company not found');

    const tables: BackupFile['tables'] = {};
    const counts: Record<string, number> = {};

    for (const spec of TABLES) {
      const rows = await this.readTable(this.prisma, spec, companyId);
      tables[spec.model] = rows;
      // A count of zero is noise on the screen and in the file.
      if (rows.length > 0) counts[spec.model] = rows.length;
    }

    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      companyId: company.id,
      companyCode: company.code,
      companyName: company.nameAr ?? company.nameEn,
      companyProfile: {
        nameEn: company.nameEn,
        nameAr: company.nameAr,
        taxId: company.taxId,
        commercialRegistration: company.commercialRegistration,
        addressEn: company.addressEn,
        addressAr: company.addressAr,
        phone: company.phone,
        email: company.email,
        address: company.address,
        currency: company.currency,
        timezone: company.timezone,
        logoBase64: company.logoData
          ? Buffer.from(company.logoData).toString('base64')
          : null,
        logoMime: company.logoData ? company.logoMime : null,
      },
      counts,
      tables,
    };
  }

  /// The sample backup is shipped as a discoverable download, but never
  /// inferred from a caller-supplied path. The first location is the packaged
  /// Windows layout; the second is the repository layout used in development.
  async demoBackup(): Promise<Buffer> {
    const fileName = 'kayan-company-backup-demo.json';
    const paths = [
      join(process.cwd(), 'demo-data', fileName),
      join(process.cwd(), '..', 'demo-data', fileName),
    ];
    for (const path of paths) {
      try {
        const data = await readFile(path);
        let parsed: BackupFile;
        try {
          parsed = JSON.parse(data.toString('utf8')) as BackupFile;
        } catch {
          throw new BadRequestException('The packaged demo company backup is not valid JSON.');
        }
        this.validate(parsed);
        if (parsed.companyCode !== 'DEMO') {
          throw new BadRequestException('The packaged demo company backup has the wrong identity.');
        }
        return data;
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    throw new NotFoundException('The demo company backup is not included in this installation.');
  }

  private delegate(
    client: RestoreClient,
    model: string,
  ): Record<string, any> {
    // Looked up by name so the whole backup is one table list rather than
    // twenty near-identical blocks. Every name in TABLES is a real model.
    return (client as unknown as Record<string, Record<string, any>>)[model];
  }

  private async readTable(
    client: RestoreClient,
    spec: TableSpec,
    companyId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const delegate = this.delegate(client, spec.model);
    if (!delegate?.findMany) return [];

    if (spec.scope === 'company') {
      return (await delegate.findMany({ where: { companyId } })) as Array<
        Record<string, unknown>
      >;
    }

    // A child that reaches the company through two relations is filtered
    // directly: its parent has no companyId to list.
    if (spec.companyWhere) {
      return (await delegate.findMany({
        where: spec.companyWhere(companyId),
      })) as Array<Record<string, unknown>>;
    }

    // A child table is reached through its parent's ids.
    const parent = this.delegate(client, spec.parent as string);
    const parents = (await parent.findMany({
      where: { companyId },
      select: { id: true },
    })) as Array<{ id: string }>;
    if (parents.length === 0) return [];

    const includePermissionCode =
      spec.model === 'rolePermission' || spec.model === 'userPermission';
    const rows = (await delegate.findMany({
      where: { [spec.foreignKey as string]: { in: parents.map((row) => row.id) } },
      ...(includePermissionCode ? { include: { permission: { select: { code: true } } } } : {}),
    })) as Array<Record<string, unknown>>;
    if (!includePermissionCode) return rows;
    return rows.map((row) => {
      const { permission, ...scalars } = row as Record<string, unknown> & {
        permission?: { code?: string } | null;
      };
      return {
        ...scalars,
        ...(permission?.code ? { permissionCode: permission.code } : {}),
      };
    });
  }

  /// ───────────────────────────────────────────────────────── putting one back

  /// Puts a backup file back.
  ///
  /// `replace` decides what happens when the company already holds data. With
  /// it false - the default - the restore refuses rather than merging, because
  /// merging two sets of books produces a third set that never existed.
  async restore(
    file: BackupFile,
    requesterCompanyId: string,
    options: RestoreOptions,
  ): Promise<RestoreSummary> {
    this.validate(file);

    const company = await this.prisma.company.findUnique({
      where: { id: requesterCompanyId },
    });
    if (!company) {
      throw new BadRequestException(
        'The company in this backup does not exist here. Restore it on the installation it came from.',
      );
    }
    const previousLogoPath = company.logoPath;

    const isMatch =
      file.companyId === requesterCompanyId ||
      file.companyCode === company.code ||
      file.companyCode === 'DEMO';

    if (!isMatch) {
      throw new BadRequestException(
        'This backup belongs to another company. Sign in to that company and restore it there.',
      );
    }

    const actor = options.actorUserId &&
      typeof (this.prisma as any).user?.findFirst === 'function'
      ? await (this.prisma as any).user.findFirst({
          where: { id: options.actorUserId, companyId: requesterCompanyId, deletedAt: null },
          select: { id: true, isSuperAdmin: true },
        })
      : null;
    const existing = await this.countExisting(requesterCompanyId);
    const hasData = Object.values(existing).some((count) => count > 0);

    // A backup made by an older app may not contain newer tables. Never
    // interpret a missing table as an instruction to erase live data from it.
    // A complete backup produced by this version includes every TABLES key.
    const missingTablesWithLiveData = Object.entries(existing)
      .filter(([model, count]) => count > 0 && !Array.isArray(file.tables[model]))
      .map(([model]) => model);
    if (missingTablesWithLiveData.length > 0) {
      throw new BadRequestException(
        `This backup is missing tables that currently contain company data: ${missingTablesWithLiveData.join(', ')}. Create a new company backup with the current version before replacing data. Nothing was changed.`,
      );
    }

    if (hasData && !options.replace) {
      throw new BadRequestException(
        `This company already holds data (${describe(existing)}). Confirm that you want to replace it to restore over it.`,
      );
    }

    const written: Record<string, number> = {};
    /// Rows the purge removed, reported by the record written at the end.
    let removedTrailRows = 0;

    // One transaction: a restore that stops half way would leave a company that
    // is neither the old one nor the new one.
    await this.prisma.$transaction(
      async (tx) => {
        // Everything is cleared first, children before parents. An empty
        // company has nothing to clear and the same code runs anyway, so the
        // two paths are the same path.
        // The audit trail is append-only in the database, so removing a
        // company's history needs the one service that is allowed to announce
        // a purge. The guard covers the whole clearing phase rather than the
        // single DELETE: deleting a user makes PostgreSQL itself try to clear
        // that user's `audit_logs.userId` references, and the trigger refuses
        // an UPDATE just as firmly as a DELETE — with or without the guard, by
        // design, because history is not editable. Those references are cleared
        // up front instead (see `detachUserLinks`), the guard goes back on
        // before anything is written, and the purge is recorded inside this
        // transaction.
        let purgeRequest: AuditPurgeRequest;
        await this.purge.openGuard(tx);
        try {
          // Rows that are not this company's but name one of its users survive
          // this restore; they lose the link to a person who is about to be
          // deleted, exactly as the foreign key intended.
          const detached = await this.purge.detachUserLinks(tx, requesterCompanyId, {
            keepCompanyId: requesterCompanyId,
          });

          purgeRequest = {
            companyId: requesterCompanyId,
            reason: 'company-json-restore',
            actorUserId: options.actorUserId ?? null,
            ipAddress: options.ipAddress ?? null,
            userAgent: options.userAgent ?? null,
            detail: {
              fileCompanyCode: file.companyCode,
              detachedLinksToUsers: detached,
            },
          };

          for (const spec of [...TABLES].reverse()) {
            if (spec.model === 'auditLog') {
              // Without the record for now: it names the administrator, and
              // the administrator's account is deleted further down this same
              // phase and put back from the file. See `recordPurge` below.
              removedTrailRows = await this.purge.removeTrail(tx, purgeRequest, {
                record: false,
              });
              continue;
            }
            await this.deleteTable(tx, spec, requesterCompanyId);
          }
        } finally {
          await this.purge.closeGuard(tx);
        }

        for (const spec of TABLES) {
          const rows = file.tables[spec.model] ?? [];
          if (rows.length === 0) continue;
          // Historical documents must pass the same open-period triggers as
          // ordinary inserts. Periods are open only inside this transaction;
          // restore their saved closed state after all dependent rows exist.
          const restoreRows = spec.model === 'fiscalPeriod'
            ? rows.map((row) => row.status === PeriodStatus.CLOSED
                ? { ...row, status: PeriodStatus.OPEN }
                : row)
            : rows;
          await this.insertTable(tx, spec, restoreRows, requesterCompanyId, {
            actorUserId: actor?.id ?? null,
            actorIsSuperAdmin: actor?.isSuperAdmin === true,
          });
          written[spec.model] = rows.length;
        }

        for (const period of file.tables.fiscalPeriod ?? []) {
          if (period.status !== PeriodStatus.CLOSED) continue;
          await tx.fiscalPeriod.updateMany({
            where: { id: String(period.id), companyId: requesterCompanyId },
            data: { status: PeriodStatus.CLOSED },
          });
        }

        // The profile is part of a current company backup, but not of older
        // version-1 files. Keep legacy restore behaviour for files that omit
        // it; when present, restore the portable company details and image
        // without changing the target installation's identity/code.
        if (file.companyProfile) {
          const profile = file.companyProfile;
          const logo = profile.logoBase64 === null
            ? null
            : validateLogo(
                Buffer.from(profile.logoBase64, 'base64'),
                profile.logoMime ?? '',
              );
          await tx.company.update({
            where: { id: requesterCompanyId },
            data: {
              nameEn: profile.nameEn,
              nameAr: profile.nameAr,
              taxId: profile.taxId,
              commercialRegistration: profile.commercialRegistration,
              addressEn: profile.addressEn,
              addressAr: profile.addressAr,
              phone: profile.phone,
              email: profile.email,
              address: profile.address,
              currency: profile.currency,
              timezone: profile.timezone,
              logoData: logo?.data ?? null,
              logoMime: logo?.mime ?? null,
              logoPath: null,
            },
          });
        }

        // The file's role grants are a snapshot of the program that wrote
        // it: a backup made by an older version cannot contain permissions
        // the current version added since, and its user rows replace the
        // current ones wholesale — possibly leaving the company with no
        // super administrator at all, which silently disables the reset and
        // full-backup screens. Reconcile access with the *current* program
        // before anyone signs in to the restored data.
        const access = await reconcileRestoredAccess(tx, requesterCompanyId);

        // The purge is recorded now that the accounts are back, and what was
        // put back is written right after it. Both live where the restore
        // itself cannot erase them: inside the same transaction, after the
        // file's rows are in.
        await this.purge.recordPurge(tx, purgeRequest, removedTrailRows);
        await tx.auditLog.create({
          data: {
            companyId: requesterCompanyId,
            // The administrator may be one of the accounts the file replaced.
            userId: await this.purge.actorUserIdFor(tx, options.actorUserId),
            action: hasData ? 'RESTORE_REPLACE' : 'RESTORE',
            entity: 'company_json_backup',
            entityId: requesterCompanyId,
            ipAddress: options.ipAddress ?? null,
            userAgent: options.userAgent ?? null,
            afterJson: {
              fileCreatedAt: file.createdAt,
              companyCode: file.companyCode,
              written,
              accessReconciled: access,
            } as never,
          },
        });
      },
      // A large restore legitimately takes longer than the default.
      { timeout: 300_000, maxWait: 30_000 },
    );

    if (file.companyProfile && previousLogoPath) {
      await unlink(join(uploadsDir(), basename(previousLogoPath))).catch(() => {});
    }

    // The company file never contains licence rows, and the seat ledger is
    // outside it, so a restore cannot hand seats back. Reconcile anyway: it
    // records the restore in the licence history and proves the counters did
    // not move.
    await this.licensing.reconcile().catch((error: Error) => {
      this.logger.warn(
        `The licence could not be reconciled after the restore: ${error.message}`,
      );
    });

    return {
      companyId: requesterCompanyId,
      companyName: file.companyProfile?.nameAr ?? file.companyName,
      createdAt: file.createdAt,
      replaced: hasData,
      written,
      total: Object.values(written).reduce((sum, count) => sum + count, 0),
    };
  }


  /// What an upload would replace, shown before anything is touched.
  async inspect(file: BackupFile, requesterCompanyId: string) {
    this.validate(file);
    const company = await this.prisma.company.findUnique({
      where: { id: requesterCompanyId },
      select: { code: true },
    });
    return {
      format: file.format,
      version: file.version,
      createdAt: file.createdAt,
      companyName: file.companyName,
      companyCode: file.companyCode,
      belongsToThisCompany:
        file.companyId === requesterCompanyId ||
        (company?.code != null && file.companyCode === company.code) ||
        file.companyCode === 'DEMO',
      contains: file.counts ?? {},
      current: await this.countExisting(requesterCompanyId),
      omitted: OMITTED,
    };
  }

  /// ───────────────────────────────────────────────────────── helpers

  private validate(file: BackupFile): void {
    if (!file || typeof file !== 'object' || file.format !== BACKUP_FORMAT) {
      throw new BadRequestException(
        'This file is not a KAYAN backup. Choose a file that was downloaded from the backup screen.',
      );
    }
    if (
      !Number.isInteger(file.version) ||
      file.version < 1 ||
      file.version > BACKUP_VERSION
    ) {
      throw new BadRequestException(
        `This backup was written by a newer version of the program (format ${file.version}). Update the program first.`,
      );
    }
    if (!file.tables || typeof file.tables !== 'object' || Array.isArray(file.tables)) {
      throw new BadRequestException('The backup file has no tables in it.');
    }
    const supportedTables = new Set(TABLES.map((spec) => spec.model));
    for (const [name, rows] of Object.entries(file.tables)) {
      if (!Array.isArray(rows)) {
        throw new BadRequestException(`The backup table "${name}" must contain a list of rows.`);
      }
      if (!supportedTables.has(name) && rows.length > 0) {
        throw new BadRequestException(
          `The backup contains data for unsupported table "${name}". Use a matching program version; nothing was changed.`,
        );
      }
      for (const [index, row] of rows.entries()) {
        if (!isRow(row)) {
          throw new BadRequestException(
            `The backup row ${index + 1} in table "${name}" must be a JSON object; nothing was changed.`,
          );
        }
      }
    }
    if (!file.companyId || !file.companyCode || !file.createdAt) {
      throw new BadRequestException('The backup is missing its company identity or creation date.');
    }

    if (file.companyProfile !== undefined) {
      const profile = file.companyProfile;
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        throw new BadRequestException('The backup company profile is invalid.');
      }
      if (
        typeof profile.nameEn !== 'string' || !profile.nameEn.trim() ||
        typeof profile.nameAr !== 'string' || !profile.nameAr.trim() ||
        typeof profile.currency !== 'string' || !/^[A-Z]{3}$/.test(profile.currency) ||
        typeof profile.timezone !== 'string' || !profile.timezone.trim()
      ) {
        throw new BadRequestException('The backup company profile is missing its required fields.');
      }
      for (const field of [
        'taxId', 'commercialRegistration', 'addressEn', 'addressAr',
        'phone', 'email', 'address',
      ] as const) {
        const value = profile[field];
        if (value !== null && typeof value !== 'string') {
          throw new BadRequestException(`The backup company profile field "${field}" is invalid.`);
        }
      }

      if (profile.logoBase64 !== null) {
        if (
          typeof profile.logoBase64 !== 'string' ||
          profile.logoBase64.length > Math.ceil(LOGO_MAX_BYTES * 4 / 3) + 4 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(profile.logoBase64)
        ) {
          throw new BadRequestException('The backup company logo is not valid base64.');
        }
        const data = Buffer.from(profile.logoBase64, 'base64');
        if (data.toString('base64') !== profile.logoBase64) {
          throw new BadRequestException('The backup company logo is not valid base64.');
        }
        const logo = validateLogo(data, profile.logoMime ?? '');
        const dimensions = logoDimensions(data, logo.mime);
        if (
          !dimensions || dimensions.width < 32 || dimensions.height < 32 ||
          dimensions.width > 2048 || dimensions.height > 2048
        ) {
          throw new BadRequestException('The backup company logo must be between 32px and 2048px.');
        }
      } else if (profile.logoMime !== null) {
        throw new BadRequestException('The backup company logo type is inconsistent.');
      }
    }
  }

  private async countExisting(companyId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const spec of TABLES) {
      const rows = await this.readTable(this.prisma, spec, companyId);
      if (rows.length > 0) counts[spec.model] = rows.length;
    }
    return counts;
  }

  private async deleteTable(
    client: RestoreClient,
    spec: TableSpec,
    companyId: string,
  ): Promise<void> {
    const delegate = this.delegate(client, spec.model);
    if (!delegate?.deleteMany) return;

    if (spec.model === 'salesInvoiceLine') {
      await (client as any).salesInvoiceLine.updateMany({
        where: { invoice: { companyId } },
        data: { originalLineId: null },
      });
    } else if (spec.model === 'salesInvoice') {
      await (client as any).salesInvoice.updateMany({
        where: { companyId },
        data: { originalInvoiceId: null },
      });
    } else if (spec.model === 'purchaseInvoiceLine') {
      await (client as any).purchaseInvoiceLine.updateMany({
        where: { invoice: { companyId } },
        data: { originalLineId: null },
      });
    } else if (spec.model === 'purchaseInvoice') {
      await (client as any).purchaseInvoice.updateMany({
        where: { companyId },
        data: { originalInvoiceId: null },
      });
    } else if (spec.model === 'account') {
      await (client as any).account.updateMany({
        where: { companyId },
        data: { parentId: null },
      }).catch(() => {});
    } else if (spec.model === 'branch') {
      await (client as any).branch.updateMany({
        where: { companyId },
        data: { parentBranchId: null },
      }).catch(() => {});
    } else if (spec.model === 'quotation') {
      // Revisions point at one another. Break the chain before deleting so
      // the delete cannot fail on its own foreign key.
      await (client as any).quotation.updateMany({
        where: { companyId },
        data: { revisionOfId: null },
      }).catch(() => {});
    }

    if (spec.scope === 'company') {
      await delegate.deleteMany({ where: { companyId } });
      return;
    }

    if (spec.companyWhere) {
      await delegate.deleteMany({ where: spec.companyWhere(companyId) });
      return;
    }

    const parent = this.delegate(client, spec.parent as string);
    const parents = (await parent.findMany({
      where: { companyId },
      select: { id: true },
    })) as Array<{ id: string }>;
    if (parents.length === 0) return;
    await delegate.deleteMany({
      where: { [spec.foreignKey as string]: { in: parents.map((row) => row.id) } },
    });
  }

  private async insertTable(
    client: RestoreClient,
    spec: TableSpec,
    rows: Array<Record<string, unknown>>,
    companyId: string,
    security: { actorUserId: string | null; actorIsSuperAdmin: boolean },
  ): Promise<void> {
    const delegate = this.delegate(client, spec.model);
    if (!delegate?.createMany) return;

    // Two fixes before writing. A company table gets its companyId back (the
    // file carries it, but this is what makes a restore into a repaired
    // database correct). Dates arrive as text and have to become dates again.
    let prepared = rows.map((row) => {
      const clean: Record<string, unknown> = { ...row };
      if (spec.scope === 'company') clean.companyId = companyId;
      // New cost fields default to the historical line value when a v1
      // purchase backup predates explicit landed-cost storage.
      if (spec.model === 'purchaseInvoice') {
        clean.landedCostAmount ??= '0';
        clean.landedCostCharges ??= [];
      }
      if (spec.model === 'purchaseInvoiceLine') {
        clean.landedCostAmount ??= '0';
        clean.inventoryCostTotal ??= clean.lineTotal ?? '0';
        clean.returnedCostTotal ??= '0';
      }
      if (spec.model === 'salesInvoiceLine') clean.returnedCostTotal ??= '0';
      // A JSON backup can restore company users and their role assignments,
      // but it can never grant installation-wide super-admin powers. Keep
      // that flag only for the currently authenticated account and only if it
      // already had that privilege on this installation.
      if (spec.model === 'user') {
        clean.isSuperAdmin =
          clean.id === security.actorUserId && security.actorIsSuperAdmin;
      }
      for (const [key, value] of Object.entries(clean)) {
        if (typeof value === 'string' && looksLikeDate(key, value)) {
          clean[key] = new Date(value);
        }
      }
      return clean;
    });

    if (
      (spec.model === 'rolePermission' || spec.model === 'userPermission') &&
      typeof (client as any).permission?.findMany === 'function'
    ) {
      const targetPerms = (await (client as any).permission.findMany({
        select: { id: true, code: true },
      })) as Array<{ id: string; code: string }>;
      const targetById = new Set(targetPerms.map((permission) => permission.id));
      const targetByCode = new Map(targetPerms.map((permission) => [permission.code, permission.id]));
      const assignmentField = spec.model === 'rolePermission' ? 'roleId' : 'userId';
      const seenPairs = new Set<string>();
      const remapped: Array<Record<string, unknown>> = [];
      const missingLegacyCodes: string[] = [];

      for (const row of prepared) {
        const assignmentId = String(row[assignmentField] ?? '');
        const sourcePermissionId = String(row.permissionId ?? '');
        const permissionCode =
          typeof row.permissionCode === 'string' ? row.permissionCode : null;
        const mappedPermissionId = permissionCode
          ? targetByCode.get(permissionCode)
          : targetById.has(sourcePermissionId)
            ? sourcePermissionId
            : undefined;

        if (!permissionCode && sourcePermissionId && !mappedPermissionId) {
          missingLegacyCodes.push(sourcePermissionId);
          continue;
        }
        // A newer backup can contain permissions the installed app does not
        // know yet. They are safely omitted rather than guessed by array
        // position and accidentally granted to the wrong role.
        if (!assignmentId || !mappedPermissionId) continue;
        const pairKey = `${assignmentId}:${mappedPermissionId}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        remapped.push({ [assignmentField]: assignmentId, permissionId: mappedPermissionId });
      }

      if (missingLegacyCodes.length > 0) {
        throw new BadRequestException(
          'This older backup does not include permission codes, and its permission IDs do not match this installation. ' +
            'Restore it on the original installation or create a new company JSON backup with a version that stores permission codes. Nothing was changed.',
        );
      }
      prepared = remapped;
    }

    // Prisma rejects columns that belonged to an older schema but no longer
    // exist. Filter each row against this generated client's scalar model
    // fields. Required fields and foreign keys are checked by PostgreSQL when
    // createMany runs inside the all-or-nothing restore transaction; any such
    // error rolls the complete restore back.
    const modelFields = this.scalarModelFields(spec.model);
    if (modelFields) {
      prepared = prepared.map((row) => {
        const clean: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          if (modelFields.has(key)) clean[key] = value;
        }
        return clean;
      });
    }

    const ordered = spec.selfReferencing
      ? parentsFirst(prepared, spec.selfReferenceField)
      : prepared;

    // In chunks, because a single statement with tens of thousands of rows
    // exceeds the parameter limit PostgreSQL accepts. The chunk is large
    // enough that a whole chart of accounts arrives in one statement, which
    // matters for the self-referencing tables: within one INSERT the foreign
    // key is checked after every row is in place.
    const size = 1000;
    for (let index = 0; index < ordered.length; index += size) {
      await delegate.createMany({
        data: ordered.slice(index, index + size),
        skipDuplicates: false,
      });
    }
  }

  private scalarModelFields(model: string): Set<string> | null {
    const prismaWithDmmf = Prisma as unknown as {
      dmmf?: {
        datamodel?: {
          models?: Array<{
            name: string;
            fields: Array<{
              name: string;
              kind: string;
            }>;
          }>;
        };
      };
    };
    const dmmf = prismaWithDmmf.dmmf;
    const modelName = model.charAt(0).toUpperCase() + model.slice(1);
    const info = dmmf?.datamodel?.models?.find((candidate) => candidate.name === modelName);
    if (!info) return null;
    const scalar = info.fields.filter((field) => field.kind !== 'object');
    return new Set(scalar.map((field) => field.name));
  }
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([name, count]) => `${count} ${name}`)
    .join(', ');
}

/// Columns that hold a date. The names are matched by shape - anything ending
/// in "At", "Date" or "On" - rather than by a list that goes stale the moment
/// a model gains a column.
const DATE_SUFFIXES = ['At', 'Date', 'On'];

function looksLikeDate(key: string, value: string): boolean {
  if (!DATE_SUFFIXES.some((suffix) => key.endsWith(suffix))) return false;
  // An ISO-8601 timestamp, which is exactly what a backup writes.
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(
    value,
  );
}

/// Rows that point at another row of the same table are moved after the row
/// they point at: branch/account hierarchies and invoice/line return links.
function parentsFirst(
  rows: Array<Record<string, unknown>>,
  selfReferenceField?: string,
): Array<Record<string, unknown>> {
  const placed = new Set<string>();
  const remaining = [...rows];
  const out: Array<Record<string, unknown>> = [];

  let moved = true;
  while (remaining.length > 0 && moved) {
    moved = false;
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const row = remaining[index];
      const parentId = selfReferenceField
        ? row[selfReferenceField]
        : row.parentId ?? row.parentBranchId;
      if (parentId === null || parentId === undefined || placed.has(String(parentId))) {
        placed.add(String(row.id));
        out.push(row);
        remaining.splice(index, 1);
        moved = true;
      }
    }
  }

  // A cycle - which the chart of accounts should never contain - leaves rows
  // here. They are appended rather than dropped: the database will refuse them
  // and the restore will say so, which is better than a silent partial file.
  return [...out, ...remaining];
}
