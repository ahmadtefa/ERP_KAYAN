import { BadRequestException } from '@nestjs/common';

import { WarehouseService } from './warehouse.service';

/// `resolve()` is the one decision every posting path depends on: which pile
/// did this happen in? It is checked here with a Prisma double, because the
/// rules it enforces - not another company's warehouse, not another branch's
/// warehouse, not an inactive one - are what keep the stock reports honest.
function fakeTx(state: {
  warehouses?: Array<Record<string, unknown>>;
  branches?: Array<Record<string, unknown>>;
  created?: { id: string };
}) {
  const warehouses = state.warehouses ?? [];
  const branches = state.branches ?? [{ id: 'branch-1', companyId: 'company-1', code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' }];
  const calls: string[] = [];

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && 'not' in (value as object)) {
        return row[key] !== (value as { not: unknown }).not;
      }
      // A nullable column absent from the fixture means NULL, which is what
      // `deletedAt: null` asks for.
      if (value === null) return (row[key] ?? null) === null;
      return row[key] === value;
    });

  return {
    calls,
    warehouse: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        calls.push('warehouse.findFirst');
        const found = warehouses.filter((row) => matches(row, args.where));
        // The service asks for the default first; emulate the ordering it
        // relies on rather than returning an arbitrary row.
        found.sort((a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false));
        return found[0] ?? null;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        calls.push('warehouse.create');
        return { id: state.created?.id ?? 'created-warehouse', ...args.data };
      },
    },
    branch: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        calls.push('branch.findFirst');
        return branches.find((row) => matches(row, args.where)) ?? null;
      },
    },
  };
}

describe('WarehouseService.resolve', () => {
  /// resolve() works entirely through the transaction it is handed, which is
  /// what lets it be checked without a database at all.
  const build = () => Object.create(WarehouseService.prototype) as WarehouseService;

  it('uses the warehouse named on the document', async () => {
    const tx = fakeTx({
      warehouses: [
        { id: 'wh-1', companyId: 'company-1', branchId: 'branch-1', isDefault: true, isActive: true, code: 'MAIN' },
        { id: 'wh-2', companyId: 'company-1', branchId: 'branch-1', isDefault: false, isActive: true, code: 'SHOP' },
      ],
    });
    const resolved = await build().resolve(tx as never, 'company-1', 'branch-1', 'wh-2');
    expect(resolved).toBe('wh-2');
  });

  it('falls back to the branch default when the document names none', async () => {
    const tx = fakeTx({
      warehouses: [
        { id: 'wh-1', companyId: 'company-1', branchId: 'branch-1', isDefault: true, isActive: true, code: 'MAIN' },
        { id: 'wh-2', companyId: 'company-1', branchId: 'branch-1', isDefault: false, isActive: true, code: 'SHOP' },
      ],
    });
    const resolved = await build().resolve(tx as never, 'company-1', 'branch-1', null);
    expect(resolved).toBe('wh-1');
  });

  it("refuses a warehouse that belongs to another branch", async () => {
    const tx = fakeTx({
      warehouses: [
        { id: 'wh-9', companyId: 'company-1', branchId: 'branch-2', isDefault: true, isActive: true, code: 'OTHER' },
      ],
    });
    await expect(build().resolve(tx as never, 'company-1', 'branch-1', 'wh-9')).rejects.toThrow(
      BadRequestException,
    );
    await expect(build().resolve(tx as never, 'company-1', 'branch-1', 'wh-9')).rejects.toThrow(
      /another branch/,
    );
  });

  it('refuses a warehouse of another company', async () => {
    const tx = fakeTx({
      warehouses: [
        { id: 'wh-x', companyId: 'company-2', branchId: 'branch-1', isDefault: true, isActive: true, code: 'X' },
      ],
    });
    await expect(build().resolve(tx as never, 'company-1', 'branch-1', 'wh-x')).rejects.toThrow(
      /does not exist in this company/,
    );
  });

  it('refuses an inactive warehouse', async () => {
    const tx = fakeTx({
      warehouses: [
        { id: 'wh-3', companyId: 'company-1', branchId: 'branch-1', isDefault: false, isActive: false, code: 'OLD' },
      ],
    });
    await expect(build().resolve(tx as never, 'company-1', 'branch-1', 'wh-3')).rejects.toThrow(/inactive/);
  });

  it('creates the branch default rather than refusing to post', async () => {
    const tx = fakeTx({ warehouses: [] });
    const resolved = await build().resolve(tx as never, 'company-1', 'branch-1', null);
    expect(resolved).toBe('created-warehouse');
    expect(tx.calls).toContain('warehouse.create');
  });

  it('answers nothing when the branch itself is gone', async () => {
    const tx = fakeTx({ warehouses: [], branches: [] });
    const resolved = await build().resolve(tx as never, 'company-1', 'branch-1', null);
    expect(resolved).toBeNull();
  });
});
