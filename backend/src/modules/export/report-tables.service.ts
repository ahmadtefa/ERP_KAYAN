import { BadRequestException, Injectable } from '@nestjs/common';

import { accountLabel } from '../../common/localization/account-name';
import { PartiesService } from '../parties/parties.service';
import { FixedAssetsService } from '../fixed-assets/fixed-assets.service';
import { PartyReconciliationService } from '../reports/party-reconciliation.service';
import { AgingService } from '../reports/aging.service';
import { FinancialStatementsService } from '../reports/financial-statements.service';
import { OperationsReportsService } from '../reports/operations-reports.service';
import { ReportsService } from '../reports/reports.service';
import { PeriodQueryDto } from '../reports/dto/report-query.dto';
import { ReportTable, TableMeta, TableTotal } from './report-table';

/// The reports the exporter knows how to turn into a file.
export type ExportableReport =
  | 'trial-balance'
  | 'profit-and-loss'
  | 'customer-balances'
  | 'supplier-balances'
  | 'account-ledger'
  | 'balance-sheet'
  | 'cash-flow'
  | 'equity-changes'
  | 'receivables-reconciliation'
  | 'payables-reconciliation'
  | 'fixed-assets'
  | 'depreciation'
  | 'receivables-aging'
  | 'payables-aging'
  | 'sales'
  | 'purchases'
  | 'expenses'
  | 'income'
  | 'payments'
  | 'cash'
  | 'outstanding-invoices'
  | 'party-statement'
  | 'general-journal';

export const EXPORTABLE_REPORTS: ExportableReport[] = [
  'trial-balance',
  'profit-and-loss',
  'customer-balances',
  'supplier-balances',
  'account-ledger',
  'balance-sheet',
  'cash-flow',
  'equity-changes',
  'receivables-reconciliation',
  'payables-reconciliation',
  'fixed-assets',
  'depreciation',
  'receivables-aging',
  'payables-aging',
  'sales',
  'purchases',
  'expenses',
  'income',
  'payments',
  'cash',
  'outstanding-invoices',
  'party-statement',
  'general-journal',
];

/// Turns a report into a plain table.
///
/// Every writer - Excel, CSV, the printed page - works from this, so a report
/// only has to be described once. Keeping the amounts as the strings the API
/// already produced means no amount is ever re-parsed into a binary float on
/// its way into a file.
@Injectable()
export class ReportTablesService {
  constructor(
    private readonly reports: ReportsService,
    private readonly statements: FinancialStatementsService,
    private readonly aging: AgingService,
    private readonly operations: OperationsReportsService,
    private readonly parties: PartiesService,
    private readonly reconciliation: PartyReconciliationService,
    private readonly fixedAssets: FixedAssetsService,
  ) {}

  async build(
    report: ExportableReport,
    companyId: string,
    query: PeriodQueryDto & {
      accountId?: string;
      partyId?: string;
      kind?: string;
      customerId?: string;
      supplierId?: string;
      status?: string;
      cashAccountId?: string;
    },
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
      case 'balance-sheet':
        return this.balanceSheet(companyId, query);
      case 'cash-flow':
        return this.cashFlow(companyId, query);
      case 'equity-changes':
        return this.equityChanges(companyId, query);
      case 'receivables-reconciliation':
        return this.partyReconciliation(companyId, query, 'receivables');
      case 'payables-reconciliation':
        return this.partyReconciliation(companyId, query, 'payables');
      case 'fixed-assets':
        return this.fixedAssetsTable(companyId);
      case 'depreciation':
        return this.depreciationTable(companyId, query);
      case 'receivables-aging':
        return this.agingTable(companyId, query, 'receivables');
      case 'payables-aging':
        return this.agingTable(companyId, query, 'payables');
      case 'sales':
        return this.salesReport(companyId, query);
      case 'purchases':
        return this.purchasesReport(companyId, query);
      case 'expenses':
        return this.accountMovementReport(companyId, query, 'EXPENSE');
      case 'income':
        return this.accountMovementReport(companyId, query, 'REVENUE');
      case 'payments':
        return this.paymentsReport(companyId, query);
      case 'cash':
        return this.cashReport(companyId, query);
      case 'outstanding-invoices':
        return this.outstandingReport(companyId, query);
      case 'party-statement':
        return this.partyStatement(companyId, query);
      case 'general-journal':
        return this.generalJournal(companyId, query);
    }
  }

  // ───────────────────────────────────────────────────────────────

  private async generalJournal(companyId: string, query: PeriodQueryDto) {
    // The day book answers with paged `items`, not `rows`; the printed table
    // shows the page it was asked for and totals that page honestly.
    const data = await this.statements.generalJournal(companyId, query);
    return this.table({
      slug: 'general-journal',
      titleEn: 'General journal',
      titleAr: 'اليومية العامة',
      meta: this.periodMeta(data.from, data.to),
      columns: [
        { key: 'entryNumber', labelEn: 'Entry', labelAr: 'القيد', width: 16 },
        { key: 'entryDate', labelEn: 'Date', labelAr: 'التاريخ', width: 12 },
        { key: 'description', labelEn: 'Description', labelAr: 'البيان', width: 30 },
        { key: 'sourceType', labelEn: 'Source kind', labelAr: 'نوع المصدر', width: 14 },
        { key: 'sourceNumber', labelEn: 'Source number', labelAr: 'رقم المصدر', width: 16 },
        { key: 'status', labelEn: 'Status', labelAr: 'الحالة', width: 10 },
        { key: 'totalDebit', labelEn: 'Total', labelAr: 'الإجمالي', numeric: true, width: 16 },
      ],
      rows: data.items.map((entry: Record<string, unknown>) => ({
        ...entry,
        sourceType: (entry.source as { type?: string } | null)?.type ?? '',
        sourceNumber: entry.sourceNumber ?? '',
      })),
      totals: [
        { labelEn: 'Entries (page)', labelAr: 'عدد القيود (الصفحة)', value: String(data.items.length) },
        {
          labelEn: 'Total debit',
          labelAr: 'إجمالي المدين',
          value: this.sum(data.items.map((entry) => entry.totalDebit as string)),
        },
        {
          labelEn: 'Total credit',
          labelAr: 'إجمالي الدائن',
          value: this.sum(data.items.map((entry) => entry.totalCredit as string)),
        },
      ],
      notes: [],
    });
  }

  private async trialBalance(companyId: string, query: PeriodQueryDto) {
    const data = await this.reports.trialBalance(companyId, query);
    // The printed page reads the way the screen does: heading subtotals
    // interleaved by code, marked as subtotals. They are not part of the
    // totals block below, which still comes from the postable rows alone.
    const groupRows = (data.groups ?? []).map((group) => ({
      ...group,
      code: `${group.code} ▸`,
      nameEn: `${'  '.repeat(group.depth)}${group.nameEn} (subtotal)`,
      nameAr: `${'  '.repeat(group.depth)}${group.nameAr} (إجمالي فرعي)`,
    }));
    const printRows = [...data.rows, ...groupRows].sort((a, b) =>
      a.code.localeCompare(b.code),
    );
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
      rows: printRows,
      totals,
      notes: [
        {
          en: 'Every figure comes from the posted journal, and reversals are included.',
          ar: 'كل رقم جاي من القيود المُرحَّلة، والقيود المعكوسة داخلة في الحساب.',
        },
        {
          en: 'Rows marked ▸ are heading subtotals and are not included in the totals.',
          ar: 'الصفوف المميزة بـ ▸ إجماليات فرعية للحسابات الرئيسية وليست داخلة في الإجمالي.',
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
      ...data.revenue.map((r: Record<string, string>) => ({
        ...r,
        group: revenueLabel,
      })),
      ...data.expenses.map((r: Record<string, string>) => ({
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
    const account = data.account as {
      code: string;
      nameEn: string | null;
      nameAr: string | null;
    };
    // A movement may carry no description of its own, in which case the entry's
    // description is used; if both are empty the cell stays empty rather than
    // printing "null".
    // The ledger rows carry a nested `source` object for drill-down; a printed
    // table wants flat text, so the document is flattened into two columns.
    const movements = (
      data.movements as Array<Record<string, unknown> & {
        source?: { type?: string; number?: string } | null;
      }>
    ).map((movement) => {
      const source = movement.source ?? null;
      const { source: _ignored, ...rest } = movement;
      void _ignored;
      return {
        ...(rest as Record<string, string>),
        description: (movement.description as string) ?? '',
        documentType: source?.type ?? '',
        documentNumber: source?.number ?? '',
      };
    });

    return this.table({
      slug: 'account-ledger',
      titleEn: `Account ledger — ${accountLabel(account, 'en')}`,
      titleAr: `كشف حساب — ${accountLabel(account, 'ar')}`,
      meta: [
        {
          labelEn: 'Account',
          labelAr: 'الحساب',
          value: accountLabel(account, lang),
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

  private async balanceSheet(companyId: string, query: PeriodQueryDto) {
    const data = await this.statements.balanceSheet(companyId, query);
    const rows = [
      ...data.assets.map((r) => ({ ...r, group: 'Asset' })),
      ...data.liabilities.map((r) => ({ ...r, group: 'Liability' })),
      ...data.equity.map((r) => ({ ...r, group: 'Equity' })),
    ];
    return this.table({
      slug: 'balance-sheet',
      titleEn: 'Balance sheet',
      titleAr: 'الميزانية العمومية',
      meta: [{ labelEn: 'As at', labelAr: 'حتى تاريخ', value: data.asOf }],
      columns: [
        { key: 'group', labelEn: 'Section', labelAr: 'القسم', width: 14 },
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 12 },
        { key: 'nameEn', labelEn: 'Account', labelAr: 'الحساب', width: 34 },
        { key: 'nameAr', labelEn: 'Account (Arabic)', labelAr: 'الحساب بالعربية', width: 34 },
        { key: 'balance', labelEn: 'Balance', labelAr: 'الرصيد', numeric: true, width: 16 },
      ],
      rows,
      totals: [
        { labelEn: 'Assets', labelAr: 'الأصول', value: data.totals.assets },
        { labelEn: 'Liabilities', labelAr: 'الالتزامات', value: data.totals.liabilities },
        { labelEn: 'Equity', labelAr: 'حقوق الملكية', value: data.totals.equity },
        { labelEn: 'Difference (must be zero)', labelAr: 'الفرق (لازم يكون صفر)', value: data.totals.difference },
      ],
      notes: [],
    });
  }

  private async cashFlow(companyId: string, query: PeriodQueryDto) {
    const data = await this.statements.cashFlow(companyId, query);
    const rows = [
      ...data.inflows.map((r: Record<string, unknown>) => ({ ...r, direction: 'in', amount: r.movement })),
      ...data.outflows.map((r: Record<string, unknown>) => ({ ...r, direction: 'out', amount: r.movement })),
    ];
    return this.table({
      slug: 'cash-flow',
      titleEn: 'Cash flow',
      titleAr: 'التدفقات النقدية',
      meta: this.periodMeta(data.from, data.to),
      columns: [
        { key: 'direction', labelEn: 'Direction', labelAr: 'الاتجاه', width: 12 },
        { key: 'code', labelEn: 'Account', labelAr: 'الحساب', width: 14 },
        { key: 'nameEn', labelEn: 'Name', labelAr: 'الاسم', width: 28 },
        { key: 'amount', labelEn: 'Amount', labelAr: 'المبلغ', numeric: true, width: 16 },
      ],
      rows,
      totals: [
        { labelEn: 'Opening cash', labelAr: 'النقدية أول الفترة', value: data.totals.opening },
        ...(data.sections ?? []).map(
          (section: { cashFlowClass: string; net: string }) => ({
            labelEn: `Net ${section.cashFlowClass}`,
            labelAr:
              section.cashFlowClass === 'operating'
                ? 'صافي التشغيلية'
                : section.cashFlowClass === 'investing'
                  ? 'صافي الاستثمارية'
                  : section.cashFlowClass === 'financing'
                    ? 'صافي التمويلية'
                    : 'صافي غير مصنّفة',
            value: section.net,
          }),
        ),
        { labelEn: 'Inflow', labelAr: 'وارد', value: data.totals.inflow },
        { labelEn: 'Outflow', labelAr: 'صادر', value: data.totals.outflow },
        { labelEn: 'Net', labelAr: 'الصافي', value: data.totals.net },
        { labelEn: 'Closing cash', labelAr: 'النقدية آخر الفترة', value: data.totals.closing },
      ],
      notes: [],
    });
  }

  private async equityChanges(companyId: string, query: PeriodQueryDto) {
    const data = await this.statements.equityChanges(companyId, query);
    // The unclosed-result row reads opening - transferred + period result
    // = closing, so its transferred amount flips sign (textually, to keep
    // the exact decimal string the report produced).
    const transferred = data.result.transferredToEquity;
    const unclosedTransferred = transferred.startsWith('-')
      ? transferred.slice(1)
      : /^0(\.0*)?$/.test(transferred)
        ? transferred
        : `-${transferred}`;
    const rows = [
      ...data.accounts,
      {
        code: '',
        nameEn: 'Result not yet closed',
        nameAr: 'نتيجة لم تُرحَّل بعد',
        opening: data.result.openingUnclosed,
        transferredResult: unclosedTransferred,
        otherMovements: data.result.forPeriod,
        closing: data.result.closingUnclosed,
      },
    ];
    return this.table({
      slug: 'equity-changes',
      titleEn: 'Statement of changes in equity',
      titleAr: 'قائمة التغيرات في حقوق الملكية',
      meta: this.periodMeta(data.from, data.to),
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 12 },
        { key: 'nameEn', labelEn: 'Account', labelAr: 'الحساب', width: 34 },
        { key: 'nameAr', labelEn: 'Account (Arabic)', labelAr: 'الحساب بالعربية', width: 34 },
        { key: 'opening', labelEn: 'Opening', labelAr: 'أول الفترة', numeric: true, width: 16 },
        { key: 'transferredResult', labelEn: 'Transferred result', labelAr: 'النتيجة المرحَّلة', numeric: true, width: 18 },
        { key: 'otherMovements', labelEn: 'Movements', labelAr: 'الحركات', numeric: true, width: 16 },
        { key: 'closing', labelEn: 'Closing', labelAr: 'آخر الفترة', numeric: true, width: 16 },
      ],
      rows,
      totals: [
        { labelEn: 'Opening equity', labelAr: 'حقوق الملكية أول الفترة', value: data.totals.opening },
        { labelEn: 'Result for the period', labelAr: 'نتيجة الفترة', value: data.totals.resultForPeriod },
        { labelEn: 'Other movements', labelAr: 'حركات أخرى', value: data.totals.otherMovements },
        { labelEn: 'Closing equity', labelAr: 'حقوق الملكية آخر الفترة', value: data.totals.closing },
        { labelEn: 'Difference (must be zero)', labelAr: 'الفرق (لازم يكون صفر)', value: data.totals.difference },
      ],
      notes: [
        {
          en: 'The result row shows the period result while it is still unclosed; a year-end close moves it into retained earnings as the transferred result.',
          ar: 'صف النتيجة يعرض نتيجة الفترة قبل ترحيلها؛ وإقفال السنة ينقلها إلى الأرباح المرحَّلة في عمود النتيجة المرحَّلة.',
        },
      ],
    });
  }

  private async partyReconciliation(
    companyId: string,
    query: PeriodQueryDto,
    side: 'receivables' | 'payables',
  ) {
    const data =
      side === 'receivables'
        ? await this.reconciliation.receivables(companyId, { asOf: query.asOf ?? query.to })
        : await this.reconciliation.payables(companyId, { asOf: query.asOf ?? query.to });
    return this.table({
      slug: side === 'receivables' ? 'receivables-reconciliation' : 'payables-reconciliation',
      titleEn:
        side === 'receivables' ? 'Receivables reconciliation' : 'Payables reconciliation',
      titleAr: side === 'receivables' ? 'تسوية العملاء' : 'تسوية الموردين',
      meta: [
        { labelEn: 'As at', labelAr: 'حتى تاريخ', value: data.asOf },
        {
          labelEn: 'Control account',
          labelAr: 'حساب الرقابة',
          value: `${data.controlAccount.code} — ${data.controlAccount.nameEn}`,
        },
      ],
      columns: [
        { key: 'entryNumber', labelEn: 'Entry', labelAr: 'القيد', width: 16 },
        { key: 'entryDate', labelEn: 'Date', labelAr: 'التاريخ', width: 14 },
        { key: 'sourceType', labelEn: 'Source', labelAr: 'المصدر', width: 20 },
        { key: 'sourceNumber', labelEn: 'Document', labelAr: 'المستند', width: 20 },
        { key: 'amount', labelEn: 'Amount', labelAr: 'المبلغ', numeric: true, width: 16 },
      ],
      rows: data.otherPostings,
      totals: [
        { labelEn: 'Subledger', labelAr: 'الأستاذ المساعد', value: data.subledger.total },
        { labelEn: 'Control account', labelAr: 'حساب الرقابة', value: data.controlBalance },
        { labelEn: 'Advances held', labelAr: 'مقدّمات غير مطبّقة', value: data.advances },
        {
          labelEn: 'Postings outside the subledger (listed)',
          labelAr: 'قيود خارج المساعد (معروضة أعلاه)',
          value: data.otherPostingsTotal,
        },
        { labelEn: 'Difference', labelAr: 'الفرق', value: data.difference },
        {
          labelEn: 'Unexplained (must be zero)',
          labelAr: 'غير مفسَّر (لازم يكون صفر)',
          value: data.unexplained,
        },
      ],
      notes: [
        {
          en: 'Listed rows are ledger postings on the control account that no invoice, note or voucher wrote; each one explains part of any difference.',
          ar: 'الصفوف المعروضة قيود على حساب الرقابة لم يكتبها أي فاتورة أو إشعار أو سند؛ وكل منها يفسّر جزءًا من أي فرق.',
        },
      ],
    });
  }

  private async fixedAssetsTable(companyId: string) {
    const data = await this.fixedAssets.summary(companyId);
    return this.table({
      slug: 'fixed-assets',
      titleEn: 'Fixed assets register',
      titleAr: 'سجل الأصول الثابتة',
      meta: [],
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 14 },
        { key: 'nameEn', labelEn: 'Asset', labelAr: 'الأصل', width: 30 },
        { key: 'nameAr', labelEn: 'Asset (Arabic)', labelAr: 'الأصل بالعربية', width: 30 },
        { key: 'category', labelEn: 'Category', labelAr: 'التصنيف', width: 16 },
        { key: 'status', labelEn: 'Status', labelAr: 'الحالة', width: 16 },
        { key: 'inServiceDate', labelEn: 'In service', labelAr: 'بدء الاستخدام', width: 14 },
        { key: 'cost', labelEn: 'Cost', labelAr: 'التكلفة', numeric: true, width: 16 },
        {
          key: 'accumulatedDepreciation',
          labelEn: 'Accumulated depreciation',
          labelAr: 'مجمع الإهلاك',
          numeric: true,
          width: 20,
        },
        { key: 'bookValue', labelEn: 'Book value', labelAr: 'القيمة الدفترية', numeric: true, width: 16 },
      ],
      rows: data.items,
      totals: [
        { labelEn: 'Total cost', labelAr: 'إجمالي التكلفة', value: data.totals.cost },
        {
          labelEn: 'Total accumulated depreciation',
          labelAr: 'إجمالي مجمع الإهلاك',
          value: data.totals.accumulatedDepreciation,
        },
        { labelEn: 'Total book value', labelAr: 'إجمالي القيمة الدفترية', value: data.totals.bookValue },
      ],
      notes: [],
    });
  }

  private async depreciationTable(companyId: string, query: PeriodQueryDto) {
    const period = query.from?.slice(0, 7);
    const data = await this.fixedAssets.listRuns(companyId, { period });
    const rows = data.items.flatMap((run) =>
      run.lines.map((line) => ({
        runNumber: run.runNumber,
        period: run.period,
        runDate: run.runDate,
        code: line.code,
        nameEn: line.nameEn,
        nameAr: line.nameAr,
        amount: line.amount,
        accumulatedAfter: line.accumulatedAfter,
      })),
    );
    return this.table({
      slug: 'depreciation',
      titleEn: 'Depreciation runs',
      titleAr: 'تشغيلات الإهلاك',
      meta: period ? [{ labelEn: 'Month', labelAr: 'الشهر', value: period }] : [],
      columns: [
        { key: 'runNumber', labelEn: 'Run', labelAr: 'التشغيل', width: 16 },
        { key: 'period', labelEn: 'Month', labelAr: 'الشهر', width: 12 },
        { key: 'runDate', labelEn: 'Date', labelAr: 'التاريخ', width: 14 },
        { key: 'code', labelEn: 'Asset code', labelAr: 'كود الأصل', width: 14 },
        { key: 'nameEn', labelEn: 'Asset', labelAr: 'الأصل', width: 30 },
        { key: 'amount', labelEn: 'Charge', labelAr: 'قسط الإهلاك', numeric: true, width: 16 },
        {
          key: 'accumulatedAfter',
          labelEn: 'Accumulated after',
          labelAr: 'المجمع بعد القسط',
          numeric: true,
          width: 18,
        },
      ],
      rows,
      totals: data.items.map((run) => ({
        labelEn: `Run ${run.runNumber} (${run.period})`,
        labelAr: `تشغيل ${run.runNumber} (${run.period})`,
        value: run.totalAmount,
      })),
      notes: [],
    });
  }

  private async agingTable(
    companyId: string,
    query: PeriodQueryDto,
    side: 'receivables' | 'payables',
  ) {
    const data =
      side === 'receivables'
        ? await this.aging.receivables(companyId, { asOf: query.to })
        : await this.aging.payables(companyId, { asOf: query.to });
    return this.table({
      slug: side === 'receivables' ? 'receivables-aging' : 'payables-aging',
      titleEn: side === 'receivables' ? 'Receivables aging' : 'Payables aging',
      titleAr: side === 'receivables' ? 'أعمار المدينين' : 'أعمار الدائنين',
      meta: [{ labelEn: 'As at', labelAr: 'حتى تاريخ', value: data.asOf }],
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 12 },
        { key: 'nameEn', labelEn: 'Name', labelAr: 'الاسم', width: 28 },
        { key: 'nameAr', labelEn: 'Name (Arabic)', labelAr: 'الاسم بالعربية', width: 28 },
        { key: 'total', labelEn: 'Total', labelAr: 'الإجمالي', numeric: true, width: 16 },
        { key: 'overdue', labelEn: 'Overdue', labelAr: 'متأخر', numeric: true, width: 16 },
      ],
      rows: data.rows,
      totals: [
        { labelEn: 'Total', labelAr: 'الإجمالي', value: data.totals.total },
        { labelEn: 'Overdue', labelAr: 'متأخر', value: data.totals.overdue },
      ],
      notes: [],
    });
  }

  // ─────────────────────────────────────────── operational reports

  private async salesReport(
    companyId: string,
    query: PeriodQueryDto & { customerId?: string; status?: string },
  ) {
    const data = await this.operations.sales(companyId, query);
    return this.table({
      slug: 'sales',
      titleEn: 'Sales report',
      titleAr: 'تقرير المبيعات',
      meta: this.periodMeta(data.from, data.to),
      columns: [
        { key: 'invoiceNumber', labelEn: 'Invoice', labelAr: 'الفاتورة', width: 16 },
        { key: 'invoiceDate', labelEn: 'Date', labelAr: 'التاريخ', width: 12 },
        { key: 'partyName', labelEn: 'Customer', labelAr: 'العميل', width: 26 },
        { key: 'documentType', labelEn: 'Kind', labelAr: 'النوع', width: 12 },
        { key: 'status', labelEn: 'Status', labelAr: 'الحالة', width: 10 },
        { key: 'totalAmount', labelEn: 'Total', labelAr: 'الإجمالي', numeric: true, width: 14 },
        { key: 'paidAmount', labelEn: 'Paid', labelAr: 'المسدَّد', numeric: true, width: 14 },
        { key: 'outstanding', labelEn: 'Outstanding', labelAr: 'المتبقي', numeric: true, width: 14 },
        { key: 'grossProfit', labelEn: 'Gross profit', labelAr: 'مجمل الربح', numeric: true, width: 14 },
      ],
      rows: data.rows.map((row) => ({
        ...row,
        partyName: `${(row.customer as { nameEn?: string }).nameEn ?? ''} ${(row.customer as { nameAr?: string }).nameAr ?? ''}`.trim(),
      })),
      totals: [
        { labelEn: 'Invoices', labelAr: 'عدد الفواتير', value: String(data.totals.documents) },
        { labelEn: 'Total', labelAr: 'الإجمالي', value: data.totals.total },
        { labelEn: 'Paid', labelAr: 'المسدَّد', value: data.totals.paid },
        { labelEn: 'Outstanding', labelAr: 'المتبقي', value: data.totals.outstanding },
        { labelEn: 'Gross profit', labelAr: 'مجمل الربح', value: data.totals.grossProfit },
      ],
      notes: [],
    });
  }

  private async purchasesReport(
    companyId: string,
    query: PeriodQueryDto & { supplierId?: string; status?: string },
  ) {
    const data = await this.operations.purchases(companyId, query);
    return this.table({
      slug: 'purchases',
      titleEn: 'Purchases report',
      titleAr: 'تقرير المشتريات',
      meta: this.periodMeta(data.from, data.to),
      columns: [
        { key: 'invoiceNumber', labelEn: 'Invoice', labelAr: 'الفاتورة', width: 16 },
        { key: 'invoiceDate', labelEn: 'Date', labelAr: 'التاريخ', width: 12 },
        { key: 'partyName', labelEn: 'Supplier', labelAr: 'المورد', width: 26 },
        { key: 'documentType', labelEn: 'Kind', labelAr: 'النوع', width: 12 },
        { key: 'status', labelEn: 'Status', labelAr: 'الحالة', width: 10 },
        { key: 'totalAmount', labelEn: 'Total', labelAr: 'الإجمالي', numeric: true, width: 14 },
        { key: 'paidAmount', labelEn: 'Paid', labelAr: 'المسدَّد', numeric: true, width: 14 },
        { key: 'outstanding', labelEn: 'Outstanding', labelAr: 'المتبقي', numeric: true, width: 14 },
      ],
      rows: data.rows.map((row) => ({
        ...row,
        partyName: `${(row.supplier as { nameEn?: string }).nameEn ?? ''} ${(row.supplier as { nameAr?: string }).nameAr ?? ''}`.trim(),
      })),
      totals: [
        { labelEn: 'Invoices', labelAr: 'عدد الفواتير', value: String(data.totals.documents) },
        { labelEn: 'Total', labelAr: 'الإجمالي', value: data.totals.total },
        { labelEn: 'Paid', labelAr: 'المسدَّد', value: data.totals.paid },
        { labelEn: 'Outstanding', labelAr: 'المتبقي', value: data.totals.outstanding },
      ],
      notes: [],
    });
  }

  private async accountMovementReport(
    companyId: string,
    query: PeriodQueryDto & { accountId?: string },
    type: 'EXPENSE' | 'REVENUE',
  ) {
    const data = await this.operations.accountMovement(companyId, type, query);
    const expense = type === 'EXPENSE';
    return this.table({
      slug: expense ? 'expenses' : 'income',
      titleEn: expense ? 'Expenses report' : 'Income report',
      titleAr: expense ? 'تقرير المصروفات' : 'تقرير الإيرادات',
      meta: this.periodMeta(data.from, data.to),
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 12 },
        { key: 'nameEn', labelEn: 'Account', labelAr: 'الحساب', width: 30 },
        { key: 'nameAr', labelEn: 'Account (Arabic)', labelAr: 'الحساب بالعربية', width: 30 },
        { key: 'entries', labelEn: 'Entries', labelAr: 'عدد القيود', numeric: true, width: 12 },
        { key: 'net', labelEn: 'Net', labelAr: 'الصافي', numeric: true, width: 18 },
      ],
      rows: data.rows.map((row) => ({ ...row, entries: String(row.entries) })),
      totals: [
        {
          labelEn: expense ? 'Total expenses' : 'Total income',
          labelAr: expense ? 'إجمالي المصروفات' : 'إجمالي الإيرادات',
          value: data.total,
        },
      ],
      notes: [],
    });
  }

  private async paymentsReport(
    companyId: string,
    query: PeriodQueryDto & {
      kind?: string;
      customerId?: string;
      supplierId?: string;
    },
  ) {
    const data = await this.operations.payments(companyId, query);
    return this.table({
      slug: 'payments',
      titleEn: 'Payments report',
      titleAr: 'تقرير المقبوضات والمدفوعات',
      meta: this.periodMeta(data.from, data.to),
      columns: [
        { key: 'voucherNumber', labelEn: 'Voucher', labelAr: 'السند', width: 14 },
        { key: 'voucherDate', labelEn: 'Date', labelAr: 'التاريخ', width: 12 },
        { key: 'kind', labelEn: 'Kind', labelAr: 'النوع', width: 12 },
        { key: 'partyName', labelEn: 'Party', labelAr: 'الطرف', width: 24 },
        { key: 'cashName', labelEn: 'Cash account', labelAr: 'حساب النقدية', width: 20 },
        { key: 'amount', labelEn: 'Amount', labelAr: 'المبلغ', numeric: true, width: 14 },
        { key: 'status', labelEn: 'Status', labelAr: 'الحالة', width: 10 },
      ],
      rows: data.rows.map((row) => ({
        ...row,
        partyName: [
          (row.customer as { nameEn?: string } | null)?.nameEn,
          (row.supplier as { nameEn?: string } | null)?.nameEn,
          (row.counterAccount as { nameEn?: string } | null)?.nameEn,
        ]
          .filter(Boolean)
          .join(' / '),
        cashName: (row.cashAccount as { nameEn?: string }).nameEn ?? '',
      })),
      totals: [
        { labelEn: 'Receipts', labelAr: 'المقبوضات', value: data.totals.receipts },
        { labelEn: 'Payments', labelAr: 'المدفوعات', value: data.totals.payments },
        { labelEn: 'Net', labelAr: 'الصافي', value: data.totals.net },
      ],
      notes: [],
    });
  }

  private async cashReport(
    companyId: string,
    query: PeriodQueryDto & { cashAccountId?: string },
  ) {
    const data = await this.operations.cash(companyId, query);
    return this.table({
      slug: 'cash',
      titleEn: 'Cash report',
      titleAr: 'تقرير النقدية',
      meta: this.periodMeta(data.from, data.to),
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 12 },
        { key: 'nameEn', labelEn: 'Account', labelAr: 'الحساب', width: 26 },
        { key: 'kind', labelEn: 'Kind', labelAr: 'النوع', width: 10 },
        { key: 'opening', labelEn: 'Opening', labelAr: 'رصيد افتتاحي', numeric: true, width: 16 },
        { key: 'inflow', labelEn: 'In', labelAr: 'وارد', numeric: true, width: 14 },
        { key: 'outflow', labelEn: 'Out', labelAr: 'صادر', numeric: true, width: 14 },
        { key: 'closing', labelEn: 'Closing', labelAr: 'رصيد ختامي', numeric: true, width: 16 },
      ],
      rows: data.rows,
      totals: [
        { labelEn: 'Opening', labelAr: 'رصيد افتتاحي', value: data.totals.opening },
        { labelEn: 'Inflow', labelAr: 'وارد', value: data.totals.inflow },
        { labelEn: 'Outflow', labelAr: 'صادر', value: data.totals.outflow },
        { labelEn: 'Closing', labelAr: 'رصيد ختامي', value: data.totals.closing },
      ],
      notes: [],
    });
  }

  private async outstandingReport(
    companyId: string,
    query: PeriodQueryDto & {
      kind?: string;
      customerId?: string;
      supplierId?: string;
    },
  ) {
    const data = await this.operations.outstandingInvoices(companyId, {
      asOf: query.asOf ?? query.to,
      kind: query.kind,
      customerId: query.customerId,
      supplierId: query.supplierId,
    });
    return this.table({
      slug: 'outstanding-invoices',
      titleEn: 'Outstanding invoices',
      titleAr: 'الفواتير غير المسددة',
      meta: [{ labelEn: 'As at', labelAr: 'حتى تاريخ', value: data.asOf }],
      columns: [
        { key: 'invoiceNumber', labelEn: 'Invoice', labelAr: 'الفاتورة', width: 16 },
        { key: 'invoiceDate', labelEn: 'Date', labelAr: 'التاريخ', width: 12 },
        { key: 'dueDate', labelEn: 'Due', labelAr: 'الاستحقاق', width: 12 },
        { key: 'partyName', labelEn: 'Party', labelAr: 'الطرف', width: 24 },
        { key: 'totalAmount', labelEn: 'Total', labelAr: 'الإجمالي', numeric: true, width: 14 },
        { key: 'paidAmount', labelEn: 'Paid', labelAr: 'المسدَّد', numeric: true, width: 14 },
        { key: 'outstanding', labelEn: 'Outstanding', labelAr: 'المتبقي', numeric: true, width: 14 },
        { key: 'daysOverdue', labelEn: 'Days overdue', labelAr: 'أيام التأخير', numeric: true, width: 12 },
        { key: 'state', labelEn: 'State', labelAr: 'الحالة', width: 10 },
      ],
      rows: data.rows.map((row) => ({
        ...row,
        partyName: [
          (row.party as { nameEn?: string } | null)?.nameEn,
          (row.party as { nameAr?: string } | null)?.nameAr,
        ]
          .filter(Boolean)
          .join(' / '),
        daysOverdue: String(row.daysOverdue),
      })),
      totals: [
        { labelEn: 'Invoices', labelAr: 'عدد الفواتير', value: String(data.totals.invoices) },
        { labelEn: 'Outstanding', labelAr: 'المتبقي', value: data.totals.outstanding },
        { labelEn: 'Due', labelAr: 'مستحق', value: data.totals.due },
        { labelEn: 'Overdue', labelAr: 'متأخر', value: data.totals.overdue },
      ],
      notes: [],
    });
  }

  private async partyStatement(
    companyId: string,
    query: PeriodQueryDto & { partyId?: string; kind?: string },
  ) {
    if (!query.partyId) {
      throw new BadRequestException(
        'A party statement needs a partner: pass partyId and kind.',
      );
    }
    const kind = query.kind === 'supplier' ? 'supplier' : 'customer';
    const data = await this.parties.statement(companyId, kind, query.partyId, {
      from: query.from,
      to: query.to,
    });
    const party = data.party as {
      code: string;
      nameEn: string;
      nameAr: string;
      phone?: string | null;
    };
    return this.table({
      slug: 'party-statement',
      titleEn: `Statement — ${accountLabel({ code: party.code, nameEn: party.nameEn, nameAr: party.nameAr }, 'en')}`,
      titleAr: `كشف حساب — ${accountLabel({ code: party.code, nameEn: party.nameEn, nameAr: party.nameAr }, 'ar')}`,
      meta: [
        ...this.periodMeta(data.from, data.to),
        { labelEn: 'Opening balance', labelAr: 'رصيد افتتاحي', value: data.openingBalance },
        { labelEn: 'Closing balance', labelAr: 'رصيد ختامي', value: data.closingBalance },
      ],
      columns: [
        { key: 'date', labelEn: 'Date', labelAr: 'التاريخ', width: 12 },
        { key: 'number', labelEn: 'Document', labelAr: 'المستند', width: 16 },
        { key: 'type', labelEn: 'Kind', labelAr: 'النوع', width: 16 },
        { key: 'description', labelEn: 'Description', labelAr: 'البيان', width: 26 },
        { key: 'debit', labelEn: 'Debit', labelAr: 'مدين', numeric: true, width: 14 },
        { key: 'credit', labelEn: 'Credit', labelAr: 'دائن', numeric: true, width: 14 },
        { key: 'balance', labelEn: 'Balance', labelAr: 'الرصيد', numeric: true, width: 14 },
      ],
      rows: data.rows,
      totals: [
        { labelEn: 'Total debit', labelAr: 'إجمالي المدين', value: data.totalDebit },
        { labelEn: 'Total credit', labelAr: 'إجمالي الدائن', value: data.totalCredit },
        { labelEn: 'Closing balance', labelAr: 'الرصيد الختامي', value: data.closingBalance },
      ],
      notes: [],
    });
  }

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
