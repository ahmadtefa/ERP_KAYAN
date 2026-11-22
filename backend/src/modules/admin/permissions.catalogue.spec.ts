import { PERMISSIONS } from '../../../prisma/permissions';
import { PERMISSION_WARNING_RULES } from '../../common/rbac/permission-warnings';
import { SETUP_PERMISSIONS } from '../company/setup.service';

describe('permission catalogue', () => {
  it('has unique codes and bilingual names', () => {
    const codes = PERMISSIONS.map((row) => row[0]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const [code, nameEn, nameAr, module] of PERMISSIONS) {
      expect(code).toMatch(/^[a-z]+(?:\.[a-z]+(?:-[a-z]+)*)+$/);
      expect(nameEn.length).toBeGreaterThan(3);
      expect(nameAr.length).toBeGreaterThan(3);
      expect(module.length).toBeGreaterThan(2);
    }
  });

  it('uses the same complete catalogue for seed and first-run setup', () => {
    expect(SETUP_PERMISSIONS).toEqual(PERMISSIONS);
    expect(PERMISSIONS.some(([code]) => code === 'company.profile.manage')).toBe(true);
  });

  it('includes opening-balance management in both seeded permission catalogues', () => {
    expect(PERMISSIONS.some(([code]) => code === 'accounting.openingbalances.manage')).toBe(true);
    expect(SETUP_PERMISSIONS.some(([code]) => code === 'accounting.openingbalances.manage')).toBe(true);
  });

  it('covers print and export as their own operations', () => {
    const codes = new Set(PERMISSIONS.map((row) => row[0]));
    expect(codes.has('sales.invoices.export')).toBe(true);
    expect(codes.has('purchases.invoices.export')).toBe(true);
    expect(codes.has('reports.export')).toBe(true);
    expect(codes.has('reports.print')).toBe(true);
    expect(codes.has('admin.backup.restore')).toBe(true);
    expect(codes.has('admin.reset')).toBe(true);
    // Reading opening balances is its own operation, separate from managing them.
    expect(codes.has('accounting.openingbalances.read')).toBe(true);
    expect(codes.has('sales.price.read')).toBe(true);
    expect(codes.has('purchases.price.read')).toBe(true);
  });

  it('publishes warning rules that point at permissions that exist', () => {
    // The screen applies these rules itself while boxes are ticked, so a rule
    // that names a code nobody has would warn about nothing - and a rule for a
    // dangerous code that was renamed would silently stop warning.
    const codes = PERMISSIONS.map((row) => row[0]);
    expect(PERMISSION_WARNING_RULES.length).toBeGreaterThan(0);
    for (const rule of PERMISSION_WARNING_RULES) {
      const namesSomething = rule.match.endsWith('.')
        ? codes.some((code) => code.startsWith(rule.match))
        : codes.includes(rule.match);
      expect({ match: rule.match, namesSomething }).toEqual({
        match: rule.match,
        namesSomething: true,
      });
      expect(['INFO', 'WARNING', 'CRITICAL']).toContain(rule.severity);
      expect(rule.messageEn.length).toBeGreaterThan(10);
      expect(rule.messageAr.length).toBeGreaterThan(10);
    }
  });
});
