import { BadRequestException, Injectable } from '@nestjs/common';

import { ReportsService } from '../reports/reports.service';
import { PeriodQueryDto } from '../reports/dto/report-query.dto';
import { ReportTable, TableMeta, TableTotal } from './report-table';

/// The reports the exporter knows how to turn into a file.
export type ExportableReport =
  | 'trial-balance'
  | 'profit-and-loss'
  | 'customer-balances'
  | 'supplier-balances'
  | 'account-ledger';

export const EXPORTABLE_REPORTS: ExportableReport[] = [
  'trial-balance',
  'profit-and-loss',
  'customer-balances',
  'supplier-balances',
  'account-ledger',
];

/// Turns a report into a plain table.
///
/// Every writer - Excel, CSV, the printed page - works from this, so a report
/// only has to be described once. Keeping the amounts as the strings the API
/// already produced means no amount is ever re-parsed into a binary float on
/// its way into a file.
@Injectable()
export class ReportTablesService {
  constructor(private readonly reports: ReportsService) {}

  async build(
    report: ExportableReport,
    companyId: string,
    query: PeriodQueryDto & { accountId?: string },
    lang: 'ar' | 'en' = 'en',
  ): Promise<ReportTable> {
    switch (report) {
      case 'trial-balance':
        return this.trialBalance(companyId, query);
      case 'profit-and-loss':
        return this.profitAndLoss(companyId, query, lang);
      case 'customer-balances':
        return this.customerBalances(companyId, query);
      case 'supplier-balances':
        return this.supplierBalances(companyId, query);
      case 'account-ledger':
        return this.accountLedger(companyId, query, lang);
    }
  }

  // ───────────────────────────────────────────────────────────────

  private async trialBalance(companyId: string, query: PeriodQueryDto) {
    const data = await this.reports.trialBalance(companyId, query);
    const totals: TableTotal[] = [
      {
        labelEn: 'Total movement',
        labelAr: 'إجمالي الحركة',
        value: '',
      },
      {
        labelEn: 'Movement — debit',
        labelAr: 'حركة مدين',
        value: data.totals.debit,
      },
      {
        labelEn: 'Movement — credit',
        labelAr: 'حركة دائن',
        value: data.totals.credit,
      },
      {
        labelEn: 'Closing — debit',
        labelAr: 'رصيد ختامي مدين',
        value: data.totals.closingDebit,
      },
      {
        labelEn: 'Closing — credit',
        labelAr: 'رصيد ختامي دائن',
        value: data.totals.closingCredit,
      },
    ];
    // A difference of anything other than zero is a defect, so it is printed
    // in the report itself rather than hidden.
    totals.push({
      labelEn: 'Difference (must be zero)',
      labelAr: 'الفرق (لازم يكون صفر)',
      value: data.totals.difference,
    });

    return this.table({
      slug: 'trial-balance',
      titleEn: 'Trial balance',
      titleAr: 'ميزان المراجعة',
      meta: this.periodMeta(data.from, data.to),
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 12 },
        { key: 'nameEn', labelEn: 'Account', labelAr: 'الحساب', width: 34 },
        { key: 'nameAr', labelEn: 'Account (Arabic)', labelAr: 'الحساب بالعربية', width: 34 },
        { key: 'opening', labelEn: 'Opening', labelAr: 'رصيد افتتاحي', numeric: true, width: 16 },
        { key: 'debit', labelEn: 'Debit', labelAr: 'مدين', numeric: true, width: 16 },
        { key: 'credit', labelEn: 'Credit', labelAr: 'دائن', numeric: true, width: 16 },
        { key: 'closing', labelEn: 'Closing', labelAr: 'رصيد ختامي', numeric: true, width: 16 },
      ],
      rows: data.rows,
      totals,
      notes: [
        {
          en: 'Every figure comes from the posted journal, and reversals are included.',
          ar: 'كل رقم جاي من القيود المُرحَّلة، والقيود المعكوسة داخلة في الحساب.',
        },
      ],
    });
  }

  private async profitAndLoss(
    companyId: string,
    query: PeriodQueryDto,
    lang: 'ar' | 'en',
  ) {
    const data = await this.reports.profitAndLoss(companyId, query);
    const revenueLabel = lang === 'ar' ? 'إيراد' : 'Revenue';
    const expenseLabel = lang === 'ar' ? 'مصروف' : 'Expense';
    const rows = [
      // The rows keep whatever the report produced (amounts as text, but also
      // parentId, which may be null), so the value type is unknown rather than
      // string; the writer stringifies each cell on the way out.
      ...data.revenue.map((r: Record<string, unknown>) => ({
        ...r,
        group: revenueLabel,
      })),
      ...data.expenses.map((r: Record<string, unknown>) => ({
        ...r,
        group: expenseLabel,
      })),
    ];

    return this.table({
      slug: 'profit-and-loss',
      titleEn: 'Profit and loss',
      titleAr: 'الأرباح والخسائر',
      meta: this.periodMeta(data.from, data.to),
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 12 },
        { key: 'nameEn', labelEn: 'Account', labelAr: 'الحساب', width: 34 },
        { key: 'nameAr', labelEn: 'Account (Arabic)', labelAr: 'الحساب بالعربية', width: 34 },
        {
          key: 'group',
          labelEn: 'Kind',
          labelAr: 'النوع',
          width: 14,
        },
        { key: 'amount', labelEn: 'Amount', labelAr: 'المبلغ', numeric: true, width: 18 },
      ],
      rows,
      totals: [
        { labelEn: 'Revenue', labelAr: 'الإيرادات', value: data.totals.revenue },
        { labelEn: 'Expenses', labelAr: 'المصروفات', value: data.totals.expenses },
        { labelEn: 'Net profit', labelAr: 'صافي الربح', value: data.totals.netProfit },
      ],
      notes: [
        {
          en: 'Cost of goods sold is the weighted average cost frozen on each invoice line at posting time.',
          ar: 'تكلفة المبيعات هي المتوسط المرجّح المجمّد على كل بند وقت الترحيل.',
        },
      ],
    });
  }

  private async customerBalances(companyId: string, query: PeriodQueryDto) {
    const data = await this.reports.customerBalances(companyId, query);
    return this.table({
      slug: 'customer-balances',
      titleEn: 'Customer balances',
      titleAr: 'أرصدة العملاء',
      meta: [{ labelEn: 'As at', labelAr: 'حتى تاريخ', value: data.asOf }],
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 12 },
        { key: 'nameEn', labelEn: 'Customer', labelAr: 'العميل', width: 32 },
        { key: 'nameAr', labelEn: 'Customer (Arabic)', labelAr: 'العميل بالعربية', width: 32 },
        { key: 'phone', labelEn: 'Phone', labelAr: 'الهاتف', width: 16 },
        { key: 'invoiced', labelEn: 'Invoiced', labelAr: 'إجمالي المبيعات', numeric: true, width: 16 },
        { key: 'paid', labelEn: 'Paid', labelAr: 'المسدَّد', numeric: true, width: 16 },
        { key: 'balance', labelEn: 'Balance', labelAr: 'الرصيد', numeric: true, width: 16 },
      ],
      rows: data.rows,
      totals: [
        {
          labelEn: 'Total outstanding',
          labelAr: 'إجمالي المديونية',
          value: this.sum(data.rows.map((r) => r.balance as string | null)),
        },
      ],
      notes: [
        {
          en: 'Only customers who owe something are listed.',
          ar: 'بيظهر بس العملاء اللي عليهم رصيد.',
        },
      ],
    });
  }

  private async supplierBalances(companyId: string, query: PeriodQueryDto) {
    const data = await this.reports.supplierBalances(companyId, query);
    return this.table({
      slug: 'supplier-balances',
      titleEn: 'Supplier balances',
      titleAr: 'أرصدة الموردين',
      meta: [{ labelEn: 'As at', labelAr: 'حتى تاريخ', value: data.asOf }],
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 12 },
        { key: 'nameEn', labelEn: 'Supplier', labelAr: 'المورد', width: 32 },
        { key: 'nameAr', labelEn: 'Supplier (Arabic)', labelAr: 'المورد بالعربية', width: 32 },
        { key: 'phone', labelEn: 'Phone', labelAr: 'الهاتف', width: 16 },
        { key: 'invoiced', labelEn: 'Invoiced', labelAr: 'إجمالي المشتريات', numeric: true, width: 16 },
        { key: 'paid', labelEn: 'Paid', labelAr: 'المسدَّد', numeric: true, width: 16 },
        { key: 'balance', labelEn: 'Balance', labelAr: 'الرصيد', numeric: true, width: 16 },
      ],
      rows: data.rows,
      totals: [
        {
          labelEn: 'Total due',
          labelAr: 'إجمالي المستحق',
          value: this.sum(data.rows.map((r) => r.balance as string | null)),
        },
      ],
      notes: [
        {
          en: 'Only suppliers we owe are listed.',
          ar: 'بيظهر بس الموردين اللي ليهم رصيد علينا.',
        },
      ],
    });
  }

  private async accountLedger(
    companyId: string,
    query: PeriodQueryDto & { accountId?: string },
    lang: 'ar' | 'en',
  ) {
    if (!query.accountId) {
      throw new BadRequestException(
        'The account ledger needs an account: pass accountId.',
      );
    }
    const data = await this.reports.accountLedger(
      companyId,
      query.accountId,
      query,
    );
    const account = data.account as Record<string, string>;
    // The account name is shown in the reader's language, not both.
    const accountName = lang === 'ar' ? account.nameAr : account.nameEn;
    // A movement may carry no description of its own, in which case the entry's
    // description is used; if both are empty the cell stays empty rather than
    // printing "null".
    const movements = (data.movements as Array<Record<string, string>>).map(
      (movement) => ({
        ...movement,
        description: movement.description ?? '',
      }),
    );

    return this.table({
      slug: 'account-ledger',
      titleEn: `Account ledger — ${account.code} ${account.nameEn}`,
      titleAr: `كشف حساب — ${account.code} ${account.nameAr}`,
      meta: [
        {
          labelEn: 'Account',
          labelAr: 'الحساب',
          value: `${account.code} — ${accountName}`,
        },
        ...this.periodMeta(data.from, data.to),
        { labelEn: 'Opening balance', labelAr: 'رصيد افتتاحي', value: data.opening },
      ],
      columns: [
        { key: 'entryDate', labelEn: 'Date', labelAr: 'التاريخ', width: 14 },
        { key: 'entryNumber', labelEn: 'Entry', labelAr: 'القيد', width: 16 },
        { key: 'description', labelEn: 'Description', labelAr: 'البيان', width: 40 },
        { key: 'debit', labelEn: 'Debit', labelAr: 'مدين', numeric: true, width: 16 },
        { key: 'credit', labelEn: 'Credit', labelAr: 'دائن', numeric: true, width: 16 },
        { key: 'runningBalance', labelEn: 'Balance', labelAr: 'الرصيد', numeric: true, width: 16 },
      ],
      rows: movements,
      totals: [
        { labelEn: 'Closing balance', labelAr: 'الرصيد الختامي', value: data.closing },
      ],
      notes: [
        {
          en: 'The running balance is the account balance after each movement.',
          ar: 'الرصيد الجاري هو رصيد الحساب بعد كل حركة.',
        },
      ],
    });
  }

  // ───────────────────────────────────────────────────────────────

  private table(input: {
    slug: string;
    titleEn: string;
    titleAr: string;
    meta: TableMeta[];
    columns: ReportTable['columns'];
    rows: Array<Record<string, unknown>>;
    totals: TableTotal[];
    notes: ReportTable['notes'];
  }): ReportTable {
    // Only the columns the report actually produced, and only the values it
    // actually has: a missing value is written as a dash, never as "undefined".
    return {
      ...input,
      rows: input.rows.map((row) => {
        const clean: Record<string, unknown> = {};
        for (const column of input.columns) {
          const value = row[column.key];
          clean[column.key] = value === undefined || value === null ? '' : value;
        }
        return clean;
      }),
    };
  }

  private periodMeta(from: string, to: string): TableMeta[] {
    return [
      { labelEn: 'From', labelAr: 'من تاريخ', value: from },
      { labelEn: 'To', labelAr: 'إلى تاريخ', value: to },
    ];
  }

  /// Adds amounts kept as text, without ever going through a binary float.
  private sum(values: Array<string | null | undefined>): string {
    let total = 0n;
    let scale = 4;
    const scaled: bigint[] = [];
    for (const value of values) {
      const text = String(value ?? '0').trim();
      const negative = text.startsWith('-');
      const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
      const padded = (fraction + '0'.repeat(scale)).slice(0, scale);
      const digits = BigInt((whole || '0') + padded);
      scaled.push(negative ? -digits : digits);
    }
    for (const value of scaled) total += value;
    const negative = total < 0n;
    const digits = (negative ? -total : total).toString().padStart(scale + 1, '0');
    const whole = digits.slice(0, digits.length - scale);
    const fraction = digits.slice(digits.length - scale);
    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }
}
