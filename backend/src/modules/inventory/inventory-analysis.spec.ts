import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { InventoryAnalysisService } from './inventory-analysis.service';

/// The warehouse reports, without a database.
///
/// What these tests hold down is arithmetic and policy, not SQL: that the
/// reconciliation admits a difference instead of netting it away, that a
/// minimum is compared against the warehouse's own figure, and that a shortfall
/// is reported as the reorder quantity minus what is on the shelf - the number a
/// buyer actually needs.
describe('the warehouse reports', () => {
  const COMPANY = '11111111-1111-4111-8111-111111111111';
  const D = (value: string | number) => new Prisma.Decimal(value);

  function makeService(rawRows: unknown[][] = []) {
    const queue = [...rawRows];
    // The fakes are deliberately untyped: what each report hands back differs,
    // and the assertions below read the figure under test.
    const prisma: any = {
      $queryRaw: jest.fn(async () => queue.shift() ?? []),
      itemWarehouseSetting: { findMany: jest.fn(async () => []) },
      warehouseStockBalance: { findMany: jest.fn(async () => []) },
      item: { findMany: jest.fn(async () => []) },
      stockBalance: { findMany: jest.fn(async () => []) },
      auditLog: { findMany: jest.fn(async () => []) },
    };
    return {
      prisma,
      service: new InventoryAnalysisService(prisma as never),
    };
  }

  it('offers every report the screen promises, with the filters each one understands', () => {
    const { service } = makeService();

    const { reports } = service.catalogue();

    expect(reports).toHaveLength(20);
    expect(reports.map((report) => report.slug)).toEqual(
      expect.arrayContaining([
        'item-card',
        'balance-by-warehouse',
        'valuation-by-warehouse',
        'lots',
        'expiring',
        'value-at-risk',
        'write-offs',
        'transfers',
        'count-variances',
        'reconciliation',
      ]),
    );
    // Every report names its filters, so the viewer can build the form without
    // a second list that drifts from this one.
    for (const report of reports) {
      expect(Array.isArray(report.filters)).toBe(true);
      expect(report.titleEn.length).toBeGreaterThan(0);
      expect(report.titleAr.length).toBeGreaterThan(0);
    }
  });

  it('refuses an unknown report by name rather than answering with an empty list', async () => {
    const { service } = makeService();

    await expect(service.run('no-such-report', COMPANY, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reconciles stock against the ledger and admits a real difference', async () => {
    const { service } = makeService([
      // The branch books.
      [
        { branchId: 'b-1', code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي', stock: D('1000.0000') },
        { branchId: 'b-2', code: 'SEC', nameEn: 'Second', nameAr: 'الثاني', stock: D('500.0000') },
      ],
      // The ledger's 1104 balance per branch. The second branch is short 25.
      [
        { branchId: 'b-1', balance: D('1000.0000') },
        { branchId: 'b-2', balance: D('475.0000') },
      ],
    ]);

    const report: any = await service.run('reconciliation', COMPANY, {});

    expect(report.rows[0]).toMatchObject({ difference: '0.0000', matched: true });
    expect(report.rows[1]).toMatchObject({ difference: '25.0000', matched: false });
    // Neither figure is adjusted to make the report look tidy.
    expect(report.totals).toEqual({ stockValue: '1500.0000', ledgerValue: '1475.0000' });
    expect(report.rowCount).toBe(2);
  });

  it('reads the branch of a ledger line from its entry, which is the table that has one', async () => {
    const { service, prisma } = makeService();

    await service.run('reconciliation', COMPANY, {});

    // `journal_lines` has no branch column; taking one from there made the
    // report fail with SQLSTATE 42703 in the installed program.
    const ledgerQuery = prisma.$queryRaw.mock.calls[1][0];
    const sql = Array.isArray(ledgerQuery?.strings) ? ledgerQuery.strings.join('?') : String(ledgerQuery);
    expect(sql).toContain('je."branchId"');
    expect(sql).not.toContain('jl."branchId"');
  });

  it('treats a difference below one piastre as matched, and nothing larger', async () => {
    const { service } = makeService([
      [{ branchId: 'b-1', code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي', stock: D('10.0000') }],
      [{ branchId: 'b-1', balance: D('9.9950') }],
    ]);

    const report: any = await service.run('reconciliation', COMPANY, {});

    expect(report.rows[0].difference).toBe('0.0050');
    expect(report.rows[0].matched).toBe(true);
  });

  it('reports a shortage as the reorder quantity minus what is on the shelf', async () => {
    const { service, prisma } = makeService();
    prisma.itemWarehouseSetting.findMany.mockResolvedValue([
      {
        warehouseId: 'w-1',
        itemId: 'i-1',
        minQuantity: D('10'),
        reorderQuantity: D('25'),
        maxQuantity: D('100'),
        warehouse: { code: 'WH-A' },
        item: { code: 'SKU-1', nameEn: 'Cable', nameAr: 'كابل', unit: 'piece' },
      },
      {
        // Exactly at the minimum still counts as below it: the shelf has reached
        // the point where a buyer is expected to act.
        warehouseId: 'w-1',
        itemId: 'i-2',
        minQuantity: D('10'),
        reorderQuantity: D('30'),
        maxQuantity: D('0'),
        warehouse: { code: 'WH-A' },
        item: { code: 'SKU-2', nameEn: 'Plug', nameAr: 'قابس', unit: 'piece' },
      },
      {
        // Comfortably above its minimum: not on this report.
        warehouseId: 'w-1',
        itemId: 'i-3',
        minQuantity: D('5'),
        reorderQuantity: D('8'),
        maxQuantity: D('50'),
        warehouse: { code: 'WH-A' },
        item: { code: 'SKU-3', nameEn: 'Box', nameAr: 'صندوق', unit: 'piece' },
      },
    ]);
    prisma.warehouseStockBalance.findMany.mockResolvedValue([
      { warehouseId: 'w-1', itemId: 'i-1', quantity: D('4') },
      { warehouseId: 'w-1', itemId: 'i-2', quantity: D('10') },
      { warehouseId: 'w-1', itemId: 'i-3', quantity: D('40') },
    ]);

    const report: any = await service.run('below-minimum', COMPANY, {});

    expect(report.rows.map((row: any) => row.itemCode)).toEqual(['SKU-1', 'SKU-2']);
    expect(report.rows[0]).toMatchObject({ onHand: '4.0000', minimum: '10.0000', shortage: '21.0000' });
    expect(report.rows[1].shortage).toBe('20.0000');
  });

  it('reports stock above a maximum only when it is strictly above it', async () => {
    const { service, prisma } = makeService();
    prisma.itemWarehouseSetting.findMany.mockResolvedValue([
      {
        warehouseId: 'w-1',
        itemId: 'i-1',
        minQuantity: D('0'),
        reorderQuantity: D('0'),
        maxQuantity: D('50'),
        warehouse: { code: 'WH-A' },
        item: { code: 'SKU-1', nameEn: 'Cable', nameAr: 'كابل', unit: 'piece' },
      },
      {
        warehouseId: 'w-1',
        itemId: 'i-2',
        minQuantity: D('0'),
        reorderQuantity: D('0'),
        maxQuantity: D('50'),
        warehouse: { code: 'WH-A' },
        item: { code: 'SKU-2', nameEn: 'Plug', nameAr: 'قابس', unit: 'piece' },
      },
    ]);
    prisma.warehouseStockBalance.findMany.mockResolvedValue([
      { warehouseId: 'w-1', itemId: 'i-1', quantity: D('50') },
      { warehouseId: 'w-1', itemId: 'i-2', quantity: D('51') },
    ]);

    const report: any = await service.run('above-maximum', COMPANY, {});

    expect(report.rows.map((row: any) => row.itemCode)).toEqual(['SKU-2']);
  });

  it('answers the zero-balance report from the branch book, not from a missing shelf row', async () => {
    const { service, prisma } = makeService();
    prisma.item.findMany.mockResolvedValue([
      { id: 'i-1', code: 'SKU-1', nameEn: 'Cable', nameAr: 'كابل', unit: 'piece' },
      { id: 'i-2', code: 'SKU-2', nameEn: 'Plug', nameAr: 'قابس', unit: 'piece' },
    ]);
    prisma.stockBalance.findMany.mockResolvedValue([{ itemId: 'i-1' }]);

    const report: any = await service.run('zero-stock', COMPANY, {});

    expect(report.rows.map((row: any) => row.itemCode)).toEqual(['SKU-2']);
  });

  it('adds the warehouses up to one valuation, in the same figures it prints', async () => {
    const { service } = makeService([
      [
        {
          warehouseId: 'w-1',
          warehouseCode: 'WH-A',
          warehouseNameEn: 'Store A',
          warehouseNameAr: 'مخزن أ',
          lines: 2n,
          quantity: D('30'),
          value: D('600'),
        },
        {
          warehouseId: 'w-2',
          warehouseCode: 'WH-B',
          warehouseNameEn: 'Store B',
          warehouseNameAr: 'مخزن ب',
          lines: 1n,
          quantity: D('10'),
          value: D('300'),
        },
      ],
    ]);

    const report: any = await service.run('valuation-by-warehouse', COMPANY, {});

    expect(report.rows[0]).toMatchObject({ itemCount: 2, quantity: '30.0000', value: '600.0000' });
    expect(report.totals.value).toBe('900.0000');
  });

  it('reads dead stock with a longer window than slow-moving by default', async () => {
    const { service, prisma } = makeService([[], []]);

    const slow: any = await service.run('slow-moving', COMPANY, {});
    const dead: any = await service.run('dead-stock', COMPANY, {});

    expect(slow.filters.days).toBe(90);
    expect(dead.filters.days).toBe(180);
    // The window is the one the query was given, and it is stated in words a
    // reader can check against the rows: a longer window means an earlier since.
    expect(new Date(dead.filters.since).getTime()).toBeLessThan(
      new Date(slow.filters.since).getTime(),
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    // A caller that names its own window keeps it.
    const explicit: any = await service.run('dead-stock', COMPANY, { days: 30 });
    expect(explicit.filters.days).toBe(30);
  });
});
