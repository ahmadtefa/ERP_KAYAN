import { Prisma } from '@prisma/client';

import { ItemsService } from './items.service';
import { InventoryReportsService } from './inventory-reports.service';
import { StockService } from './stock.service';
import { StockDocumentsService } from './stock-documents.service';

const D = (value: string) => new Prisma.Decimal(value);

/// A sales-clerk style caller: may read items and stock, never costs.
const NO_COST = false;
const WITH_COST = true;

function itemRow() {
  return {
    id: 'item-1',
    companyId: 'company-1',
    code: 'MILK',
    nameEn: 'Milk',
    nameAr: 'لبن',
    unit: 'piece',
    barcode: null,
    salePrice: D('20.0000'),
    purchasePrice: D('11.0000'),
    reorderLevel: D('5.0000'),
    taxRate: null,
    isStockTracked: true,
    isActive: true,
    categoryId: null,
    countryOfOrigin: null,
    notes: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    units: [
      {
        id: 'unit-base',
        itemId: 'item-1',
        unit: 'piece',
        factor: D('1.000000'),
        barcode: '6221000000011',
        salePrice: D('20.0000'),
        purchasePrice: D('11.0000'),
        isActive: true,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      },
      {
        id: 'unit-carton',
        itemId: 'item-1',
        unit: 'carton',
        factor: D('10.000000'),
        barcode: '6221000000028',
        salePrice: D('190.0000'),
        purchasePrice: D('100.0000'),
        isActive: true,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      },
    ],
  };
}

describe('cost redaction - items and item units', () => {
  function buildService(item = itemRow()) {
    const prisma = {
      item: {
        findFirst: jest.fn().mockResolvedValue(item),
        findMany: jest.fn().mockResolvedValue([item]),
        count: jest.fn().mockResolvedValue(1),
      },
      itemUnit: { findFirst: jest.fn() },
      $transaction: jest.fn(async (callback: unknown) =>
        Array.isArray(callback)
          ? [[item], 1]
          : (callback as (client: unknown) => unknown)({}),
      ),
    };
    const service = new ItemsService(
      prisma as never,
      { record: jest.fn() } as never,
      { resolve: jest.fn() } as never,
      { post: jest.fn() } as never,
      { resolve: jest.fn() } as never,
    );
    return { service, prisma };
  }

  it('findAll keeps every cost for an allowed caller', async () => {
    const { service } = buildService();
    const allowed = await service.findAll('company-1', {}, WITH_COST);
    expect(allowed.items[0].purchasePrice).toBe('11.0000');
    expect(allowed.items[0].units?.map((u) => u.purchasePrice)).toEqual([
      '11.0000',
      '100.0000',
    ]);
  });

  it('findAll redacts item and every unit purchase price without cost.read', async () => {
    const { service } = buildService();
    const redacted = await service.findAll('company-1', {}, NO_COST);
    expect(redacted.items[0].purchasePrice).toBeNull();
    // The leak this audit found: unit costs used to travel in clear text.
    expect(redacted.items[0].units?.every((u) => u.purchasePrice === null)).toBe(true);
    // Sale prices and identifiers stay, so selling work is unaffected.
    expect(redacted.items[0].salePrice).toBe('20.0000');
    expect(redacted.items[0].units?.[1].barcode).toBe('6221000000028');
  });

  it('findOne redacts nested unit costs without cost.read', async () => {
    const { service } = buildService();
    const redacted = await service.findOne('company-1', 'item-1', NO_COST);
    expect(redacted.purchasePrice).toBeNull();
    expect(redacted.units?.map((u) => u.purchasePrice)).toEqual([null, null]);
  });

  it('by-barcode redacts the unit catalogue cost on a carton scan', async () => {
    const item = itemRow();
    const unit = item.units[1];
    const prisma = {
      item: { findFirst: jest.fn().mockResolvedValue(null) },
      itemUnit: {
        findFirst: jest.fn().mockResolvedValue({ ...unit, item }),
      },
      $transaction: jest.fn(),
    };
    const service = new ItemsService(
      prisma as never,
      { record: jest.fn() } as never,
      { resolve: jest.fn() } as never,
      { post: jest.fn() } as never,
      { resolve: jest.fn() } as never,
    );
    const redacted = await service.findByBarcode(
      'company-1',
      '6221000000028',
      NO_COST,
    );
    expect(redacted.purchasePrice).toBeNull();
    expect(redacted.units.every((u) => u.purchasePrice === null)).toBe(true);
    expect(redacted.salePrice).toBe('190.0000');

    const allowed = await service.findByBarcode(
      'company-1',
      '6221000000028',
      WITH_COST,
    );
    expect(allowed.units.find((u) => u.unit === 'carton')?.purchasePrice).toBe(
      '100.0000',
    );
  });
});

describe('cost redaction - unit catalogue endpoint', () => {
  it('listUnits redacts purchasePrice without cost.read and keeps it with it', async () => {
    const units = [
      {
        id: 'u1',
        unit: 'piece',
        factor: D('1'),
        barcode: 'b1',
        salePrice: D('20'),
        purchasePrice: D('11'),
        isBase: true,
        isActive: true,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      },
    ];
    const prisma = {
      item: { findFirst: jest.fn().mockResolvedValue({ id: 'i1', code: 'MILK', unit: 'piece' }) },
      itemUnit: { findMany: jest.fn().mockResolvedValue(units) },
    };
    const service = new InventoryReportsService(
      prisma as never,
      { record: jest.fn() } as never,
      { get: jest.fn() } as never,
    );

    const redacted = await service.listUnits('c1', 'i1', NO_COST);
    expect(redacted.items[0].purchasePrice).toBeNull();
    expect(redacted.items[0].salePrice).toBe('20.0000');

    const allowed = await service.listUnits('c1', 'i1', WITH_COST);
    expect(allowed.items[0].purchasePrice).toBe('11.0000');
  });
});

describe('cost redaction - stock and valuation reads', () => {
  function stockService() {
    const balance = {
      itemId: 'item-1',
      item: { code: 'MILK', nameEn: 'Milk', nameAr: 'لبن', unit: 'piece' },
      branchId: 'branch-1',
      branch: { code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' },
      quantity: D('10'),
      value: D('110'),
    };
    const prisma = {
      stockBalance: { findMany: jest.fn().mockResolvedValue([balance]) },
      item: { findFirst: jest.fn() },
      stockMovement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm1',
            movementDate: new Date('2026-10-02T00:00:00Z'),
            direction: 'IN' as const,
            branch: { code: 'MAIN' },
            warehouse: { code: 'WH1', nameEn: 'Warehouse', nameAr: 'مخزن' },
            quantity: D('10'),
            unitCost: D('11'),
            totalCost: D('110'),
            referenceType: 'OPENING',
            referenceNumber: 'OP-1',
            notes: null,
          },
        ]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ net: D('110') }]),
    };
    return { prisma, stock: new StockService(prisma as never) };
  }

  it('balances withhold value and averageCost without cost.read', async () => {
    const { stock } = stockService();
    const redacted = await stock.balances('c1', {}, NO_COST);
    expect(redacted[0].value).toBeNull();
    expect(redacted[0].averageCost).toBeNull();
    expect(redacted[0].quantity).toBe('10.0000');

    const allowed = await stock.balances('c1', {}, WITH_COST);
    expect(allowed[0].value).toBe('110.0000');
    expect(allowed[0].averageCost).toBe('11.0000');
  });

  it('item ledger withholds every money column without cost.read', async () => {
    const { stock, prisma } = stockService();
    prisma.item.findFirst.mockResolvedValue({
      id: 'item-1',
      code: 'MILK',
      nameEn: 'Milk',
      nameAr: 'لبن',
      unit: 'piece',
    });
    const redacted = await stock.itemLedger('c1', 'item-1', NO_COST);
    expect(redacted.movements[0].unitCost).toBeNull();
    expect(redacted.movements[0].totalCost).toBeNull();
    expect(redacted.movements[0].runningValue).toBeNull();
    expect(redacted.movements[0].runningQuantity).toBe('10.0000');

    const allowed = await stock.itemLedger('c1', 'item-1', WITH_COST);
    expect(allowed.movements[0].unitCost).toBe('11.0000');
    expect(allowed.movements[0].totalCost).toBe('110.0000');
  });

  it('stock document detail withholds line unitCost without cost.read', async () => {
    const document = {
      id: 'doc-1',
      documentNumber: 'ADJ-1',
      kind: 'ADJUSTMENT' as const,
      documentDate: new Date('2026-10-03T00:00:00Z'),
      status: 'POSTED' as const,
      reason: 'count',
      notes: null,
      journalEntryId: 'je-1',
      postedAt: new Date('2026-10-03T00:00:00Z'),
      createdAt: new Date('2026-10-03T00:00:00Z'),
      branch: { code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' },
      costCenterId: null,
      lines: [
        {
          id: 'l1',
          lineNumber: 1,
          itemId: 'item-1',
          item: { code: 'MILK', nameEn: 'Milk', nameAr: 'لبن', unit: 'piece' },
          unitName: null,
          unitFactor: null,
          unitQuantity: null,
          quantity: D('2'),
          unitCost: D('11'),
          countedQuantity: null,
          notes: null,
        },
      ],
    };
    const prisma = { stockDocument: { findFirst: jest.fn().mockResolvedValue(document) } };
    const service = new StockDocumentsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const redacted = await service.findOne('c1', 'doc-1', NO_COST);
    expect(redacted.lines[0].unitCost).toBeNull();
    expect(redacted.lines[0].quantity).toBe('2.0000');
    const allowed = await service.findOne('c1', 'doc-1', WITH_COST);
    expect(allowed.lines[0].unitCost).toBe('11.0000');
  });
});

describe('cost redaction - inventory reports', () => {
  function reportsService() {
    const balance = {
      itemId: 'item-1',
      item: {
        code: 'MILK',
        nameEn: 'Milk',
        nameAr: 'لبن',
        unit: 'piece',
        category: null,
      },
      branch: { code: 'MAIN', nameEn: 'Main' },
      quantity: D('10'),
      value: D('110'),
    };
    const prisma = {
      stockBalance: { findMany: jest.fn().mockResolvedValue([balance]) },
      stockMovement: { groupBy: jest.fn().mockResolvedValue([]) },
      item: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'item-1',
            code: 'MILK',
            nameEn: 'Milk',
            nameAr: 'لبن',
            unit: 'piece',
            reorderLevel: D('20'),
            purchasePrice: D('11'),
            category: { code: 'C1', nameEn: 'Cat' },
            stockBalances: [
              { quantity: D('10'), value: D('110'), branch: { code: 'MAIN' } },
            ],
          },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ net: D('110') }]),
    };
    const service = new InventoryReportsService(
      prisma as never,
      { record: jest.fn() } as never,
      { get: jest.fn().mockResolvedValue({ inventoryValuation: 'WEIGHTED_AVERAGE' }) } as never,
    );
    return service;
  }

  it('valuation redacts value, averageCost and ledger reconciliation without cost.read', async () => {
    const service = reportsService();
    const redacted = await service.valuation('c1', {}, NO_COST);
    expect(redacted.rows[0].value).toBeNull();
    expect(redacted.rows[0].averageCost).toBeNull();
    expect(redacted.totals.value).toBeNull();
    expect(redacted.totals.ledgerValue).toBeNull();
    expect(redacted.rows[0].quantity).toBe('10.0000');

    const allowed = await service.valuation('c1', {}, WITH_COST);
    expect(allowed.totals.value).toBe('110.0000');
    expect(allowed.rows[0].averageCost).toBe('11.0000');
  });

  it('reorder redacts cost-derived columns but keeps quantities and shortfall', async () => {
    const service = reportsService();
    const redacted = await service.reorder('c1', {}, NO_COST);
    const row = redacted.rows[0];
    expect(row.averageCost).toBeNull();
    expect(row.estimatedOrderCost).toBeNull();
    expect(row.value).toBeNull();
    expect(row.onHand).toBe('10.0000');
    expect(row.shortfall).toBe('10.0000');
    expect(redacted.totals.estimatedOrderCost).toBeNull();
  });

  it('slow-moving redacts the tied-up value without cost.read', async () => {
    const service = reportsService();
    const redacted = await service.slowMoving('c1', {}, NO_COST);
    expect(redacted.rows[0].value).toBeNull();
    expect(redacted.totals.value).toBeNull();
    const allowed = await service.slowMoving('c1', {}, WITH_COST);
    expect(allowed.rows[0].value).toBe('110.0000');
  });
});
