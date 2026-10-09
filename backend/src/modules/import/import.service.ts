import { BadRequestException, Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  ImportFormatError,
  isXlsx,
  normaliseHeader,
  readCsv,
  readXlsx,
  Sheet,
} from './tabular';

export type ImportKind = 'customers' | 'suppliers' | 'items';

export const IMPORT_KINDS: ImportKind[] = ['customers', 'suppliers', 'items'];

type Mode = 'insert' | 'upsert';

interface FieldSpec {
  /// The column name in the file, normalised.
  key: string;
  labelEn: string;
  labelAr: string;
  required?: boolean;
  example: string;
  decimal?: boolean;
  boolean?: boolean;
  maxLength?: number;
  /// Extra names the same column may arrive under, so a file from a
  /// spreadsheet that somebody typed by hand still lands correctly.
  aliases?: string[];
}

interface RowError {
  row: number;
  column: string;
  message: string;
}

interface RowOutcome {
  row: number;
  code: string;
  action: 'created' | 'updated' | 'skipped';
}

export interface ImportReport {
  kind: ImportKind;
  dryRun: boolean;
  mode: Mode;
  fileName: string;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: RowError[];
  preview: RowOutcome[];
  unknownColumns: string[];
  /// Rows that are fine and would be imported. Shown before anything is written.
  validRows: number;
}

/// Takes a spreadsheet of master data and turns it into records.
///
/// Two rules shape the whole thing:
///
///  * nothing is written until the file has been read and checked in full, and
///  * a dry run reports exactly what a real run would do, using the same code
///    path, so the preview is never a guess.
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────── the columns

  private fields(kind: ImportKind): FieldSpec[] {
    const party: FieldSpec[] = [
      {
        key: 'code',
        labelEn: 'Code',
        labelAr: 'الكود',
        required: true,
        example: kind === 'customers' ? 'C-100' : 'S-100',
        maxLength: 40,
        aliases: ['customercode', 'suppliercode', 'كود'],
      },
      {
        key: 'nameen',
        labelEn: 'Name (English)',
        labelAr: 'الاسم (إنجليزي)',
        required: true,
        example: kind === 'customers' ? 'Alfa Trading' : 'Beta Supplies',
        maxLength: 200,
        aliases: ['name', 'englishname', 'الاسمبالانجليزية', 'الاسمبالانجليزيه'],
      },
      {
        key: 'namear',
        labelEn: 'Name (Arabic)',
        labelAr: 'الاسم (عربي)',
        required: true,
        example: kind === 'customers' ? 'شركة ألفا' : 'مؤسسة بيتا',
        maxLength: 200,
        aliases: ['arabicname', 'الاسمبالعربية', 'الاسمبالعربيه'],
      },
      {
        key: 'phone',
        labelEn: 'Phone',
        labelAr: 'الهاتف',
        example: '01000000000',
        maxLength: 40,
        aliases: ['mobile', 'telephone', 'تليفون', 'الهاتفالمحمول'],
      },
      {
        key: 'email',
        labelEn: 'Email',
        labelAr: 'البريد الإلكتروني',
        example: 'name@example.com',
        maxLength: 200,
      },
      {
        key: 'taxnumber',
        labelEn: 'Tax number',
        labelAr: 'الرقم الضريبي',
        example: '123456789',
        maxLength: 60,
        aliases: ['taxid', 'vatnumber', 'الرقمالضريبي'],
      },
      {
        key: 'address',
        labelEn: 'Address',
        labelAr: 'العنوان',
        example: 'Cairo',
        maxLength: 400,
      },
      {
        key: 'notes',
        labelEn: 'Notes',
        labelAr: 'ملاحظات',
        example: '',
        maxLength: 1000,
        aliases: ['note', 'ملاحظة', 'ملاحظات'],
      },
    ];

    if (kind === 'customers') {
      party.splice(7, 0, {
        key: 'creditlimit',
        labelEn: 'Credit limit',
        labelAr: 'حد الائتمان',
        example: '50000.00',
        decimal: true,
        aliases: ['credit', 'حدالائتمان'],
      });
    }

    if (kind !== 'items') return party;

    return [
      {
        key: 'code',
        labelEn: 'Code',
        labelAr: 'الكود',
        required: true,
        example: 'IT-100',
        maxLength: 40,
        aliases: ['itemcode', 'كود'],
      },
      {
        key: 'nameen',
        labelEn: 'Name (English)',
        labelAr: 'الاسم (إنجليزي)',
        required: true,
        example: 'Steel chair',
        maxLength: 200,
        aliases: ['name', 'englishname'],
      },
      {
        key: 'namear',
        labelEn: 'Name (Arabic)',
        labelAr: 'الاسم (عربي)',
        required: true,
        example: 'كرسي معدني',
        maxLength: 200,
        aliases: ['arabicname'],
      },
      {
        key: 'unit',
        labelEn: 'Unit',
        labelAr: 'الوحدة',
        example: 'piece',
        maxLength: 40,
        aliases: ['uom', 'الوحدة'],
      },
      {
        key: 'saleprice',
        labelEn: 'Sale price',
        labelAr: 'سعر البيع',
        example: '150.00',
        decimal: true,
        aliases: ['price', 'sellingprice', 'سعرالبيع'],
      },
      {
        key: 'taxrate',
        labelEn: 'Tax rate %',
        labelAr: 'نسبة الضريبة %',
        example: '14',
        decimal: true,
        aliases: ['vat', 'vatrate', 'tax', 'نسبةالضريبة'],
      },
      {
        key: 'isstocktracked',
        labelEn: 'Tracked in stock',
        labelAr: 'يتتبع بالمخزون',
        example: 'yes',
        boolean: true,
        aliases: ['stocktracked', 'isstocked', 'trackstock'],
      },
      {
        key: 'notes',
        labelEn: 'Notes',
        labelAr: 'ملاحظات',
        example: '',
        maxLength: 1000,
        aliases: ['note'],
      },
    ];
  }

  /// The spreadsheet a user downloads, fills in and uploads back.
  async template(kind: ImportKind): Promise<Buffer> {
    const fields = this.fields(kind);
    const workbook = new Workbook();
    workbook.creator = 'KAYAN ERP';

    const sheet = workbook.addWorksheet('Import');
    const header = sheet.addRow(fields.map((field) => field.labelEn));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8EEF7' },
      };
    });

    // A second header row carries the Arabic label, so the person filling the
    // sheet in can read it even if their Excel is in Arabic.
    const arabic = sheet.addRow(fields.map((field) => field.labelAr));
    arabic.font = { italic: true, size: 10, color: { argb: 'FF666666' } };

    sheet.addRow(fields.map((field) => field.example));
    sheet.addRow([]);

    const { en, ar } = this.instructions(kind);
    for (const line of en) {
      const row = sheet.addRow([line]);
      row.font = { size: 9, color: { argb: 'FF444444' } };
    }
    sheet.addRow([]);
    for (const line of ar) {
      const row = sheet.addRow([line]);
      row.font = { size: 9, color: { argb: 'FF444444' } };
    }

    fields.forEach((field, index) => {
      sheet.getColumn(index + 1).width = Math.max(field.labelEn.length + 4, 14);
    });
    sheet.views = [{ state: 'frozen', ySplit: 2 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private instructions(kind: ImportKind): { en: string[]; ar: string[] } {
    const required = this.fields(kind)
      .filter((field) => field.required)
      .map((field) => field.labelEn)
      .join(', ');

    return {
      en: [
        `Required columns: ${required}. Delete the example row before uploading.`,
        'Delete the two grey rows above the example, and the notes below it, before uploading.',
        'Rows are matched by Code. Leave a column empty if you have nothing for it.',
      ],
      ar: [
        `الأعمدة المطلوبة: ${required}. امسح سطر المثال قبل الرفع.`,
        'امسح السطرين الرماديين اللي فوق المثال، والملاحظات اللي تحت، قبل الرفع.',
        'الربط بيتم بالكود. سيب العمود فاضي لو مفيش عندك بيانات فيه.',
      ],
    };
  }

  // ───────────────────────────────────────────────────── the import

  async run(
    kind: ImportKind,
    companyId: string,
    userId: string,
    file: { originalname: string; buffer: Buffer },
    options: { dryRun: boolean; mode: Mode },
  ): Promise<ImportReport> {
    if (!IMPORT_KINDS.includes(kind)) {
      throw new BadRequestException(
        `Unknown import "${kind}". Known imports: ${IMPORT_KINDS.join(', ')}.`,
      );
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file was uploaded.');
    }

    let sheet: Sheet;
    try {
      sheet = isXlsx(file.buffer)
        ? await readXlsx(file.buffer)
        : readCsv(file.buffer);
    } catch (error) {
      if (error instanceof ImportFormatError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const fields = this.fields(kind);
    const byHeader = new Map<string, FieldSpec>();
    for (const field of fields) {
      byHeader.set(field.key, field);
      for (const alias of field.aliases ?? []) byHeader.set(alias, field);
    }

    // Without a code column there is no way to tell one record from another,
    // and every row would be written with an empty code. Refuse the file.
    const codeField = fields.find((field) => field.key === 'code');
    const headerKeys = sheet.headers
      .filter((header) => header.trim() !== '')
      .map((header) => normaliseHeader(header));
    if (codeField && !headerKeys.includes('code') &&
        !(codeField.aliases ?? []).some((alias) => headerKeys.includes(alias))) {
      throw new BadRequestException(
        headerKeys.length === 0
          ? 'The file has no readable column headers. Start from the template on this screen.'
          : `The file has no "${codeField.labelEn}" column. Add one (or use the template) - without it a row cannot be matched to a record.`,
      );
    }

    const unknownColumns = sheet.headers
      .map((header) => header.trim())
      .filter((header) => header !== '')
      .filter((header) => !byHeader.has(normaliseHeader(header)));

    const errors: RowError[] = [];
    const preview: RowOutcome[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Existing records, so a file can be re-uploaded without inventing
    // duplicates.
    const existing = await this.existingCodes(kind, companyId);

    const seenInFile = new Set<string>();
    const writes: Array<() => Promise<void>> = [];

    for (const row of sheet.rows) {
      const values: Record<string, string> = {};
      let rowCode = '';

      for (const [header, raw] of Object.entries(row.values)) {
        const field = byHeader.get(header);
        // A column the importer does not know is reported once, above.
        if (!field) continue;

        const value = raw.trim();
        if (field.key === 'code') rowCode = value;

        if (!value) {
          if (field.required) {
            errors.push({
              row: row.rowNumber,
              column: field.labelEn,
              message: `${field.labelEn} is required`,
            });
          }
          continue;
        }

        if (field.maxLength && value.length > field.maxLength) {
          errors.push({
            row: row.rowNumber,
            column: field.labelEn,
            message: `${field.labelEn} is longer than ${field.maxLength} characters`,
          });
          continue;
        }

        if (field.decimal && !/^-?\d{1,15}(\.\d{1,6})?$/.test(value)) {
          errors.push({
            row: row.rowNumber,
            column: field.labelEn,
            message: `${field.labelEn} is not a number: "${value}"`,
          });
          continue;
        }

        values[field.key] = field.boolean ? this.truthy(value) : value;
      }

      if (errors.some((error) => error.row === row.rowNumber)) continue;

      if (rowCode && seenInFile.has(rowCode)) {
        errors.push({
          row: row.rowNumber,
          column: 'Code',
          message: `Code "${rowCode}" appears more than once in this file`,
        });
        continue;
      }
      if (rowCode) seenInFile.add(rowCode);

      const exists = existing.has(rowCode);
      if (exists && options.mode === 'insert') {
        skipped += 1;
        preview.push({ row: row.rowNumber, code: rowCode, action: 'skipped' });
        continue;
      }

      if (exists) {
        updated += 1;
        preview.push({ row: row.rowNumber, code: rowCode, action: 'updated' });
        if (!options.dryRun) {
          writes.push(() =>
            this.updateOne(kind, companyId, rowCode, values),
          );
        }
      } else {
        created += 1;
        preview.push({ row: row.rowNumber, code: rowCode, action: 'created' });
        if (!options.dryRun) {
          writes.push(() =>
            this.createOne(kind, companyId, values),
          );
        }
      }
    }

    // The whole file lands or none of it does. A half-imported list is worse
    // than a failed one, because nobody can tell where it stopped.
    if (!options.dryRun && writes.length > 0) {
      await this.prisma.$transaction(async () => {
        for (const write of writes) await write();
      });

      await this.audit.record({
        companyId,
        userId,
        action: 'IMPORT',
        entity: kind,
        entityId: null,
        after: {
          fileName: file.originalname,
          mode: options.mode,
          created,
          updated,
          skipped,
        },
      });
    }

    return {
      kind,
      dryRun: options.dryRun,
      mode: options.mode,
      fileName: file.originalname,
      totalRows: sheet.rows.length,
      created,
      updated,
      skipped,
      errors,
      preview: preview.slice(0, 50),
      unknownColumns,
      validRows: created + updated,
    };
  }

  // ───────────────────────────────────────────────────── the writers

  private async existingCodes(
    kind: ImportKind,
    companyId: string,
  ): Promise<Map<string, string>> {
    const rows =
      kind === 'customers'
        ? await this.prisma.customer.findMany({
            where: { companyId, deletedAt: null },
            select: { id: true, code: true },
          })
        : kind === 'suppliers'
          ? await this.prisma.supplier.findMany({
              where: { companyId, deletedAt: null },
              select: { id: true, code: true },
            })
          : await this.prisma.item.findMany({
              where: { companyId, deletedAt: null },
              select: { id: true, code: true },
            });

    return new Map(rows.map((row) => [row.code, row.id]));
  }

  private decimal(value: string | undefined): Prisma.Decimal | undefined {
    return value === undefined ? undefined : new Prisma.Decimal(value);
  }

  private boolean(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    return this.truthy(value) === 'true';
  }

  /// "yes", "y", "true", "1", "نعم" and "صح" all mean the same thing to a
  /// person filling in a spreadsheet.
  private truthy(value: string): string {
    const text = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'نعم', 'صح', 'ايوه', 'أيوه'].includes(text)) {
      return 'true';
    }
    if (['false', 'no', 'n', '0', 'لا', 'خطأ', 'غلط'].includes(text)) {
      return 'false';
    }
    return 'true';
  }

  private async createOne(
    kind: ImportKind,
    companyId: string,
    values: Record<string, string>,
  ): Promise<void> {
    // Both names are NOT NULL in the database. A file that carries only one of
    // them still imports: the name it has is used for both, which is what a
    // person would do by hand rather than leave a blank.
    const arabicName = values.namear ?? values.nameen ?? values.code;
    const englishName = values.nameen ?? values.namear ?? values.code;

    if (kind === 'items') {
      await this.prisma.item.create({
        data: {
          companyId,
          code: values.code,
          nameEn: values.nameen ?? values.namear ?? values.code,
          nameAr: arabicName,
          unit: values.unit ?? 'piece',
          salePrice: this.decimal(values.saleprice) ?? new Prisma.Decimal(0),
          taxRate: this.decimal(values.taxrate) ?? new Prisma.Decimal(0),
          isStockTracked: this.boolean(values.isstocktracked) ?? true,
          notes: values.notes ?? null,
        },
      });
      return;
    }

    const shared = {
      companyId,
      code: values.code,
      nameEn: englishName,
      nameAr: arabicName,
      phone: values.phone ?? null,
      email: values.email ?? null,
      taxNumber: values.taxnumber ?? null,
      address: values.address ?? null,
      notes: values.notes ?? null,
    };

    if (kind === 'customers') {
      const creditLimit = this.decimal(values.creditlimit);
      await this.prisma.customer.create({
        data: {
          ...shared,
          // An absent cell means no limit was given, which is not the same as
          // a limit of zero.
          ...(creditLimit ? { creditLimit } : {}),
        },
      });
    } else {
      await this.prisma.supplier.create({ data: shared });
    }
  }

  /// An upsert only touches the columns the file actually carried: a blank
  /// cell means "leave it as it is", never "erase it".
  private async updateOne(
    kind: ImportKind,
    companyId: string,
    code: string,
    values: Record<string, string>,
  ): Promise<void> {
    if (kind === 'items') {
      const data: Prisma.ItemUpdateManyMutationInput = {};
      if (values.nameen) data.nameEn = values.nameen;
      if (values.namear) data.nameAr = values.namear;
      if (values.unit) data.unit = values.unit;
      if (values.saleprice !== undefined) {
        data.salePrice = this.decimal(values.saleprice);
      }
      if (values.taxrate !== undefined) data.taxRate = this.decimal(values.taxrate);
      if (values.isstocktracked !== undefined) {
        data.isStockTracked = this.boolean(values.isstocktracked);
      }
      if (values.notes) data.notes = values.notes;
      await this.prisma.item.updateMany({ where: { companyId, code }, data });
      return;
    }

    const table = kind === 'customers' ? 'customer' : 'supplier';
    const data: Record<string, unknown> = {};
    if (values.nameen) data.nameEn = values.nameen;
    if (values.namear) data.nameAr = values.namear;
    if (values.phone) data.phone = values.phone;
    if (values.email) data.email = values.email;
    if (values.taxnumber) data.taxNumber = values.taxnumber;
    if (values.address) data.address = values.address;
    if (values.notes) data.notes = values.notes;
    if (kind === 'customers' && values.creditlimit !== undefined) {
      data.creditLimit = this.decimal(values.creditlimit);
    }

    if (table === 'customer') {
      await this.prisma.customer.updateMany({
        where: { companyId, code },
        data: data as Prisma.CustomerUpdateManyMutationInput,
      });
    } else {
      await this.prisma.supplier.updateMany({
        where: { companyId, code },
        data: data as Prisma.SupplierUpdateManyMutationInput,
      });
    }
  }
}
