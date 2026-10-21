import { createHash } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { AccountType, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OpeningBalancesService } from '../accounting/opening-balances.service';
import {
  ImportFormatError,
  isXlsx,
  normaliseHeader,
  readCsv,
  readXlsx,
  Sheet,
} from './tabular';

export type ImportKind =
  | 'customers'
  | 'suppliers'
  | 'items'
  | 'chart-of-accounts'
  | 'opening-balances';

export const IMPORT_KINDS: ImportKind[] = [
  'customers',
  'suppliers',
  'items',
  'chart-of-accounts',
  'opening-balances',
];

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
  enumValues?: string[];
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
  /// The opening-balance draft created by a committed workbook.
  draft?: { id: string; documentNumber: string; status: string };
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
    private readonly openingBalances: OpeningBalancesService,
  ) {}

  // ───────────────────────────────────────────────────── the columns

  private fields(kind: ImportKind): FieldSpec[] {
    if (kind === 'chart-of-accounts') {
      return [
        {
          key: 'code', labelEn: 'Code', labelAr: 'الكود', required: true,
          example: '6101', maxLength: 50, aliases: ['accountcode', 'كود الحساب'],
        },
        {
          key: 'nameen', labelEn: 'Name (English)', labelAr: 'الاسم (إنجليزي)',
          required: true, example: 'Office supplies', maxLength: 200,
          aliases: ['name', 'englishname', 'الاسمبالانجليزية', 'الاسمبالانجليزيه'],
        },
        {
          key: 'namear', labelEn: 'Name (Arabic)', labelAr: 'الاسم (عربي)',
          required: true, example: 'مصروفات مكتبية', maxLength: 200,
          aliases: ['arabicname', 'الاسمبالعربية', 'الاسمبالعربيه'],
        },
        {
          key: 'type', labelEn: 'Account type', labelAr: 'نوع الحساب',
          required: true, example: 'EXPENSE', maxLength: 20,
          enumValues: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'],
          aliases: ['accounttype', 'type', 'النوع'],
        },
        {
          key: 'parentcode', labelEn: 'Parent code', labelAr: 'كود الحساب الأب',
          example: '', maxLength: 50, aliases: ['parent', 'parentaccountcode'],
        },
        {
          key: 'ispostable', labelEn: 'Can receive postings', labelAr: 'يقبل القيود',
          example: 'yes', boolean: true, aliases: ['postable', 'ispostable'],
        },
        {
          key: 'isactive', labelEn: 'Active', labelAr: 'نشط',
          example: 'yes', boolean: true, aliases: ['active', 'isactive'],
        },
        {
          key: 'currency', labelEn: 'Currency', labelAr: 'العملة',
          example: 'EGP', maxLength: 3,
        },
        {
          key: 'description', labelEn: 'Description', labelAr: 'الوصف',
          example: '', maxLength: 500, aliases: ['notes', 'ملاحظات'],
        },
      ];
    }

    if (kind === 'opening-balances') {
      return [
        {
          key: 'asofdate', labelEn: 'As-of date (YYYY-MM-DD)', labelAr: 'تاريخ الأرصدة (سنة-شهر-يوم)',
          required: true, example: '2026-01-01', maxLength: 10,
          aliases: ['date', 'asofdate', 'تاريخ'],
        },
        {
          key: 'branchcode', labelEn: 'Branch code (optional)', labelAr: 'كود الفرع (اختياري)',
          example: '', maxLength: 20, aliases: ['branch', 'كودالفرع'],
        },
        {
          key: 'warehousecode', labelEn: 'Warehouse code (optional)', labelAr: 'كود المخزن (اختياري)',
          example: '', maxLength: 40, aliases: ['warehouse', 'كودالمخزن'],
        },
        {
          key: 'accountcode', labelEn: 'Account code', labelAr: 'كود الحساب',
          required: true, example: '1101', maxLength: 50,
          aliases: ['account', 'كودالحساب'],
        },
        {
          key: 'debit', labelEn: 'Debit', labelAr: 'مدين', example: '1000.00',
          decimal: true, aliases: ['debitamount', 'مدين'],
        },
        {
          key: 'credit', labelEn: 'Credit', labelAr: 'دائن', example: '0',
          decimal: true, aliases: ['creditamount', 'دائن'],
        },
        {
          key: 'customercode', labelEn: 'Customer code (optional)', labelAr: 'كود العميل (اختياري)',
          example: '', maxLength: 40, aliases: ['customer', 'كودالعميل'],
        },
        {
          key: 'suppliercode', labelEn: 'Supplier code (optional)', labelAr: 'كود المورد (اختياري)',
          example: '', maxLength: 40, aliases: ['supplier', 'كودالمورد'],
        },
        {
          key: 'itemcode', labelEn: 'Item code (optional)', labelAr: 'كود الصنف (اختياري)',
          example: '', maxLength: 40, aliases: ['item', 'كودالصنف'],
        },
        {
          key: 'quantity', labelEn: 'Opening quantity', labelAr: 'الكمية الافتتاحية',
          example: '', decimal: true, aliases: ['qty', 'quantity'],
        },
        {
          key: 'unitcost', labelEn: 'Unit cost', labelAr: 'تكلفة الوحدة',
          example: '', decimal: true, aliases: ['cost', 'unitcost'],
        },
        {
          key: 'description', labelEn: 'Description', labelAr: 'الوصف',
          example: 'Opening balances', maxLength: 500, aliases: ['notes', 'ملاحظات'],
        },
      ];
    }

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

    // Nothing but a header and one example row goes on the sheet that is
    // uploaded. Notes used to sit under the example on the same sheet, which
    // meant the file this screen hands out could not be uploaded back
    // without being edited first - and the errors it produced looked like
    // the screen was broken. They have their own sheet now; the importer
    // reads the first one and ignores the rest.
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
    if (kind === 'opening-balances') {
      const examples: Array<Record<string, string>> = [
        {
          asofdate: '2026-01-01', accountcode: '1101', debit: '1000.00',
          credit: '0', description: 'Opening cash',
        },
        {
          asofdate: '2026-01-01', accountcode: '3101', debit: '0',
          credit: '1000.00', description: 'Opening capital',
        },
      ];
      for (const example of examples) {
        sheet.addRow(fields.map((field) => example[field.key] ?? ''));
      }
    } else {
      sheet.addRow(fields.map((field) => field.example));
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    // The same columns named in Arabic, so a sheet filled in from an Arabic
    // Excel still matches, and the notes a person needs before they start.
    const notes = workbook.addWorksheet('Instructions');
    notes.columns = [{ width: 26 }, { width: 26 }, { width: 22 }, { width: 60 }];
    notes.addRow(['English column', 'Arabic column', 'Required', 'Notes']).font = {
      bold: true,
    };
    for (const field of fields) {
      const detail = [
        field.required ? 'required' : 'optional',
        field.maxLength === undefined
            ? null
            : `up to ${field.maxLength} characters`,
        field.decimal ? 'a number' : null,
        field.boolean ? 'yes or no' : null,
      ].filter(Boolean);
      notes.addRow([
        field.labelEn,
        field.labelAr,
        field.required ? 'Required' : 'Optional',
        detail.join(', '),
      ]);
    }
    notes.addRow([]);
    const { en, ar } = this.instructions(kind);
    for (const line of en) notes.addRow([line]);
    notes.addRow([]);
    for (const line of ar) notes.addRow([line]);

    fields.forEach((field, index) => {
      sheet.getColumn(index + 1).width = Math.max(field.labelEn.length + 4, 14);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private instructions(kind: ImportKind): { en: string[]; ar: string[] } {
    if (kind === 'opening-balances') {
      return {
        en: [
          'The two example lines balance each other. Delete both before entering your opening figures.',
          'Every row in one file must use the same date, branch and warehouse. Leave branch blank to use your assigned branch.',
          'Debit must equal credit across all rows. Import creates a draft only; review it in Opening balances and post it there.',
          'For stock lines, choose the inventory account and enter the item code, positive quantity and unit cost; quantity × cost must equal the debit.',
          'Use each stock item on one row only; combine its opening quantity and cost instead of repeating the item code.',
        ],
        ar: [
          'سطرَا المثال متوازنان. احذفهما قبل إدخال أرصدتك الافتتاحية.',
          'يجب أن تستخدم كل الصفوف في الملف التاريخ والفرع والمخزن نفسه. اترك الفرع فارغاً لاستخدام فرعك الحالي.',
          'يجب أن يتساوى إجمالي المدين والدائن. الاستيراد ينشئ مسودة فقط؛ راجعها ورحّلها من شاشة الأرصدة الافتتاحية.',
          'لبنود المخزون، اختر حساب المخزون وأدخل كود الصنف وكمية موجبة وتكلفة الوحدة؛ يجب أن تساوي الكمية × التكلفة مبلغ المدين.',
          'استخدم كل صنف مخزني في صف واحد فقط؛ اجمع كمية وتكلفة الرصيد الافتتاحي ولا تكرر كود الصنف.',
        ],
      };
    }
    if (kind === 'chart-of-accounts') {
      return {
        en: [
          'Use one row per account. Codes must be unique in this company; existing codes are left unchanged.',
          'Account types: ASSET, LIABILITY, EQUITY, REVENUE or EXPENSE. A parent account must have the same type.',
          'Import parents and children in any order. Leave Parent code empty for a top-level account.',
          'Accounts with children become grouping accounts and cannot receive postings.',
        ],
        ar: [
          'استخدم صفاً واحداً لكل حساب. يجب أن يكون الكود فريداً في الشركة؛ الأكواد الموجودة لن تتغير.',
          'أنواع الحسابات: ASSET أو LIABILITY أو EQUITY أو REVENUE أو EXPENSE. يجب أن يطابق نوع الحساب الأب.',
          'يمكن استيراد الآباء والأبناء بأي ترتيب. اترك كود الأب فارغاً للحساب الرئيسي.',
          'الحساب الذي له حسابات فرعية يصبح تجميعياً ولا يستقبل قيوداً.',
        ],
      };
    }

    const required = this.fields(kind)
      .filter((field) => field.required)
      .map((field) => field.labelEn)
      .join(', ');

    return {
      en: [
        `Required columns: ${required}. Delete the example row before uploading.`,
        'The upload sheet contains only the header and one example row. The Instructions sheet is not imported.',
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
    branchId: string | null = null,
    canImportAcrossBranches = false,
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

    if (kind === 'chart-of-accounts') {
      return this.runChartOfAccounts(companyId, userId, file.originalname, sheet, options);
    }
    if (kind === 'opening-balances') {
      return this.runOpeningBalances(
        companyId,
        branchId,
        userId,
        file.originalname,
        sheet,
        options,
        file.buffer,
        canImportAcrossBranches,
      );
    }

    const fields = this.fields(kind);
    const byHeader = new Map<string, FieldSpec>();
    for (const field of fields) {
      byHeader.set(field.key, field);
      // The names this program writes into its own template are the English
      // and Arabic labels, so they have to be recognised here too. Without
      // them a file downloaded from this screen came back half-understood:
      // "Name (English)" and "Name (Arabic)" were reported as columns nobody
      // knew, and the records were written without them.
      byHeader.set(normaliseHeader(field.labelEn), field);
      byHeader.set(normaliseHeader(field.labelAr), field);
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
    const writes: Array<(tx: Prisma.TransactionClient) => Promise<void>> = [];

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

      // A column the file does not carry at all leaves no value behind, and a
      // blank cell in a column it does carry leaves an empty one. Both mean
      // the record cannot be written, and a required field with nothing in it
      // must be named rather than quietly defaulted.
      if (rowCode) {
        for (const field of fields) {
          if (field.required && !values[field.key]) {
            errors.push({
              row: row.rowNumber,
              column: field.labelEn,
              message: `${field.labelEn} is required`,
            });
          }
        }
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
          writes.push((tx) =>
            this.updateOne(tx, kind, companyId, rowCode, values),
          );
        }
      } else {
        created += 1;
        preview.push({ row: row.rowNumber, code: rowCode, action: 'created' });
        if (!options.dryRun) {
          writes.push((tx) =>
            this.createOne(tx, kind, companyId, values),
          );
        }
      }
    }

    // The whole file lands or none of it does. A half-imported list is worse
    // than a failed one, because nobody can tell where it stopped.
    if (!options.dryRun && errors.length === 0 && writes.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const write of writes) await write(tx);
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
    } else if (!options.dryRun && errors.length > 0) {
      // A commit is all-or-nothing even if some other rows are valid. The
      // preview already carries the valid-row counts; this response states
      // clearly that the requested write saved nothing.
      created = 0;
      updated = 0;
      skipped = 0;
      preview.length = 0;
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

  // ───────────────────────────────────────────── accounting workbook imports

  /// Parse the two accounting templates with the same bilingual headers and
  /// row-level diagnostics as the master-data importer.
  private parseSpecialRows(sheet: Sheet, kind: ImportKind): {
    rows: Array<{ rowNumber: number; values: Record<string, string> }>;
    errors: RowError[];
    unknownColumns: string[];
  } {
    const fields = this.fields(kind);
    const byHeader = new Map<string, FieldSpec>();
    for (const field of fields) {
      byHeader.set(field.key, field);
      byHeader.set(normaliseHeader(field.labelEn), field);
      byHeader.set(normaliseHeader(field.labelAr), field);
      for (const alias of field.aliases ?? []) {
        byHeader.set(normaliseHeader(alias), field);
      }
    }

    const unknownColumns = sheet.headers
      .map((header) => header.trim())
      .filter((header) => header !== '')
      .filter((header) => !byHeader.has(normaliseHeader(header)));
    const errors: RowError[] = [];
    const rows: Array<{ rowNumber: number; values: Record<string, string> }> = [];

    for (const row of sheet.rows) {
      const values: Record<string, string> = {};
      const errorCount = errors.length;
      for (const [header, raw] of Object.entries(row.values)) {
        const field = byHeader.get(normaliseHeader(header));
        if (!field) continue;
        const value = raw.trim();
        if (!value) continue;
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
        if (field.enumValues) {
          const normalised = value.toUpperCase();
          if (!field.enumValues.includes(normalised)) {
            errors.push({
              row: row.rowNumber,
              column: field.labelEn,
              message: `${field.labelEn} must be one of: ${field.enumValues.join(', ')}`,
            });
            continue;
          }
          values[field.key] = normalised;
          continue;
        }
        if (field.boolean) {
          const normalised = this.parseBoolean(value);
          if (normalised === null) {
            errors.push({
              row: row.rowNumber,
              column: field.labelEn,
              message: `${field.labelEn} must be yes/no, true/false, 1/0, نعم/لا or صح/خطأ`,
            });
            continue;
          }
          values[field.key] = normalised;
          continue;
        }
        values[field.key] = value;
      }

      for (const field of fields) {
        if (field.required && !values[field.key]) {
          errors.push({
            row: row.rowNumber,
            column: field.labelEn,
            message: `${field.labelEn} is required`,
          });
        }
      }
      if (errors.length === errorCount) rows.push({ rowNumber: row.rowNumber, values });
    }

    return { rows, errors, unknownColumns };
  }

  private parseBoolean(value: string): string | null {
    const text = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'نعم', 'صح', 'ايوه', 'أيوه'].includes(text)) {
      return 'true';
    }
    if (['false', 'no', 'n', '0', 'لا', 'خطأ', 'غلط'].includes(text)) {
      return 'false';
    }
    return null;
  }

  private emptyAccountingReport(
    kind: ImportKind,
    fileName: string,
    options: { dryRun: boolean; mode: Mode },
    totalRows: number,
    errors: RowError[],
    unknownColumns: string[],
  ): ImportReport {
    return {
      kind,
      dryRun: options.dryRun,
      mode: options.mode,
      fileName,
      totalRows,
      created: 0,
      updated: 0,
      skipped: 0,
      errors,
      preview: [],
      unknownColumns,
      validRows: 0,
    };
  }

  private async runChartOfAccounts(
    companyId: string,
    userId: string,
    fileName: string,
    sheet: Sheet,
    options: { dryRun: boolean; mode: Mode },
  ): Promise<ImportReport> {
    const kind: ImportKind = 'chart-of-accounts';
    const parsed = this.parseSpecialRows(sheet, kind);
    const errors = [...parsed.errors];
    const preview: RowOutcome[] = [];
    type AccountImportRow = {
      rowNumber: number;
      code: string;
      nameEn: string;
      nameAr: string;
      type: AccountType;
      parentCode: string | null;
      isPostable: boolean | null;
      isActive: boolean;
      currency: string | null;
      description: string | null;
    };
    const accountRows = new Map<string, AccountImportRow>();
    const seen = new Set<string>();

    for (const row of parsed.rows) {
      const code = row.values.code?.trim() ?? '';
      if (!/^[A-Za-z0-9_.-]{1,50}$/.test(code)) {
        errors.push({ row: row.rowNumber, column: 'Code', message: 'Code must contain 1–50 letters, digits, dots, dashes or underscores' });
        continue;
      }
      if (seen.has(code)) {
        errors.push({ row: row.rowNumber, column: 'Code', message: `Code "${code}" appears more than once in this file` });
        continue;
      }
      seen.add(code);
      const currency = row.values.currency?.trim().toUpperCase() || null;
      if (currency && !/^[A-Z]{3}$/.test(currency)) {
        errors.push({ row: row.rowNumber, column: 'Currency', message: 'Currency must be a three-letter code such as EGP' });
        continue;
      }
      accountRows.set(code, {
        rowNumber: row.rowNumber,
        code,
        nameEn: row.values.nameen,
        nameAr: row.values.namear,
        type: row.values.type as AccountType,
        parentCode: row.values.parentcode?.trim() || null,
        isPostable: row.values.ispostable === undefined ? null : row.values.ispostable === 'true',
        isActive: row.values.isactive !== 'false',
        currency,
        description: row.values.description?.trim() || null,
      });
    }

    if (sheet.rows.length === 0) {
      errors.push({ row: 0, column: 'File', message: 'The spreadsheet has no account rows' });
    }

    const codes = [...new Set([
      ...accountRows.keys(),
      ...[...accountRows.values()].map((row) => row.parentCode).filter((code): code is string => Boolean(code)),
    ])];
    const existingRows = codes.length === 0
      ? []
      : await this.prisma.account.findMany({
          where: { companyId, code: { in: codes } },
          select: { id: true, code: true, type: true, parentId: true, isPostable: true, isActive: true, deletedAt: true },
        });
    const existing = new Map(existingRows.map((account) => [account.code, account]));
    const newRows = new Map<string, AccountImportRow>();

    for (const [code, row] of accountRows) {
      const old = existing.get(code);
      if (old?.deletedAt) {
        errors.push({ row: row.rowNumber, column: 'Code', message: `Code "${code}" is reserved by a deleted account and cannot be reused` });
        continue;
      }
      if (old) {
        preview.push({ row: row.rowNumber, code, action: 'skipped' });
        continue;
      }
      newRows.set(code, row);
    }

    for (const row of newRows.values()) {
      if (!row.parentCode) continue;
      const fileParent = newRows.get(row.parentCode);
      const dbParent = existing.get(row.parentCode);
      if (!fileParent && (!dbParent || dbParent.deletedAt)) {
        errors.push({ row: row.rowNumber, column: 'Parent code', message: `Parent account "${row.parentCode}" does not exist in this company or this file` });
        continue;
      }
      const parentType = fileParent?.type ?? dbParent?.type;
      const parentActive = fileParent?.isActive ?? dbParent?.isActive;
      if (parentType !== row.type) {
        errors.push({ row: row.rowNumber, column: 'Parent code', message: 'A sub-account must have the same type as its parent' });
      }
      if (!parentActive) {
        errors.push({ row: row.rowNumber, column: 'Parent code', message: `Parent account "${row.parentCode}" is inactive` });
      }
    }

    // Follow parent links among new rows to catch self references and cycles
    // before any account is written.
    for (const row of newRows.values()) {
      const path: string[] = [];
      const visited = new Set<string>();
      let code: string | null = row.code;
      while (code && newRows.has(code)) {
        if (visited.has(code)) {
          errors.push({ row: row.rowNumber, column: 'Parent code', message: 'The parent hierarchy contains a cycle' });
          break;
        }
        visited.add(code);
        path.push(code);
        code = newRows.get(code)?.parentCode ?? null;
      }
    }

    if (errors.length === 0) {
      for (const row of newRows.values()) {
        preview.push({ row: row.rowNumber, code: row.code, action: 'created' });
      }
    }

    if (!options.dryRun && errors.length === 0 && newRows.size > 0) {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.account.findMany({
          where: { companyId, code: { in: codes } },
          select: { id: true, code: true, type: true, parentId: true, isPostable: true, isActive: true, deletedAt: true },
        });
        const currentByCode = new Map(current.map((account) => [account.code, account]));
        for (const row of newRows.values()) {
          if (currentByCode.has(row.code)) {
            throw new BadRequestException(`Account code "${row.code}" changed while this workbook was being imported. Read it again and retry.`);
          }
        }
        const idByCode = new Map<string, string>();
        for (const account of current) {
          if (!account.deletedAt) idByCode.set(account.code, account.id);
        }
        const remaining = new Map(newRows);
        while (remaining.size > 0) {
          let progressed = false;
          for (const [code, row] of [...remaining]) {
            const parentId = row.parentCode ? idByCode.get(row.parentCode) : null;
            if (row.parentCode && !parentId) continue;
            const created = await tx.account.create({
              data: {
                companyId,
                code: row.code,
                nameEn: row.nameEn,
                nameAr: row.nameAr,
                type: row.type,
                parentId: parentId ?? null,
                isPostable: row.isPostable ?? Boolean(parentId),
                isActive: row.isActive,
                currency: row.currency,
                description: row.description,
                createdBy: userId,
                updatedBy: userId,
              },
              select: { id: true },
            });
            idByCode.set(code, created.id);
            remaining.delete(code);
            progressed = true;

            if (parentId) {
              const parent = currentByCode.get(row.parentCode as string);
              const parentIsPostable = parent
                ? parent.isPostable
                : newRows.get(row.parentCode as string)?.isPostable ?? true;
              if (parentIsPostable) {
                const movements = await tx.journalLine.count({ where: { accountId: parentId } });
                if (movements > 0) {
                  throw new BadRequestException(
                    `Parent account "${row.parentCode}" already has ledger movements and cannot become a grouping account. Nothing was imported.`,
                  );
                }
                await tx.account.update({
                  where: { id: parentId },
                  data: { isPostable: false, updatedBy: userId },
                });
              }
            }
          }
          if (!progressed) {
            throw new BadRequestException('The parent hierarchy changed or contains an unresolved cycle. Nothing was imported.');
          }
        }
      });

      await this.audit.record({
        companyId,
        userId,
        action: 'IMPORT',
        entity: 'accounts',
        entityId: null,
        after: { fileName, created: newRows.size, skipped: preview.filter((row) => row.action === 'skipped').length },
      });
    }

    if (!options.dryRun && errors.length > 0) {
      return this.emptyAccountingReport(kind, fileName, options, sheet.rows.length, errors, parsed.unknownColumns);
    }

    return {
      kind,
      dryRun: options.dryRun,
      mode: options.mode,
      fileName,
      totalRows: sheet.rows.length,
      created: newRows.size,
      updated: 0,
      skipped: preview.filter((row) => row.action === 'skipped').length,
      errors,
      preview: preview.slice(0, 50),
      unknownColumns: parsed.unknownColumns,
      validRows: newRows.size,
    };
  }

  private async runOpeningBalances(
    companyId: string,
    assignedBranchId: string | null,
    userId: string,
    fileName: string,
    sheet: Sheet,
    options: { dryRun: boolean; mode: Mode },
    fileBuffer: Buffer,
    canImportAcrossBranches: boolean,
  ): Promise<ImportReport> {
    const kind: ImportKind = 'opening-balances';
    const parsed = this.parseSpecialRows(sheet, kind);
    const errors = [...parsed.errors];
    const rows = parsed.rows;
    const emptyReport = () =>
      this.emptyAccountingReport(kind, fileName, options, sheet.rows.length, errors, parsed.unknownColumns);

    if (sheet.rows.length === 0) {
      errors.push({ row: 0, column: 'File', message: 'The spreadsheet has no opening-balance lines' });
    }
    if (sheet.rows.length > 1000) {
      errors.push({ row: 0, column: 'File', message: 'An opening-balance import may contain at most 1,000 lines' });
    }
    if (rows.length < 2) {
      errors.push({ row: 0, column: 'File', message: 'An opening balance needs at least two valid lines' });
    }
    if (errors.length > 0) return emptyReport();

    const distinct = (key: string) => new Set(rows.map((row) => row.values[key]?.trim() ?? ''));
    const dates = distinct('asofdate');
    const branchCodes = distinct('branchcode');
    const warehouseCodes = distinct('warehousecode');
    if (dates.size !== 1) {
      errors.push({ row: 0, column: 'As-of date', message: 'All lines must use the same as-of date' });
    }
    if (branchCodes.size !== 1) {
      errors.push({ row: 0, column: 'Branch code', message: 'All lines must use the same branch, or leave the branch blank on every line' });
    }
    if (warehouseCodes.size !== 1) {
      errors.push({ row: 0, column: 'Warehouse code', message: 'All lines must use the same warehouse, or leave the warehouse blank on every line' });
    }
    const asOfDate = this.importDate(rows[0]?.values.asofdate ?? '');
    if (!asOfDate) {
      errors.push({ row: rows[0]?.rowNumber ?? 1, column: 'As-of date', message: 'Use a valid date in YYYY-MM-DD format' });
    }
    if (errors.length > 0) return emptyReport();

    const branchCode = [...branchCodes][0] ?? '';
    const branch = branchCode
      ? await this.prisma.branch.findFirst({
          where: { companyId, code: branchCode, deletedAt: null },
          select: { id: true, code: true, isActive: true },
        })
      : assignedBranchId
        ? await this.prisma.branch.findFirst({
            where: { id: assignedBranchId, companyId, deletedAt: null },
            select: { id: true, code: true, isActive: true },
          })
        : null;
    if (!branch) {
      errors.push({ row: rows[0]?.rowNumber ?? 1, column: 'Branch code', message: branchCode ? `Branch "${branchCode}" does not exist in this company` : 'Select a branch or assign one to the current user' });
    } else if (!branch.isActive) {
      errors.push({ row: rows[0]?.rowNumber ?? 1, column: 'Branch code', message: `Branch "${branch.code}" is inactive` });
    } else if (
      assignedBranchId &&
      !canImportAcrossBranches &&
      branch.id !== assignedBranchId
    ) {
      errors.push({
        row: rows[0]?.rowNumber ?? 1,
        column: 'Branch code',
        message: `Branch "${branch.code}" is outside your assigned branch.`,
      });
    }

    const warehouseCode = [...warehouseCodes][0] ?? '';
    let warehouseId: string | undefined;
    if (branch && warehouseCode) {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: { companyId, branchId: branch.id, code: warehouseCode, deletedAt: null },
        select: { id: true, code: true, isActive: true },
      });
      if (!warehouse) {
        errors.push({ row: rows[0]?.rowNumber ?? 1, column: 'Warehouse code', message: `Warehouse "${warehouseCode}" does not exist in branch "${branch.code}"` });
      } else if (!warehouse.isActive) {
        errors.push({ row: rows[0]?.rowNumber ?? 1, column: 'Warehouse code', message: `Warehouse "${warehouseCode}" is inactive` });
      } else {
        warehouseId = warehouse.id;
      }
    }

    const accountCodes = [...new Set(rows.map((row) => row.values.accountcode))];
    const itemCodes = [...new Set(rows.map((row) => row.values.itemcode).filter(Boolean))];
    const customerCodes = [...new Set(rows.map((row) => row.values.customercode).filter(Boolean))];
    const supplierCodes = [...new Set(rows.map((row) => row.values.suppliercode).filter(Boolean))];
    const [accounts, items, customers, suppliers, inventoryAccount] = await Promise.all([
      this.prisma.account.findMany({
        where: { companyId, code: { in: accountCodes }, deletedAt: null },
        select: { id: true, code: true, isPostable: true, isActive: true },
      }),
      itemCodes.length
        ? this.prisma.item.findMany({
            where: { companyId, code: { in: itemCodes }, deletedAt: null },
            select: { id: true, code: true, isStockTracked: true },
          })
        : Promise.resolve([]),
      customerCodes.length
        ? this.prisma.customer.findMany({
            where: { companyId, code: { in: customerCodes }, deletedAt: null },
            select: { id: true, code: true },
          })
        : Promise.resolve([]),
      supplierCodes.length
        ? this.prisma.supplier.findMany({
            where: { companyId, code: { in: supplierCodes }, deletedAt: null },
            select: { id: true, code: true },
          })
        : Promise.resolve([]),
      itemCodes.length
        ? this.prisma.account.findFirst({
            where: { companyId, code: '1104', deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    const accountByCode = new Map(accounts.map((account) => [account.code, account]));
    const itemByCode = new Map(items.map((item) => [item.code, item]));
    const customerByCode = new Map(customers.map((customer) => [customer.code, customer]));
    const supplierByCode = new Map(suppliers.map((supplier) => [supplier.code, supplier]));
    const preparedLines: Array<Record<string, string | undefined>> = [];
    const seenStockItems = new Map<string, number>();
    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);

    for (const row of rows) {
      const values = row.values;
      const account = accountByCode.get(values.accountcode);
      if (!account) {
        errors.push({ row: row.rowNumber, column: 'Account code', message: `Account "${values.accountcode}" does not exist in this company` });
      } else if (!account.isActive || !account.isPostable) {
        errors.push({ row: row.rowNumber, column: 'Account code', message: `Account "${values.accountcode}" is inactive or cannot receive postings` });
      }
      const itemCode = values.itemcode?.trim() ?? '';
      const item = itemCode ? itemByCode.get(itemCode) : undefined;
      if (itemCode && !item) {
        errors.push({ row: row.rowNumber, column: 'Item code', message: `Item "${itemCode}" does not exist in this company` });
      }
      const customerCode = values.customercode?.trim() ?? '';
      const customer = customerCode ? customerByCode.get(customerCode) : undefined;
      if (customerCode && !customer) {
        errors.push({ row: row.rowNumber, column: 'Customer code', message: `Customer "${customerCode}" does not exist in this company` });
      }
      const supplierCode = values.suppliercode?.trim() ?? '';
      const supplier = supplierCode ? supplierByCode.get(supplierCode) : undefined;
      if (supplierCode && !supplier) {
        errors.push({ row: row.rowNumber, column: 'Supplier code', message: `Supplier "${supplierCode}" does not exist in this company` });
      }

      const debit = new Prisma.Decimal(values.debit || '0').toDecimalPlaces(4);
      const credit = new Prisma.Decimal(values.credit || '0').toDecimalPlaces(4);
      if (debit.isNegative() || credit.isNegative()) {
        errors.push({ row: row.rowNumber, column: 'Debit/Credit', message: 'Debit and credit amounts cannot be negative' });
      }
      if (debit.isZero() && credit.isZero()) {
        errors.push({ row: row.rowNumber, column: 'Debit/Credit', message: 'Each line needs either a debit or a credit' });
      }
      if (!debit.isZero() && !credit.isZero()) {
        errors.push({ row: row.rowNumber, column: 'Debit/Credit', message: 'A line cannot contain both a debit and a credit' });
      }

      const hasQuantity = Boolean(values.quantity);
      const hasUnitCost = Boolean(values.unitcost);
      if (!item && (hasQuantity || hasUnitCost)) {
        errors.push({ row: row.rowNumber, column: 'Item code', message: 'Quantity and unit cost require an item code' });
      }
      let quantity: Prisma.Decimal | null = null;
      let unitCost: Prisma.Decimal | null = null;
      if (item?.isStockTracked) {
        const previousRow = seenStockItems.get(item.id);
        if (previousRow !== undefined) {
          errors.push({
            row: row.rowNumber,
            column: 'Item code',
            message: `Stock item "${itemCode}" is repeated on rows ${previousRow} and ${row.rowNumber}; consolidate its quantity and cost into one line`,
          });
        } else {
          seenStockItems.set(item.id, row.rowNumber);
        }
        if (!hasQuantity || !hasUnitCost) {
          errors.push({ row: row.rowNumber, column: 'Quantity / Unit cost', message: 'A stock item needs both quantity and unit cost' });
        } else {
          quantity = new Prisma.Decimal(values.quantity as string).toDecimalPlaces(4);
          unitCost = new Prisma.Decimal(values.unitcost as string).toDecimalPlaces(4);
          if (!quantity.greaterThan(0)) {
            errors.push({ row: row.rowNumber, column: 'Quantity', message: 'Stock quantity must be greater than zero' });
          }
          if (unitCost.isNegative()) {
            errors.push({ row: row.rowNumber, column: 'Unit cost', message: 'Unit cost cannot be negative' });
          }
          if (!debit.equals(quantity.mul(unitCost).toDecimalPlaces(4))) {
            errors.push({ row: row.rowNumber, column: 'Debit', message: 'Debit must equal quantity × unit cost for a stock line' });
          }
          if (!inventoryAccount || account?.id !== inventoryAccount.id) {
            errors.push({ row: row.rowNumber, column: 'Account code', message: 'Stock opening lines must use the company inventory account (1104)' });
          }
        }
      } else if (item && (hasQuantity || hasUnitCost)) {
        errors.push({ row: row.rowNumber, column: 'Quantity / Unit cost', message: 'Non-stock items cannot carry opening quantity or cost' });
      }

      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
      if (account && (!itemCode || item) && (!customerCode || customer) && (!supplierCode || supplier)) {
        preparedLines.push({
          accountId: account.id,
          debit: debit.toFixed(4),
          credit: credit.toFixed(4),
          customerId: customer?.id,
          supplierId: supplier?.id,
          itemId: item?.id,
          quantity: quantity?.toFixed(4),
          unitCost: unitCost?.toFixed(4),
          description: values.description?.trim() || undefined,
        });
      }
    }

    if (!totalDebit.equals(totalCredit)) {
      errors.push({
        row: 0,
        column: 'Debit/Credit',
        message: `The workbook is not balanced: debit ${totalDebit.toFixed(4)} does not equal credit ${totalCredit.toFixed(4)}`,
      });
    }
    if (errors.length > 0 || !branch || !asOfDate) return emptyReport();

    const fingerprint = createHash('sha256').update(fileBuffer).digest('hex');
    const outcome: RowOutcome = {
      row: rows[0]?.rowNumber ?? 1,
      code: 'Opening balance draft',
      action: 'created',
    };
    const replayReport = (existing: { id: string; documentNumber: string; status: string }): ImportReport => ({
      kind,
      dryRun: options.dryRun,
      mode: options.mode,
      fileName,
      totalRows: sheet.rows.length,
      created: 0,
      updated: 0,
      skipped: 1,
      errors: [],
      preview: [{ ...outcome, action: 'skipped' }],
      unknownColumns: parsed.unknownColumns,
      validRows: rows.length,
      draft: { id: existing.id, documentNumber: existing.documentNumber, status: existing.status },
    });
    const findExistingImport = () => this.prisma.openingBalance.findFirst({
      where: { companyId, importFingerprint: fingerprint },
      select: { id: true, documentNumber: true, status: true },
    });

    const previousImport = await findExistingImport();
    if (previousImport) return replayReport(previousImport);

    let draft: ImportReport['draft'];
    if (!options.dryRun) {
      let created: { id: string; documentNumber: string; status: string };
      try {
        created = await this.openingBalances.create(companyId, assignedBranchId, userId, {
          asOfDate,
          branchId: branch.id,
          warehouseId,
          description: `Imported from ${fileName}`,
          importFingerprint: fingerprint,
          lines: preparedLines as never,
        });
      } catch (error) {
        // The database's unique company/fingerprint index closes the race
        // between two simultaneous retries. Return the committed document
        // instead of asking the user to retry an already successful import.
        const isUniqueViolation = typeof error === 'object' && error !== null &&
          'code' in error && (error as { code?: unknown }).code === 'P2002';
        if (!isUniqueViolation) throw error;
        const concurrentImport = await findExistingImport();
        if (!concurrentImport) throw error;
        return replayReport(concurrentImport);
      }
      draft = { id: created.id, documentNumber: created.documentNumber, status: created.status };
      await this.audit.record({
        companyId,
        userId,
        action: 'IMPORT',
        entity: 'opening_balances',
        entityId: created.id,
        after: { fileName, documentNumber: created.documentNumber, lineCount: preparedLines.length },
      });
    }

    return {
      kind,
      dryRun: options.dryRun,
      mode: options.mode,
      fileName,
      totalRows: sheet.rows.length,
      created: 1,
      updated: 0,
      skipped: 0,
      errors,
      preview: [outcome],
      unknownColumns: parsed.unknownColumns,
      validRows: rows.length,
      draft,
    };
  }

  private importDate(value: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    return value;
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
    tx: Prisma.TransactionClient,
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
      await tx.item.create({
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
      await tx.customer.create({
        data: {
          ...shared,
          // An absent cell means no limit was given, which is not the same as
          // a limit of zero.
          ...(creditLimit ? { creditLimit } : {}),
        },
      });
    } else {
      await tx.supplier.create({ data: shared });
    }
  }

  /// An upsert only touches the columns the file actually carried: a blank
  /// cell means "leave it as it is", never "erase it".
  private async updateOne(
    tx: Prisma.TransactionClient,
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
      await tx.item.updateMany({ where: { companyId, code }, data });
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
      await tx.customer.updateMany({
        where: { companyId, code },
        data: data as Prisma.CustomerUpdateManyMutationInput,
      });
    } else {
      await tx.supplier.updateMany({
        where: { companyId, code },
        data: data as Prisma.SupplierUpdateManyMutationInput,
      });
    }
  }
}
