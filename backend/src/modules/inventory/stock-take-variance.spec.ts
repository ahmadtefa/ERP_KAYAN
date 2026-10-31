import { Prisma } from '@prisma/client';

import { InventoryReportsService } from './inventory-reports.service';

/// The stock-take variance report, without a database.
///
/// The arithmetic is the point: a count records what was counted and the
/// movement that brings the ledger to it, so the book figure is derived rather
/// than re-read, and shortages are never netted against surpluses. If this
/// drifts, a store can lose stock and be told it is fine.
describe('the stock-take variance report', () => {
  const decimal = (value: string) => new Prisma.Decimal(value);

  const document = {
    id: 'doc-1',
    documentNumber: 'CNT-2026-0007',
    documentDate: new Date('2026-11-02T00:00:00.000Z'),
    branch: { code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' },
    toWarehouse: { code: 'WH-A', nameEn: 'Store A', nameAr: 'مخزن أ' },
    lines: [
      {
        // 4 cartons counted, 48 base units, against 69 on the book.
        quantity: decimal('-21.0000'),
        countedQuantity: decimal('48.0000'),
        unitCost: decimal('10.0000'),
        unitName: 'كرتونة',
        unitFactor: decimal('12.000000'),
        unitQuantity: decimal('4.0000'),
        notes: null,
        item: { code: 'SKU-1', nameEn: 'Network cable', nameAr: 'كابل', unit: 'قطعة' },
      },
      {
        // A surplus on the same sheet: 2 pieces found, none on the book.
        quantity: decimal('2.0000'),
        countedQuantity: decimal('2.0000'),
        unitCost: decimal('10.0000'),
        unitName: null,
        unitFactor: null,
        unitQuantity: null,
        notes: 'found behind the rack',
        item: { code: 'SKU-1', nameEn: 'Network cable', nameAr: 'كابل', unit: 'قطعة' },
      },
    ],
  };

  function service(mayReadCostRow = document) {
    const prisma = {
      stockDocument: { findMany: jest.fn().mockResolvedValue([mayReadCostRow]) },
    };
    const settings = { get: jest.fn() };
    const audit = { record: jest.fn() };
    return {
      prisma,
      report: new InventoryReportsService(
        prisma as never,
        audit as never,
        settings as never,
      ),
    };
  }

  it('derives the book figure from the counted figure and the posted movement', async () => {
    const { report } = service();
    const result = await report.stockTakeVariance('company-1', {}, true);
    expect(result.rows[0]).toMatchObject({
      documentNumber: 'CNT-2026-0007',
      warehouseCode: 'WH-A',
      systemQuantity: '69.0000',
      countedQuantity: '48.0000',
      varianceQuantity: '-21.0000',
      varianceValue: '-210.0000',
    });
    // The unit the count was written in survives onto the report.
    expect(result.rows[0]).toMatchObject({
      unitName: 'كرتونة',
      unitFactor: '12.000000',
      unitQuantity: '4.0000',
    });
    // A line entered in base units carries no unit snapshot and must not
    // invent one.
    expect(result.rows[1].unitName).toBeNull();
    expect(result.rows[1].systemQuantity).toBe('0.0000');
  });

  it('reports shortages and surpluses separately, and their net', async () => {
    const { report } = service();
    const { totals } = await report.stockTakeVariance('company-1', {}, true);
    expect(totals).toMatchObject({
      documents: 1,
      lines: 2,
      shortageQuantity: '21.0000',
      surplusQuantity: '2.0000',
      shortageValue: '210.0000',
      surplusValue: '20.0000',
      netValue: '-190.0000',
    });
  });

  it('sends no cost to a caller who may not read costs', async () => {
    const { report } = service();
    const result = await report.stockTakeVariance('company-1', {}, false);
    expect(result.rows.map((row) => row.unitCost)).toEqual([null, null]);
    expect(result.rows.map((row) => row.varianceValue)).toEqual([null, null]);
    expect(result.totals.shortageValue).toBeNull();
    expect(result.totals.surplusValue).toBeNull();
    expect(result.totals.netValue).toBeNull();
    // The quantities are not a price: a storekeeper still gets the difference.
    expect(result.rows[0].varianceQuantity).toBe('-21.0000');
    expect(result.totals.shortageQuantity).toBe('21.0000');
  });

  it('asks only for counts, inside the dates and warehouse it was given', async () => {
    const { prisma, report } = service();
    await report.stockTakeVariance(
      'company-1',
      { from: '2026-11-01', to: '2026-11-30', branchId: 'branch-1', warehouseId: 'wh-1' },
      true,
    );
    const where = prisma.stockDocument.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      companyId: 'company-1',
      kind: 'COUNT',
      deletedAt: null,
      branchId: 'branch-1',
      toWarehouseId: 'wh-1',
    });
    expect(where.documentDate.gte).toEqual(new Date('2026-11-01'));
    expect(where.documentDate.lte).toEqual(new Date('2026-11-30'));
  });
});
