import { AccountType } from '@prisma/client';

/**
 * The starter chart of accounts for a new company, in the eight digit scheme:
 * 2, 4, 6 and 8 digit levels, each level adding two digits to its parent's
 * code. Only the 8-digit accounts take entries; the shorter levels are totals.
 *
 * It is a template to edit, not a statutory chart. The eight digit codes of the
 * accounts that automatic postings use are mirrored in
 * `EIGHT_DIGIT_ACCOUNT_CODES` (src/modules/accounting/account-map.service.ts);
 * a spec keeps the two in step.
 */
export interface StarterAccount {
  code: string;
  nameEn: string;
  nameAr: string;
  type: AccountType;
  parent?: string;
  postable: boolean;
}

const A = AccountType.ASSET;
const L = AccountType.LIABILITY;
const E = AccountType.EQUITY;
const R = AccountType.REVENUE;
const X = AccountType.EXPENSE;

function g(code: string, nameEn: string, nameAr: string, type: AccountType): StarterAccount {
  const parent = code.length > 2 ? code.slice(0, -2) : undefined;
  return { code, nameEn, nameAr, type, parent, postable: false };
}
function p(code: string, nameEn: string, nameAr: string, type: AccountType): StarterAccount {
  return { code, nameEn, nameAr, type, parent: code.slice(0, -2), postable: true };
}

export const EIGHT_DIGIT_STARTER_ACCOUNTS: StarterAccount[] = [
  g('01', 'Assets', 'الأصول', A),
  g('0101', 'Current assets', 'الأصول المتداولة', A),
  g('010101', 'Cash and banks', 'النقدية والبنوك', A),
  p('01010101', 'Cash on hand', 'النقدية بالصندوق', A),
  p('01010102', 'Bank — current account', 'البنك - الحساب الجاري', A),
  g('010102', 'Receivables', 'العملاء والمدينون', A),
  p('01010201', 'Accounts receivable', 'العملاء (المدينون)', A),
  g('010103', 'Inventory', 'المخزون', A),
  p('01010301', 'Inventory', 'المخزون', A),
  g('010104', 'Tax receivable', 'ضرائب مدينة', A),
  p('01010401', 'VAT receivable', 'ضريبة القيمة المضافة - مدخلات', A),
  g('0102', 'Non-current assets', 'الأصول غير المتداولة', A),
  g('010201', 'Fixed assets', 'الأصول الثابتة', A),
  p('01020101', 'Furniture and fixtures', 'الأثاث والتجهيزات', A),
  p('01020102', 'Vehicles', 'السيارات', A),
  g('010202', 'Accumulated depreciation', 'مجمع الإهلاك', A),
  p('01020201', 'Accumulated depreciation', 'مجمع الإهلاك', A),

  g('02', 'Liabilities', 'الالتزامات', L),
  g('0201', 'Current liabilities', 'الالتزامات المتداولة', L),
  g('020101', 'Payables', 'الموردون والدائنون', L),
  p('02010101', 'Accounts payable', 'الموردون (الدائنون)', L),
  g('020102', 'Accruals', 'مستحقات', L),
  p('02010201', 'Accrued expenses', 'مصروفات مستحقة', L),
  p('02010202', 'Salaries payable', 'رواتب مستحقة', L),
  g('020103', 'Tax payable', 'ضرائب دائنة', L),
  p('02010301', 'VAT payable', 'ضريبة القيمة المضافة - مخرجات', L),

  g('03', 'Equity', 'حقوق الملكية', E),
  g('0301', 'Owners equity', 'حقوق الملاك', E),
  g('030101', 'Capital', 'رأس المال', E),
  p('03010101', 'Capital', 'رأس المال', E),
  g('030102', 'Retained earnings', 'الأرباح المحتجزة', E),
  p('03010201', 'Retained earnings', 'الأرباح المحتجزة', E),
  g('030103', 'Opening balances', 'أرصدة افتتاحية', E),
  p('03010301', 'Opening balance equity', 'أرصدة افتتاحية', E),

  g('04', 'Revenue', 'الإيرادات', R),
  g('0401', 'Operating revenue', 'إيرادات التشغيل', R),
  g('040101', 'Sales', 'المبيعات', R),
  p('04010101', 'Sales revenue', 'إيرادات المبيعات', R),
  p('04010102', 'Sales returns', 'مردودات المبيعات', R),
  g('0402', 'Other revenue', 'إيرادات أخرى', R),
  g('040201', 'Other income', 'إيرادات متنوعة', R),
  p('04020101', 'Other income', 'إيرادات أخرى', R),

  g('05', 'Expenses', 'المصروفات', X),
  g('0501', 'Cost of sales', 'تكلفة المبيعات', X),
  g('050101', 'Cost of goods', 'تكلفة البضاعة', X),
  p('05010101', 'Cost of goods sold', 'تكلفة المبيعات', X),
  p('05010102', 'Inventory differences', 'فروق المخزون', X),
  g('0502', 'Operating expenses', 'مصروفات التشغيل', X),
  g('050201', 'General expenses', 'مصروفات عمومية', X),
  p('05020101', 'Salaries and wages', 'الرواتب والأجور', X),
  p('05020102', 'Rent', 'الإيجار', X),
  p('05020103', 'Utilities', 'المرافق والخدمات', X),
  p('05020104', 'Depreciation expense', 'مصروف الإهلاك', X),
  p('05020105', 'Professional fees', 'أتعاب مهنية', X),
];
