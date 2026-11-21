import { PERMISSIONS } from '../../../prisma/permissions';
import {
  CUSTOM_ROLE_CODE,
  ROLE_CATALOGUE,
  permissionsForRole,
  seededRoles,
} from '../../../prisma/role-catalogue';

const CODES = PERMISSIONS.map(([code]) => code);
const SEEDED = seededRoles(CODES);

describe('role catalogue', () => {
  it('ships at least eighteen roles, seventeen of them ready to use', () => {
    expect(ROLE_CATALOGUE.length).toBeGreaterThanOrEqual(18);
    expect(SEEDED.length).toBeGreaterThanOrEqual(17);
    // CUSTOM is a template the roles screen clones, not a role anybody holds.
    expect(SEEDED.map((role) => role.code)).not.toContain(CUSTOM_ROLE_CODE);
  });

  it('names every role in Arabic and English, with a description in both', () => {
    for (const role of ROLE_CATALOGUE) {
      expect(role.nameEn.trim().length).toBeGreaterThan(0);
      expect(role.nameAr.trim().length).toBeGreaterThan(0);
      expect(role.descriptionEn.trim().length).toBeGreaterThan(0);
      expect(role.descriptionAr.trim().length).toBeGreaterThan(0);
      expect(/[\u0600-\u06FF]/.test(role.nameAr)).toBe(true);
    }
  });

  it('keeps unique codes that fit the database column', () => {
    const codes = ROLE_CATALOGUE.map((role) => role.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9_]{2,40}$/);
    // The two roles existing installations already have must keep their codes.
    expect(codes).toContain('ADMIN');
    expect(codes).toContain('ACCOUNTANT');
  });

  it('resolves every permission prefix to real permissions', () => {
    for (const role of ROLE_CATALOGUE) {
      for (const prefix of role.permissions) {
        const matched = CODES.filter((code) =>
          prefix === '*' ? true : prefix === '.read' ? code.endsWith('.read') : code.startsWith(prefix),
        );
        expect({ role: role.code, prefix, matched: matched.length }).toEqual({
          role: role.code,
          prefix,
          matched: expect.any(Number),
        });
        expect(matched.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives the administrator everything and never a second super-admin by default', () => {
    const admin = SEEDED.find((role) => role.code === 'ADMIN');
    expect(admin?.permissions.sort()).toEqual([...CODES].sort());
    for (const role of SEEDED) {
      if (role.code === 'ADMIN') continue;
      expect(role.permissions).not.toContain('admin.roles.manage');
      expect(role.permissions).not.toContain('admin.backup.restore');
      expect(role.permissions).not.toContain('admin.reset');
    }
  });

  it('separates reading cost from reading stock', () => {
    const storekeeper = SEEDED.find((role) => role.code === 'STOREKEEPER');
    const warehouseManager = SEEDED.find((role) => role.code === 'WAREHOUSE_MANAGER');
    const financeManager = SEEDED.find((role) => role.code === 'FINANCE_MANAGER');
    expect(storekeeper?.permissions).not.toContain('inventory.cost.read');
    expect(storekeeper?.permissions).not.toContain('inventory.cost.manage');
    expect(warehouseManager?.permissions).not.toContain('inventory.cost.read');
    expect(warehouseManager?.permissions).not.toContain('inventory.cost.manage');
    expect(financeManager?.permissions).toContain('inventory.cost.read');
    expect(storekeeper?.permissions).toContain('inventory.stock.read');
  });

  it('separates selling and purchase price access from inventory-only warehouse work', () => {
    const storekeeper = SEEDED.find((role) => role.code === 'STOREKEEPER');
    const salesClerk = SEEDED.find((role) => role.code === 'SALES_CLERK');
    const purchaseClerk = SEEDED.find((role) => role.code === 'PURCHASING_CLERK');
    expect(storekeeper?.permissions).not.toContain('sales.price.read');
    expect(storekeeper?.permissions).not.toContain('purchases.price.read');
    expect(salesClerk?.permissions).toContain('sales.price.read');
    expect(salesClerk?.permissions).not.toContain('purchases.price.read');
    expect(purchaseClerk?.permissions).not.toContain('purchases.price.read');
    expect(purchaseClerk?.permissions).not.toContain('inventory.cost.read');
    expect(purchaseClerk?.permissions).not.toContain('sales.price.read');
    const purchaseManager = SEEDED.find((role) => role.code === 'PURCHASING_MANAGER');
    expect(purchaseManager?.permissions).not.toContain('purchases.price.read');
    expect(purchaseManager?.permissions).not.toContain('inventory.cost.read');
  });

  it('lets a clerk prepare but not post, and a manager post', () => {
    const clerk = SEEDED.find((role) => role.code === 'SALES_CLERK');
    const manager = SEEDED.find((role) => role.code === 'SALES_MANAGER');
    expect(clerk?.permissions).toContain('sales.invoices.create');
    expect(clerk?.permissions).not.toContain('sales.invoices.post');
    expect(manager?.permissions).toContain('sales.invoices.post');
  });

  it('gives read-only roles no write permission at all', () => {
    const readOnly = SEEDED.find((role) => role.code === 'READ_ONLY');
    expect(readOnly?.permissions.length).toBeGreaterThan(10);
    expect(readOnly?.permissions).not.toContain('sales.price.read');
    expect(readOnly?.permissions).not.toContain('purchases.price.read');
    expect(readOnly?.permissions).not.toContain('inventory.cost.read');
    for (const code of readOnly?.permissions ?? []) {
      expect(code).toMatch(/\.read$|^dashboard\.|^notifications\./);
    }
    expect(permissionsForRole({ permissions: [] }, CODES)).toEqual([]);
  });
});
