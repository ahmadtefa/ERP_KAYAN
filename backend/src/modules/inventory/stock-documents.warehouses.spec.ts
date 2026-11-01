import { Prisma } from '@prisma/client';
import { fakeLedger } from '../../testing/stock-ledger.fake';

import { StockDocumentsService } from './stock-documents.service';

/**
 * A stock document has to say where the goods went and who handled them.
 *
 * A transfer inside one branch used to print only the branch name, so the
 * front store and the back store read as the same place and "who posted this?"
 * was a UUID nobody could read. The list and the detail now carry the two
 * warehouses and the two people by name, and this file pins that shape: a
 * screen can only show a name the API actually sent.
 */

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';

const frontStore = { id: 'wh-front', code: 'MAIN-1', nameEn: 'Front store', nameAr: 'المخزن الأمامي' };
const backStore = { id: 'wh-back', code: 'MAIN-2', nameEn: 'Back store', nameAr: 'المخزن الخلفي' };

const line = {
  id: 'line-1',
  documentId: 'doc-1',
  itemId: 'item-1',
  quantity: new Prisma.Decimal(36),
  unitCost: new Prisma.Decimal(4.5),
  countedQuantity: null,
  notes: null,
  lineNumber: 1,
  unitName: 'كرتونة',
  unitFactor: new Prisma.Decimal(12),
  unitQuantity: new Prisma.Decimal(3),
  baseUnitName: 'عبوة',
  item: { code: 'WATER', nameEn: 'Water', nameAr: 'مياه', unit: 'عبوة' },
};

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    companyId: COMPANY,
    branchId: BRANCH,
    kind: 'TRANSFER',
    documentNumber: 'ST-2026-0007',
    documentDate: new Date('2026-11-02T00:00:00.000Z'),
    fromBranchId: BRANCH,
    toBranchId: BRANCH,
    fromWarehouseId: frontStore.id,
    toWarehouseId: backStore.id,
    status: 'POSTED',
    reason: null,
    notes: 'نقل داخلي',
    costCenterId: null,
    journalEntryId: null,
    postedAt: new Date('2026-11-02T09:00:00.000Z'),
    createdAt: new Date('2026-11-02T08:00:00.000Z'),
    createdBy: 'user-1',
    postedBy: 'user-2',
    branch: { code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' },
    costCenter: null,
    fromWarehouse: frontStore,
    toWarehouse: backStore,
    lines: [line],
    ...overrides,
  };
}

function build(doc: Record<string, unknown> = document()) {
  const prisma = {
    stockDocument: {
      // The argument is named so `mock.calls[0][0]` is a tuple with an
      // element: a zero-argument mock types `calls` as `[]` and indexing it
      // is a compile error, not a test failure.
      findMany: jest.fn(async (_args: { include?: Record<string, unknown> }) => [doc]),
      count: jest.fn(async () => 1),
      findFirst: jest.fn(async () => doc),
    },
    user: {
      findMany: jest.fn(async () => [
        { id: 'user-1', username: 'amal' },
        { id: 'user-2', username: 'tarek' },
      ]),
    },
    $transaction: jest.fn(async (work: unknown) =>
      Array.isArray(work) ? Promise.all(work) : (work as () => unknown)(),
    ),
  };
  const service = new StockDocumentsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    { record: jest.fn(async () => undefined) } as never,
    {} as never,
    {} as never,
    {} as never,
    fakeLedger() as any,
  );
  return { service, prisma };
}

describe('the stock document list names its warehouses and its people', () => {
  it('returns both stores, by code and in both languages', async () => {
    const { service } = build();

    const page = await service.findAll(COMPANY, {});

    expect(page.items[0].fromWarehouse).toEqual(frontStore);
    expect(page.items[0].toWarehouse).toEqual(backStore);
    expect(page.items[0].fromWarehouseId).toBe('wh-front');
    expect(page.items[0].toWarehouseId).toBe('wh-back');
  });

  it('resolves the ids of who raised and who posted it into names', async () => {
    const { service, prisma } = build();

    const page = await service.findAll(COMPANY, {});

    expect(page.items[0].createdByName).toBe('amal');
    expect(page.items[0].postedByName).toBe('tarek');
    expect(page.items[0].createdById).toBe('user-1');
    expect(page.items[0].postedById).toBe('user-2');
    // One read for the page, not one per row.
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('asks the database for the warehouses, so the row is not a bare id', async () => {
    const { service, prisma } = build();

    await service.findAll(COMPANY, {});

    const include = prisma.stockDocument.findMany.mock.calls[0][0].include;
    expect(include?.fromWarehouse).toBeDefined();
    expect(include?.toWarehouse).toBeDefined();
  });

  it('keeps a document that names no warehouse readable', async () => {
    const { service } = build(
      document({ fromWarehouseId: null, toWarehouseId: null, fromWarehouse: null, toWarehouse: null }),
    );

    const page = await service.findAll(COMPANY, {});

    expect(page.items[0].fromWarehouse).toBeNull();
    expect(page.items[0].toWarehouse).toBeNull();
    // A plain adjustment in the branch default is still a valid document.
    expect(page.items[0].documentNumber).toBe('ST-2026-0007');
  });
});

describe('the stock document detail carries the same names', () => {
  it('names the two stores on the document itself', async () => {
    const { service } = build();

    const detail = await service.findOne(COMPANY, 'doc-1');

    expect(detail.fromWarehouse).toEqual(frontStore);
    expect(detail.toWarehouse).toEqual(backStore);
    expect(detail.createdByName).toBe('amal');
    expect(detail.postedByName).toBe('tarek');
  });

  it('still describes each line in the unit that was counted', async () => {
    const { service } = build();

    const detail = await service.findOne(COMPANY, 'doc-1');

    // The warehouse work did not disturb the unit snapshot: 3 cartons of 12.
    expect(detail.lines[0]).toMatchObject({
      unit: 'كرتونة',
      unitFactor: '12.000000',
      unitQuantity: '3.0000',
      quantity: '36.0000',
      baseQuantity: '36.0000',
    });
  });

  it('withholds a cost it may not show without disturbing the names', async () => {
    const { service } = build();

    const detail = await service.findOne(COMPANY, 'doc-1', false);

    expect(detail.lines[0].unitCost).toBeNull();
    expect(detail.fromWarehouse).toEqual(frontStore);
  });
});
