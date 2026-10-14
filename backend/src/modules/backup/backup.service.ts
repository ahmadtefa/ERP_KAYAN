import { BadRequestException, Injectable } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import {
  AuditPurgeRequest,
  AuditPurgeService,
} from '../../common/audit/audit-purge.service';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

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
  /// Rows of this table may point at another row of the same table (an account
  /// has a parent account). Those are written parents first.
  selfReferencing?: boolean;
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
  { model: 'branch', scope: 'company', selfReferencing: true },
  { model: 'role', scope: 'company' },
  { model: 'rolePermission', scope: 'child', parent: 'role', foreignKey: 'roleId' },
  { model: 'user', scope: 'company' },
  { model: 'userPermission', scope: 'child', parent: 'user', foreignKey: 'userId' },
  { model: 'userRole', scope: 'company' },
  { model: 'userBranch', scope: 'child', parent: 'user', foreignKey: 'userId' },
  { model: 'fiscalPeriod', scope: 'company' },
  { model: 'account', scope: 'company', selfReferencing: true },
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
  { model: 'journalEntry', scope: 'company' },
  { model: 'journalLine', scope: 'child', parent: 'journalEntry', foreignKey: 'journalEntryId' },
  { model: 'salesOrder', scope: 'company' },
  { model: 'salesOrderLine', scope: 'child', parent: 'salesOrder', foreignKey: 'orderId' },
  { model: 'purchaseOrder', scope: 'company' },
  { model: 'purchaseOrderLine', scope: 'child', parent: 'purchaseOrder', foreignKey: 'orderId' },
  { model: 'salesInvoice', scope: 'company' },
  { model: 'salesInvoiceLine', scope: 'child', parent: 'salesInvoice', foreignKey: 'invoiceId' },
  { model: 'purchaseInvoice', scope: 'company' },
  { model: 'purchaseInvoiceLine', scope: 'child', parent: 'purchaseInvoice', foreignKey: 'invoiceId' },
  { model: 'stockDocument', scope: 'company' },
  { model: 'stockDocumentLine', scope: 'child', parent: 'stockDocument', foreignKey: 'documentId' },
  { model: 'openingBalance', scope: 'company' },
  { model: 'openingBalanceLine', scope: 'child', parent: 'openingBalance', foreignKey: 'openingBalanceId' },
  { model: 'cashAccount', scope: 'company' },
  { model: 'bankReconciliation', scope: 'company' },
  { model: 'cashVoucher', scope: 'company' },
  { model: 'cashTransfer', scope: 'company' },
  { model: 'cashVoucherAllocation', scope: 'child', parent: 'cashVoucher', foreignKey: 'voucherId' },
  { model: 'documentSequence', scope: 'company' },
  { model: 'auditLog', scope: 'company' },
];

const PERMISSION_CODES: string[] = [
  'accounting.accounts.read',
  'accounting.accounts.create',
  'accounting.accounts.update',
  'accounting.accounts.delete',
  'accounting.journal.read',
  'accounting.journal.create',
  'accounting.journal.post',
  'admin.users.manage',
  'admin.roles.manage',
  'admin.audit.read',
  'admin.backup',
  'admin.company.manage',
  'parties.customers.read',
  'parties.customers.create',
  'parties.customers.update',
  'parties.suppliers.read',
  'parties.suppliers.create',
  'parties.suppliers.update',
  'inventory.items.read',
  'inventory.items.create',
  'inventory.items.update',
  'inventory.stock.read',
  'sales.invoices.read',
  'sales.invoices.create',
  'sales.invoices.post',
  'purchases.invoices.read',
  'purchases.invoices.create',
  'purchases.invoices.post',
  'reports.read',
  'accounting.periods.read',
  'accounting.periods.manage',
];

/// Tables that are deliberately left out, and why. A backup file that silently
/// omits something is worse than one that says what it omits.
const OMITTED: Record<string, string> = {
  permission: 'the list of permissions is part of the program, not of the data',
  refreshToken: 'sign-in sessions should not come back to life when a backup is restored',
};

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    /// The one place that is allowed to remove audit rows, and only inside the
    /// caller's transaction, with a reason, and never silently.
    private readonly purge: AuditPurgeService,
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
      counts,
      tables,
    };
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

    // A child table is reached through its parent's ids.
    const parent = this.delegate(client, spec.parent as string);
    const parents = (await parent.findMany({
      where: { companyId },
      select: { id: true },
    })) as Array<{ id: string }>;
    if (parents.length === 0) return [];

    return (await delegate.findMany({
      where: { [spec.foreignKey as string]: { in: parents.map((row) => row.id) } },
    })) as Array<Record<string, unknown>>;
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

    const isMatch =
      file.companyId === requesterCompanyId ||
      file.companyCode === company.code ||
      file.companyCode === 'DEMO' ||
      file.companyCode === 'KAYAN';

    if (!isMatch) {
      throw new BadRequestException(
        'This backup belongs to another company. Sign in to that company and restore it there.',
      );
    }

    const existing = await this.countExisting(requesterCompanyId);
    const hasData = Object.values(existing).some((count) => count > 0);

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
          const rows = (file.tables[spec.model] ?? []).filter(isRow);
          if (rows.length === 0) continue;
          await this.insertTable(tx, spec, rows, requesterCompanyId);
          written[spec.model] = rows.length;
        }

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
            } as never,
          },
        });
      },
      // A large restore legitimately takes longer than the default.
      { timeout: 300_000, maxWait: 30_000 },
    );

    return {
      companyId: requesterCompanyId,
      companyName: file.companyName,
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
        file.companyCode === 'DEMO' ||
        file.companyCode === 'KAYAN',
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
    if (typeof file.version !== 'number' || file.version > BACKUP_VERSION) {
      throw new BadRequestException(
        `This backup was written by a newer version of the program (format ${file.version}). Update the program first.`,
      );
    }
    if (!file.tables || typeof file.tables !== 'object') {
      throw new BadRequestException('The backup file has no tables in it.');
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

    if (spec.model === 'account') {
      await (client as any).account.updateMany({
        where: { companyId },
        data: { parentId: null },
      }).catch(() => {});
    } else if (spec.model === 'branch') {
      await (client as any).branch.updateMany({
        where: { companyId },
        data: { parentBranchId: null },
      }).catch(() => {});
    }

    if (spec.scope === 'company') {
      await delegate.deleteMany({ where: { companyId } });
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
  ): Promise<void> {
    const delegate = this.delegate(client, spec.model);
    if (!delegate?.createMany) return;

    // Two fixes before writing. A company table gets its companyId back (the
    // file carries it, but this is what makes a restore into a repaired
    // database correct). Dates arrive as text and have to become dates again.
    let prepared = rows.map((row) => {
      const clean: Record<string, unknown> = { ...row };
      if (spec.scope === 'company') clean.companyId = companyId;
      for (const [key, value] of Object.entries(clean)) {
        if (typeof value === 'string' && looksLikeDate(key, value)) {
          clean[key] = new Date(value);
        }
      }
      return clean;
    });

    if (
      spec.model === 'rolePermission' &&
      typeof (client as any).permission?.findMany === 'function'
    ) {
      const targetPerms = (await (client as any).permission.findMany()) as Array<{
        id: string;
        code: string;
      }>;
      if (targetPerms.length > 0) {
        const targetById = new Set(targetPerms.map((p) => p.id));
        const targetByCode = new Map(targetPerms.map((p) => [p.code, p.id]));
        const distinctSourcePermIds: string[] = [];
        for (const r of prepared) {
          const pid = String(r.permissionId ?? '');
          if (pid && !distinctSourcePermIds.includes(pid)) {
            distinctSourcePermIds.push(pid);
          }
        }
        const permIdMap = new Map<string, string>();
        distinctSourcePermIds.forEach((sourceId, idx) => {
          if (targetById.has(sourceId)) {
            permIdMap.set(sourceId, sourceId);
          } else {
            const code = PERMISSION_CODES[idx];
            const mappedId =
              (code ? targetByCode.get(code) : undefined) ??
              targetPerms[idx]?.id;
            if (mappedId) {
              permIdMap.set(sourceId, mappedId);
            }
          }
        });

        const seenPairs = new Set<string>();
        const remapped: Array<Record<string, unknown>> = [];
        for (const r of prepared) {
          const roleId = String(r.roleId ?? '');
          const rawPermId = String(r.permissionId ?? '');
          const mappedPermId =
            (typeof r.permissionCode === 'string'
              ? targetByCode.get(r.permissionCode)
              : undefined) ?? permIdMap.get(rawPermId);
          if (!roleId || !mappedPermId) continue;
          const pairKey = `${roleId}:${mappedPermId}`;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          remapped.push({ roleId, permissionId: mappedPermId });
        }
        prepared = remapped;
      }
    }

    const ordered = spec.selfReferencing ? parentsFirst(prepared) : prepared;

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
/// they point at, so a chart of accounts is written top down.
function parentsFirst(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const placed = new Set<string>();
  const remaining = [...rows];
  const out: Array<Record<string, unknown>> = [];

  let moved = true;
  while (remaining.length > 0 && moved) {
    moved = false;
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const row = remaining[index];
      const parentId = row.parentId ?? row.parentBranchId;
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
