import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

export const MASTER_DATA_BACKUP_FORMAT = 'kayan-master-data-backup';
export const MASTER_DATA_BACKUP_VERSION = 1;
export const MASTER_DATA_KINDS = ['items', 'customers', 'suppliers'] as const;
export type MasterDataKind = (typeof MASTER_DATA_KINDS)[number];

export interface MasterDataPermissions {
  salePrice: boolean;
  purchasePrice: boolean;
  manageSalePrice: boolean;
  managePurchasePrice: boolean;
}

export interface MasterDataArchive {
  format: typeof MASTER_DATA_BACKUP_FORMAT;
  version: number;
  kind: MasterDataKind;
  companyId: string;
  createdAt: string;
  recordCount: number;
  records: Array<Record<string, unknown>>;
}

interface ExistingRow {
  id: string;
  code: string;
  deletedAt: Date | null;
  updatedAt: Date;
}

interface Plan {
  create: Array<Record<string, unknown>>;
  update: Array<{ id: string; code: string; data: Record<string, unknown> }>;
  conflicts: string[];
  fingerprint: string;
}

const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_RECORDS = 25_000;
const MAX_TEXT_LENGTH = 4000;
const DECIMAL_PATTERN = /^(?:\d{1,15})(?:\.\d{1,4})?$/;

const COMMON_FIELDS = [
  'nameEn',
  'nameAr',
  'phone',
  'email',
  'taxNumber',
  'address',
  'isActive',
  'notes',
] as const;

const ITEM_FIELDS = [
  'nameEn',
  'nameAr',
  'unit',
  'barcode',
  'salePrice',
  'purchasePrice',
  'reorderLevel',
  'taxRate',
  'isStockTracked',
  'isActive',
  'countryOfOrigin',
  'requiresBatch',
  'requiresProductionDate',
  'requiresExpiryDate',
  'useFefo',
  'allowExpiredIssue',
  'expiredIssueNeedsApproval',
  'notes',
] as const;

const PARTY_FIELDS: Record<'customers' | 'suppliers', readonly string[]> = {
  customers: [...COMMON_FIELDS, 'creditLimit', 'paymentTermDays'],
  suppliers: [...COMMON_FIELDS, 'paymentTermDays'],
};

const NULLABLE_FIELDS = new Set([
  'phone',
  'email',
  'taxNumber',
  'address',
  'barcode',
  'taxRate',
  'purchasePrice',
  'countryOfOrigin',
  'notes',
]);
const DECIMAL_FIELDS = new Set(['salePrice', 'purchasePrice', 'reorderLevel', 'taxRate', 'creditLimit']);
const BOOLEAN_FIELDS = new Set([
  'isActive',
  'isStockTracked',
  'requiresBatch',
  'requiresProductionDate',
  'requiresExpiryDate',
  'useFefo',
  'allowExpiredIssue',
  'expiredIssueNeedsApproval',
]);
const INTEGER_FIELDS = new Set(['paymentTermDays']);

/**
 * A deliberately narrow, single-company copy of master records. It never
 * serialises database IDs, warehouse settings, stock ledgers, transactions,
 * or relationship foreign keys. Restore matches by company-local code and
 * updates the existing row in place, preserving every historical FK.
 */
@Injectable()
export class MasterDataBackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    kind: MasterDataKind,
    companyId: string,
    permissions: MasterDataPermissions,
  ): Promise<MasterDataArchive> {
    const rows = await this.readRows(this.prisma, kind, companyId, permissions);
    if (rows.length > MAX_RECORDS) {
      throw new BadRequestException({ code: 'MD_TOO_LARGE', message: 'This master list is too large for a single backup.' });
    }
    return {
      format: MASTER_DATA_BACKUP_FORMAT,
      version: MASTER_DATA_BACKUP_VERSION,
      kind,
      companyId,
      createdAt: new Date().toISOString(),
      recordCount: rows.length,
      records: rows,
    };
  }

  async preview(
    kind: MasterDataKind,
    companyId: string,
    input: unknown,
    permissions: MasterDataPermissions,
  ) {
    const archive = this.validateArchive(kind, companyId, input, permissions);
    const plan = await this.plan(this.prisma, archive);
    return {
      kind,
      total: archive.recordCount,
      createCount: plan.create.length,
      updateCount: plan.update.length,
      conflictCount: plan.conflicts.length,
      conflicts: plan.conflicts.slice(0, 100),
      previewFingerprint: plan.fingerprint,
    };
  }

  async restore(
    kind: MasterDataKind,
    companyId: string,
    userId: string,
    input: unknown,
    previewFingerprint: unknown,
    permissions: MasterDataPermissions,
  ) {
    const archive = this.validateArchive(kind, companyId, input, permissions);
    if (typeof previewFingerprint !== 'string' || previewFingerprint.length !== 64) {
      throw new BadRequestException({ code: 'MD_PREVIEW_FIRST', message: 'Preview the backup before restoring it.' });
    }

    return this.prisma.$transaction(async (tx) => {
      const plan = await this.plan(tx, archive);
      if (plan.fingerprint !== previewFingerprint) {
        throw new ConflictException({ code: 'MD_CHANGED_AFTER_PREVIEW', message: 'The backup or destination data changed after preview. Preview it again before restoring.' });
      }
      if (plan.conflicts.length) {
        throw new ConflictException({ code: 'MD_CONFLICTS', message: `Restore stopped without changes: ${plan.conflicts.length} records conflict with deleted records.` });
      }

      for (const row of plan.create) {
        await this.createOne(tx, kind, companyId, row);
      }
      for (const row of plan.update) {
        await this.updateOne(tx, kind, companyId, row.id, row.data);
      }

      await this.audit.recordRequired(
        {
          companyId,
          userId,
          action: 'MASTER_DATA_RESTORE',
          entity: kind,
          after: {
            format: archive.format,
            version: archive.version,
            sourceCreatedAt: archive.createdAt,
            created: plan.create.length,
            updated: plan.update.length,
            recordCount: archive.recordCount,
          },
        },
        tx,
      );

      return {
        kind,
        restored: archive.recordCount,
        created: plan.create.length,
        updated: plan.update.length,
        preservedHistoricalRows: true,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private validateArchive(
    kind: MasterDataKind,
    companyId: string,
    input: unknown,
    permissions: MasterDataPermissions,
  ): MasterDataArchive {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException({ code: 'MD_FILE_INVALID', message: 'The selected file is not a KAYAN master-data backup.' });
    }
    const archive = input as Partial<MasterDataArchive>;
    if (archive.format !== MASTER_DATA_BACKUP_FORMAT || archive.version !== MASTER_DATA_BACKUP_VERSION) {
      throw new BadRequestException({ code: 'MD_FILE_INVALID', message: 'Unsupported master-data backup format or version.' });
    }
    if (archive.kind !== kind) {
      throw new BadRequestException({ code: 'MD_WRONG_KIND', message: `This is a ${String(archive.kind)} backup, not a ${kind} backup.` });
    }
    if (archive.companyId !== companyId) {
      throw new BadRequestException({ code: 'MD_OTHER_COMPANY', message: 'This backup belongs to a different company. Nothing was changed.' });
    }
    const allowedTopLevel = new Set([
      'format', 'version', 'kind', 'companyId', 'createdAt', 'recordCount', 'records',
    ]);
    if (Object.keys(archive).some((key) => !allowedTopLevel.has(key))) {
      throw new BadRequestException({ code: 'MD_FILE_INVALID', message: 'The backup contains unsupported top-level fields.' });
    }
    if (typeof archive.createdAt !== 'string' || !Number.isFinite(Date.parse(archive.createdAt))) {
      throw new BadRequestException({ code: 'MD_FILE_INVALID', message: 'The backup creation date is invalid.' });
    }
    if (!Array.isArray(archive.records) || archive.records.length > MAX_RECORDS ||
        !Number.isInteger(archive.recordCount) || archive.recordCount !== archive.records.length) {
      throw new BadRequestException({ code: 'MD_FILE_INVALID', message: 'The backup record count is invalid or exceeds the safety limit.' });
    }
    const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
    if (bytes > MAX_ARCHIVE_BYTES) {
      throw new BadRequestException({ code: 'MD_FILE_INVALID', message: 'The master-data backup exceeds the 5 MB restore limit.' });
    }

    const fields = this.restorableFields(kind, permissions);
    const seen = new Set<string>();
    for (const [index, record] of archive.records.entries()) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new BadRequestException({ code: 'MD_FILE_INVALID', message: `Record ${index + 1} is not an object.` });
      }
      const row = record as Record<string, unknown>;
      const unknown = Object.keys(row).filter((key) => key !== 'code' && !fields.includes(key));
      if (unknown.length) {
        if (unknown.some((field) => field === 'salePrice' && !permissions.manageSalePrice)) {
          throw new ForbiddenException({ code: 'MD_PRICES_NOT_ALLOWED', message: 'This backup contains sale prices you are not allowed to restore.' });
        }
        if (unknown.some((field) => field === 'purchasePrice' && !permissions.managePurchasePrice)) {
          throw new ForbiddenException({ code: 'MD_PRICES_NOT_ALLOWED', message: 'This backup contains purchase prices you are not allowed to restore.' });
        }
        throw new BadRequestException({ code: 'MD_FILE_INVALID', message: `Record ${index + 1} contains unsupported fields.` });
      }
      const code = row.code;
      if (typeof code !== 'string' || !code.trim() || code !== code.trim() || code.length > 40) {
        throw new BadRequestException({ code: 'MD_FILE_INVALID', message: `Record ${index + 1} has an invalid code.` });
      }
      if (seen.has(code)) throw new BadRequestException(`Code "${code}" appears more than once in the backup.`);
      seen.add(code);
      for (const key of fields) {
        if (!(key in row)) continue;
        this.validateValue(index + 1, key, row[key]);
      }
      if (typeof row.nameEn !== 'string' || !row.nameEn.trim() ||
          typeof row.nameAr !== 'string' || !row.nameAr.trim()) {
        throw new BadRequestException({ code: 'MD_FILE_INVALID', message: `Record ${index + 1} must include both Arabic and English names.` });
      }
    }
    return archive as MasterDataArchive;
  }

  private validateValue(index: number, key: string, value: unknown): void {
    if (value === null && NULLABLE_FIELDS.has(key)) return;
    if (BOOLEAN_FIELDS.has(key)) {
      if (typeof value !== 'boolean') throw new BadRequestException({ code: 'MD_FILE_INVALID', message: `Record ${index}: ${key} must be true or false.` });
      return;
    }
    if (DECIMAL_FIELDS.has(key)) {
      const pattern = key === 'taxRate'
        ? /^\d{1,5}(?:\.\d{1,4})?$/
        : DECIMAL_PATTERN;
      if (typeof value !== 'string' || !pattern.test(value)) {
        throw new BadRequestException({ code: 'MD_FILE_INVALID', message: `Record ${index}: ${key} must be a non-negative decimal string.` });
      }
      if (key === 'taxRate' && new Prisma.Decimal(value).greaterThan(100)) {
        throw new BadRequestException({ code: 'MD_FILE_INVALID', message: `Record ${index}: taxRate must not exceed 100.` });
      }
      return;
    }
    if (INTEGER_FIELDS.has(key)) {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 3650) {
        throw new BadRequestException({ code: 'MD_FILE_INVALID', message: `Record ${index}: ${key} must be an integer from 0 to 3650.` });
      }
      return;
    }
    if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) {
      throw new BadRequestException({ code: 'MD_FILE_INVALID', message: `Record ${index}: ${key} must be text no longer than ${MAX_TEXT_LENGTH} characters.` });
    }
  }

  private backupFields(kind: MasterDataKind, permissions: MasterDataPermissions): string[] {
    const all = kind === 'items' ? [...ITEM_FIELDS] : [...PARTY_FIELDS[kind]];
    return all.filter((field) =>
      (field !== 'salePrice' || permissions.salePrice) &&
      (field !== 'purchasePrice' || permissions.purchasePrice),
    );
  }

  private restorableFields(kind: MasterDataKind, permissions: MasterDataPermissions): string[] {
    const all = kind === 'items' ? [...ITEM_FIELDS] : [...PARTY_FIELDS[kind]];
    return all.filter((field) =>
      (field !== 'salePrice' || permissions.manageSalePrice) &&
      (field !== 'purchasePrice' || permissions.managePurchasePrice),
    );
  }

  private async plan(
    client: PrismaService | Prisma.TransactionClient,
    archive: MasterDataArchive,
  ): Promise<Plan> {
    const codes = archive.records.map((row) => String(row.code));
    const existing = await this.findExisting(client, archive.kind, archive.companyId, codes);
    const byCode = new Map(existing.map((row) => [row.code, row]));
    const create: Array<Record<string, unknown>> = [];
    const update: Plan['update'] = [];
    const conflicts: string[] = [];
    for (const row of archive.records) {
      const current = byCode.get(String(row.code));
      if (!current) create.push(row);
      else if (current.deletedAt) conflicts.push(String(row.code));
      else update.push({ id: current.id, code: current.code, data: row });
    }
    const digestInput = {
      kind: archive.kind,
      companyId: archive.companyId,
      records: archive.records,
      existing: existing
        .map((row) => ({
          id: row.id,
          code: row.code,
          deletedAt: row.deletedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    };
    const fingerprint = createHash('sha256').update(this.canonical(digestInput)).digest('hex');
    return { create, update, conflicts, fingerprint };
  }

  private async findExisting(
    client: PrismaService | Prisma.TransactionClient,
    kind: MasterDataKind,
    companyId: string,
    codes: string[],
  ): Promise<ExistingRow[]> {
    if (!codes.length) return [];
    const select = { id: true, code: true, deletedAt: true, updatedAt: true } as const;
    if (kind === 'items') {
      return client.item.findMany({ where: { companyId, code: { in: codes } }, select });
    }
    if (kind === 'customers') {
      return client.customer.findMany({ where: { companyId, code: { in: codes } }, select });
    }
    return client.supplier.findMany({ where: { companyId, code: { in: codes } }, select });
  }

  private async readRows(
    client: PrismaService,
    kind: MasterDataKind,
    companyId: string,
    permissions: MasterDataPermissions,
  ): Promise<Array<Record<string, unknown>>> {
    const fields = this.backupFields(kind, permissions);
    const select = Object.fromEntries([['code', true], ...fields.map((field) => [field, true])]);
    const where = { companyId, deletedAt: null };
    const rows = kind === 'items'
      ? await client.item.findMany({ where, select: select as never, orderBy: { code: 'asc' }, take: MAX_RECORDS + 1 })
      : kind === 'customers'
      ? await client.customer.findMany({ where, select: select as never, orderBy: { code: 'asc' }, take: MAX_RECORDS + 1 })
      : await client.supplier.findMany({ where, select: select as never, orderBy: { code: 'asc' }, take: MAX_RECORDS + 1 });
    return rows.map((row) => {
      const values = row as unknown as Record<string, unknown>;
      const output: Record<string, unknown> = { code: values.code };
      for (const field of fields) {
        const value = values[field];
        output[field] = value instanceof Prisma.Decimal ? value.toString() : value;
      }
      return output;
    });
  }

  private async createOne(
    tx: Prisma.TransactionClient,
    kind: MasterDataKind,
    companyId: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    const data = { companyId, ...row } as never;
    if (kind === 'items') await tx.item.create({ data });
    else if (kind === 'customers') await tx.customer.create({ data });
    else await tx.supplier.create({ data });
  }

  private async updateOne(
    tx: Prisma.TransactionClient,
    kind: MasterDataKind,
    companyId: string,
    id: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    const data = { ...row } as never;
    if (kind === 'items') await tx.item.updateMany({ where: { id, companyId, deletedAt: null }, data });
    else if (kind === 'customers') await tx.customer.updateMany({ where: { id, companyId, deletedAt: null }, data });
    else await tx.supplier.updateMany({ where: { id, companyId, deletedAt: null }, data });
  }

  private canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((entry) => this.canonical(entry)).join(',')}]`;
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${this.canonical(object[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }
}
