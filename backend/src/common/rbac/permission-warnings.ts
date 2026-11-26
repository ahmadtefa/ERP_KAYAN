/**
 * What to say before somebody ticks a dangerous box.
 *
 * The roles screen promises a preview: "this is what the person will be able to
 * do, and these are the parts worth a second look". The list below is the
 * second look. It is deliberately short — a screen that warns about everything
 * warns about nothing — and each entry says *why*, in both languages, so the
 * message can be shown as-is.
 */

export interface PermissionWarning {
  code: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  messageEn: string;
  messageAr: string;
}

export interface PermissionWarningRule {
  /** An exact code or a prefix ending in `.`. */
  match: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  messageEn: string;
  messageAr: string;
}

export const PERMISSION_WARNING_RULES: readonly PermissionWarningRule[] = [
  {
    match: 'admin.users.manage',
    severity: 'WARNING',
    messageEn: 'Can create users, reset their passwords and change what they may do.',
    messageAr: 'يستطيع إنشاء المستخدمين وتصفير كلمات مرورهم وتغيير صلاحياتهم.',
  },
  {
    match: 'admin.roles.manage',
    severity: 'CRITICAL',
    messageEn: 'Can change every role and permission in the company — treat as an administrator.',
    messageAr: 'يستطيع تغيير كل الأدوار والصلاحيات في الشركة — يُعامل معاملة مدير النظام.',
  },
  {
    match: 'admin.backup',
    severity: 'WARNING',
    messageEn: 'Can take and download a full copy of the company data.',
    messageAr: 'يستطيع أخذ نسخة كاملة من بيانات الشركة وتنزيلها.',
  },
  {
    match: 'admin.backup.restore',
    severity: 'CRITICAL',
    messageEn: 'Can replace the company data with a backup file.',
    messageAr: 'يستطيع استبدال بيانات الشركة بملف نسخة احتياطية.',
  },
  {
    match: 'admin.users.password',
    severity: 'WARNING',
    messageEn: 'Can set another user’s password and sign in as them.',
    messageAr: 'يستطيع تعيين كلمة مرور مستخدم آخر والدخول بحسابه.',
  },
  {
    match: 'inventory.cost.read',
    severity: 'WARNING',
    messageEn: 'Can see item cost and profit, not just quantities.',
    messageAr: 'يرى تكلفة الأصناف والربح، وليس الكميات فقط.',
  },
  {
    match: 'accounting.periods.close',
    severity: 'WARNING',
    messageEn: 'Can close an accounting period and lock everyone out of it.',
    messageAr: 'يستطيع إغلاق فترة محاسبية ومنع الجميع من التعديل فيها.',
  },
  {
    match: 'accounting.journal.post',
    severity: 'INFO',
    messageEn: 'Can post and reverse journal entries.',
    messageAr: 'يستطيع ترحيل القيود وعكسها.',
  },
  {
    match: 'cash.reconcile',
    severity: 'INFO',
    messageEn: 'Can reconcile bank accounts against statements.',
    messageAr: 'يستطيع مطابقة الحسابات البنكية مع كشوف البنك.',
  },
  {
    match: 'sales.invoices.post',
    severity: 'INFO',
    messageEn: 'Can post sales invoices, which moves stock and the ledger.',
    messageAr: 'يستطيع ترحيل فواتير البيع، وهو ما يحرّك المخزون والدفاتر.',
  },
  {
    match: 'purchases.invoices.post',
    severity: 'INFO',
    messageEn: 'Can post purchase invoices, which moves stock and the ledger.',
    messageAr: 'يستطيع ترحيل فواتير الشراء، وهو ما يحرّك المخزون والدفاتر.',
  },
];

function matches(rule: PermissionWarningRule, code: string): boolean {
  if (rule.match.endsWith('.')) return code.startsWith(rule.match);
  return code === rule.match;
}

/// The warnings for a permission set, strongest first, one per rule.
export function permissionWarnings(codes: readonly string[]): PermissionWarning[] {
  const set = new Set(codes);
  const severityRank = { CRITICAL: 3, WARNING: 2, INFO: 1 } as const;
  return PERMISSION_WARNING_RULES.filter((rule) => [...set].some((code) => matches(rule, code)))
    .map((rule) => ({
      code: [...set].filter((code) => matches(rule, code)).sort()[0],
      severity: rule.severity,
      messageEn: rule.messageEn,
      messageAr: rule.messageAr,
    }))
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
}

/// The sentence a preview shows under the counter: "18 permissions, 2 need a
/// second look". Silence for a harmless set, because a warning that fires on
/// every save is a warning nobody reads.
export function warningsForSet(codes: readonly string[]): PermissionWarning[] {
  const warnings = permissionWarnings(codes);
  if (codes.length === 0) {
    warnings.push({
      code: 'none',
      severity: 'WARNING',
      messageEn: 'This set allows nothing at all: the person can sign in but open no screen.',
      messageAr: 'هذه المجموعة لا تسمح بشيء: يستطيع المستخدم الدخول لكنه لا يفتح أي شاشة.',
    });
  }
  return warnings;
}
