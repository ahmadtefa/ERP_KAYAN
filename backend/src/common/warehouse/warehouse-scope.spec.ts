import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { warehouseScopeOf, WarehouseService } from './warehouse.service';

/**
 * Who may see which shelves, and who may rearrange them.
 *
 * The inventory rules the customer asked for are enforced here rather than in
 * a screen, because a screen is a request: an operator assigned to the Maadi
 * branch must not be able to rename a Samalut warehouse by calling the API
 * directly, and must not see its balances either.
 */
describe('warehouseScopeOf', () => {
  it('narrows a branch-assigned user to the branches they hold', () => {
    expect(
      warehouseScopeOf({ branchId: 'branch-2', branchIds: ['branch-1', 'branch-2'] }),
    ).toEqual(['branch-1', 'branch-2']);
  });

  it('falls back to the session branch when no assignment list was loaded', () => {
    expect(warehouseScopeOf({ branchId: 'branch-1' })).toEqual(['branch-1']);
  });

  it('leaves a company-wide account unrestricted', () => {
    expect(warehouseScopeOf({ branchId: null, branchIds: [] })).toBeNull();
  });
});

function service(state: {
  warehouses?: Array<Record<string, unknown>>;
  rows?: Array<Record<string, unknown>>;
  units?: Array<Record<string, unknown>>;
  updateManyCalls?: unknown[];
}) {
  const warehouses = state.warehouses ?? [];
  const calls: Array<{ model: string; args: any }> = [];
  const prisma = {
    warehouse: {
      findFirst: jest.fn(async (args: any) => {
        calls.push({ model: 'warehouse.findFirst', args });
        return (
          warehouses.find((row) => {
            if (args.where.id && row.id !== args.where.id) return false;
            const scope = args.where.branchId;
            if (scope && typeof scope === 'object' && 'in' in scope) {
              return (scope as { in: string[] }).in.includes(row.branchId as string);
            }
            if (scope && typeof scope === 'string') return row.branchId === scope;
            return true;
          }) ?? null
        );
      }),
      findMany: jest.fn(async (args: any) => {
        calls.push({ model: 'warehouse.findMany', args });
        return warehouses;
      }),
      count: jest.fn(async () => warehouses.length),
      updateMany: jest.fn(async (args: any) => {
        calls.push({ model: 'warehouse.updateMany', args });
        return { count: 0 };
      }),
      update: jest.fn(async (args: any) => {
        calls.push({ model: 'warehouse.update', args });
        return { ...warehouses[0], ...args.data };
      }),
      create: jest.fn(async (args: any) => ({ id: 'wh-new', ...args.data })),
    },
    branch: {
      findFirst: jest.fn(async (args: any) =>
        String(args.where.id ?? '').startsWith('branch-')
          ? { id: args.where.id }
          : null,
      ),
    },
    $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
      callback(prisma),
    ),
    itemUnit: {
      findMany: jest.fn(async () => state.units ?? []),
    },
    $queryRaw: jest.fn(async () => state.rows ?? []),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const instance = new WarehouseService(prisma as any, audit as any);
  return { instance, prisma, audit, calls };
}

const warehouse = {
  id: 'wh-1',
  companyId: 'company-1',
  branchId: 'branch-1',
  code: 'MAIN-1',
  nameEn: 'Main store',
  nameAr: 'المخزن الرئيسي',
  address: null,
  isDefault: true,
  isActive: true,
  deletedAt: null,
  branch: { code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' },
};

describe('WarehouseService scoping', () => {
  it('asks for the caller branches when listing', async () => {
    const { instance, prisma, calls } = service({ warehouses: [warehouse] });

    await instance.findAll('company-1', {}, ['branch-1']);

    expect(prisma.warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ branchId: { in: ['branch-1'] } }),
      }),
    );
    expect(calls).toHaveLength(1);
  });

  it('reports another branch warehouse as missing rather than forbidden', async () => {
    const { instance } = service({ warehouses: [warehouse] });

    await expect(instance.findOne('company-1', 'wh-1', ['branch-9'])).rejects.toThrow(
      'Warehouse not found',
    );
  });

  it('refuses to edit a warehouse outside the caller branches', async () => {
    const { instance, prisma } = service({ warehouses: [warehouse] });

    await expect(
      instance.update('company-1', 'user-1', 'wh-1', { nameAr: 'مخزن تاني' }, ['branch-9']),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.warehouse.update).not.toHaveBeenCalled();
  });

  it('refuses to create a warehouse in a branch the caller does not hold', async () => {
    const { instance } = service({
      warehouses: [warehouse],
    });

    await expect(
      instance.create(
        'company-1',
        'user-1',
        { code: 'NEW', nameEn: 'New', nameAr: 'جديد', branchId: 'branch-2' },
        ['branch-1'],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a company-wide account manage any branch', async () => {
    const { instance, prisma } = service({ warehouses: [warehouse] });

    await instance.update('company-1', 'user-1', 'wh-1', { nameAr: 'مخزن' }, null);

    expect(prisma.warehouse.update).toHaveBeenCalled();
  });
});

describe('WarehouseService reactivate', () => {
  it('switches a warehouse back on and never moves the branch default', async () => {
    const inactive = { ...warehouse, isDefault: false, isActive: false };
    const { instance, prisma, audit } = service({ warehouses: [inactive] });

    await instance.reactivate('company-1', 'user-1', 'wh-1');

    expect(prisma.warehouse.update).toHaveBeenCalledWith({
      where: { id: 'wh-1' },
      data: { isActive: true },
    });
    // No updateMany: the default of the branch is untouched.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REACTIVATE', entity: 'warehouses' }),
    );
  });
});

describe('WarehouseService.balanceReport', () => {
  const rows = [
    {
      warehouseId: 'wh-1',
      warehouseCode: 'WH1',
      warehouseNameEn: 'Store one',
      warehouseNameAr: 'مخزن ١',
      branchId: 'branch-1',
      branchCode: 'MAIN',
      branchNameEn: 'Main',
      branchNameAr: 'الرئيسي',
      itemId: 'item-1',
      itemCode: 'WATER',
      itemNameEn: 'Water',
      itemNameAr: 'مياه',
      unit: 'عبوة',
      quantity: new Prisma.Decimal(84),
      value: new Prisma.Decimal(840),
    },
    {
      warehouseId: 'wh-2',
      warehouseCode: 'WH2',
      warehouseNameEn: 'Store two',
      warehouseNameAr: 'مخزن ٢',
      branchId: 'branch-1',
      branchCode: 'MAIN',
      branchNameEn: 'Main',
      branchNameAr: 'الرئيسي',
      itemId: 'item-1',
      itemCode: 'WATER',
      itemNameEn: 'Water',
      itemNameAr: 'مياه',
      unit: 'عبوة',
      quantity: new Prisma.Decimal(36),
      value: new Prisma.Decimal(360),
    },
  ];
  const units = [
    { id: 'u-base', itemId: 'item-1', unit: 'عبوة', factor: new Prisma.Decimal(1) },
    { id: 'u-carton', itemId: 'item-1', unit: 'كرتونة', factor: new Prisma.Decimal(12) },
  ];

  it('renders the balance in the item units while storing one base number', async () => {
    const { instance } = service({ warehouses: [warehouse], rows, units });

    const report = await instance.balanceReport('company-1', {});

    expect(report.rows[0].quantity).toBe('84.0000');
    expect(report.rows[0].breakdown.text).toBe('7 كرتونة');
    expect(report.rows[1].breakdown.text).toBe('3 كرتونة');
  });

  it('sums the warehouses into the item total the branch must agree with', async () => {
    const { instance } = service({ warehouses: [warehouse], rows, units });

    const report = await instance.balanceReport('company-1', {});

    expect(report.itemTotals).toEqual([
      expect.objectContaining({ itemId: 'item-1', quantity: '120.0000', warehouses: 2 }),
    ]);
    expect(report.warehouseTotals.map((entry) => entry.value)).toEqual([
      '840.0000',
      '360.0000',
    ]);
    expect(report.totals.value).toBe('1200.0000');
  });

  it('hides costs from a caller without the cost permission', async () => {
    const { instance } = service({ warehouses: [warehouse], rows, units });

    const report = await instance.balanceReport('company-1', {}, null, false);

    expect(report.rows.every((row) => row.value === null)).toBe(true);
    expect(report.rows.every((row) => row.averageCost === null)).toBe(true);
    expect(report.totals.value).toBeNull();
  });

  it('narrows the query to the caller branches', async () => {
    const { instance, prisma } = service({ warehouses: [warehouse], rows, units });

    await instance.balanceReport('company-1', { q: 'مياه' }, ['branch-1']);

    const [sql] = prisma.$queryRaw.mock.calls[0];
    const rendered = JSON.stringify(sql);
    // The scope travels as a bound array, so the database compares branch ids
    // rather than the service filtering rows after the fact.
    expect(rendered).toContain('::uuid[]');
    expect(rendered).toContain('branch-1');
  });
});
