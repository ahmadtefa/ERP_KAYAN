import { PERMISSIONS } from '../../../prisma/permissions';
import { SETUP_PERMISSIONS } from '../company/setup.service';

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
  });
});
