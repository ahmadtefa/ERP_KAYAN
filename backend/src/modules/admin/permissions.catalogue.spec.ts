import { PERMISSIONS } from '../../../prisma/permissions';

describe('permission catalogue', () => {
  it('has unique codes and bilingual names', () => {
    const codes = PERMISSIONS.map((row) => row[0]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const [code, nameEn, nameAr, module] of PERMISSIONS) {
      expect(code).toMatch(/^[a-z]+\.[a-z.]+$/);
      expect(nameEn.length).toBeGreaterThan(3);
      expect(nameAr.length).toBeGreaterThan(3);
      expect(module.length).toBeGreaterThan(2);
    }
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
  });
});
