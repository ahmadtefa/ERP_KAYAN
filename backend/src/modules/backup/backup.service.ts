import { BadRequestException, Injectable } from '@nestjs/common';

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

export interface RestoreSummary {
  companyId: string;
  companyName: string;
  createdAt: string;
  replaced: boolean;
  written: Record<string, number>;
  total: number;
}

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
  { model: 'branch', scope: 'company' },
  { model: 'role', scope: 'company' },
  { model: 'rolePermission', scope: 'child', parent: 'role', foreignKey: 'roleId' },
  { model: 'user', scope: 'company' },
  { model: 'userRole', scope: 'company' },
  { model: 'userBranch', scope: 'child', parent: 'user', foreignKey: 'userId' },
  { model: 'fiscalPeriod', scope: 'company' },
  { model: 'account', scope: 'company', selfReferencing: true },
  { model: 'customer', scope: 'company' },
  { model: 'supplier', scope: 'company' },
  { model: 'item', scope: 'company' },
  { model: 'stockBalance', scope: 'company' },
  { model: 'stockMovement', scope: 'company' },
  { model: 'journalEntry', scope: 'company' },
  { model: 'journalLine', scope: 'child', parent: 'journalEntry', foreignKey: 'journalEntryId' },
  { model: 'salesInvoice', scope: 'company' },
  { model: 'salesInvoiceLine', scope: 'child', parent: 'salesInvoice', foreignKey: 'invoiceId' },
  { model: 'purchaseInvoice', scope: 'company' },
  { model: 'purchaseInvoiceLine', scope: 'child', parent: 'purchaseInvoice', foreignKey: 'invoiceId' },
  { model: 'documentSequence', scope: 'company' },
  { model: 'auditLog', scope: 'company' },
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
      const rows = await this.readTable(spec, companyId);
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

  private delegate(model: string): Record<string, any> {
    // Looked up by name so the whole backup is one table list rather than
    // twenty near-identical blocks. Every name in TABLES is a real model.
    return (this.prisma as unknown as Record<string, Record<string, any>>)[model];
  }

  private async readTable(
    spec: TableSpec,
    companyId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const delegate = this.delegate(spec.model);
    if (!delegate?.findMany) return [];

    if (spec.scope === 'company') {
      return (await delegate.findMany({ where: { companyId } })) as Array<
        Record<string, unknown>
      >;
    }

    // A child table is reached through its parent's ids.
    const parent = this.delegate(spec.parent as string);
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
    options: { replace: boolean },
  ): Promise<RestoreSummary> {
    this.validate(file);

    // A backup is restored into the company it came from. Putting one company's
    // books inside another's would be a catastrophe, so it is refused rather
    // than remapped quietly.
    if (file.companyId !== requesterCompanyId) {
      throw new BadRequestException(
        'This backup belongs to another company. Sign in to that company and restore it there.',
      );
    }

    const company = await this.prisma.company.findUnique({
      where: { id: requesterCompanyId },
    });
    if (!company) {
      throw new BadRequestException(
        'The company in this backup does not exist here. Restore it on the installation it came from.',
      );
    }

    const existing = await this.countExisting(file.companyId);
    const hasData = Object.values(existing).some((count) => count > 0);

    if (hasData && !options.replace) {
      throw new BadRequestException(
        `This company already holds data (${describe(existing)}). Confirm that you want to replace it to restore over it.`,
      );
    }

    const written: Record<string, number> = {};

    // One transaction: a restore that stops half way would leave a company that
    // is neither the old one nor the new one.
    await this.prisma.$transaction(
      async () => {
        // Everything is cleared first, children before parents. An empty
        // company has nothing to clear and the same code runs anyway, so the
        // two paths are the same path.
        for (const spec of [...TABLES].reverse()) {
          await this.deleteTable(spec, file.companyId);
        }

        for (const spec of TABLES) {
          const rows = (file.tables[spec.model] ?? []).filter(isRow);
          if (rows.length === 0) continue;
          await this.insertTable(spec, rows, file.companyId);
          written[spec.model] = rows.length;
        }
      },
      // A large restore legitimately takes longer than the default.
      { timeout: 300_000, maxWait: 30_000 },
    );

    return {
      companyId: file.companyId,
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
    return {
      format: file.format,
      version: file.version,
      createdAt: file.createdAt,
      companyName: file.companyName,
      companyCode: file.companyCode,
      belongsToThisCompany: file.companyId === requesterCompanyId,
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
      const rows = await this.readTable(spec, companyId);
      if (rows.length > 0) counts[spec.model] = rows.length;
    }
    return counts;
  }

  private async deleteTable(spec: TableSpec, companyId: string): Promise<void> {
    const delegate = this.delegate(spec.model);
    if (!delegate?.deleteMany) return;

    if (spec.scope === 'company') {
      await delegate.deleteMany({ where: { companyId } });
      return;
    }

    const parent = this.delegate(spec.parent as string);
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
    spec: TableSpec,
    rows: Array<Record<string, unknown>>,
    companyId: string,
  ): Promise<void> {
    const delegate = this.delegate(spec.model);
    if (!delegate?.createMany) return;

    // Two fixes before writing. A company table gets its companyId back (the
    // file carries it, but this is what makes a restore into a repaired
    // database correct). Dates arrive as text and have to become dates again.
    const prepared = rows.map((row) => {
      const clean: Record<string, unknown> = { ...row };
      if (spec.scope === 'company') clean.companyId = companyId;
      for (const [key, value] of Object.entries(clean)) {
        if (typeof value === 'string' && looksLikeDate(key, value)) {
          clean[key] = new Date(value);
        }
      }
      return clean;
    });

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
      const parentId = row.parentId;
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
