import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { fakeLedger } from '../../testing/stock-ledger.fake';

import { StockDocumentsService } from './stock-documents.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';
const AUTHOR = 'user-storekeeper';
const APPROVER = 'user-manager';

/// A documentary write-off: goods destroyed, spoiled or stolen.
///
/// It is not an adjustment with an excuse. It needs a reason, an approver who
/// is not the person who wrote it, and a journal that puts the loss on 5107 -
/// the inventory-difference account - so the money can be argued about without
/// touching the stock figure. These tests hold those three promises.
describe('a documentary write-off', () => {
  function makeService() {
    const document: Record<string, any> = {
      id: 'doc-wo',
      documentNumber: 'WO-2026-0001',
      companyId: COMPANY,
      branchId: BRANCH,
      fromBranchId: null,
      toBranchId: null,
      toWarehouseId: WAREHOUSE,
      fromWarehouseId: null,
      kind: 'WRITE_OFF',
      status: 'DRAFT',
      documentDate: new Date('2026-11-01T00:00:00.000Z'),
      reason: 'sacks torn by water',
      notes: null,
      costCenterId: null,
      createdBy: AUTHOR,
      approvedAt: null,
      approvedBy: null,
      lines: [
        {
          id: 'line-1',
          itemId: ITEM,
          quantity: D('-4'),
          unitCost: D('0'),
          totalCost: D('0'),
          countedQuantity: null,
          batchId: null,
          lineNumber: 1,
          unitName: null,
          unitQuantity: null,
          unitFactor: null,
          notes: null,
        },
      ],
    };

    const tx = {
      stockDocument: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({})),
      },
      stockDocumentLine: { update: jest.fn(async () => ({})) },
      itemBatch: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({})),
        create: jest.fn(async () => ({ id: 'lot-new' })),
      },
      $executeRaw: jest.fn(async () => 1),
      $queryRaw: jest.fn(async () => []),
    };
    const prisma = {
      // The line loop reads the item before it validates anything about it: a
      // stock document names goods, and the goods decide which unit a
      // quantity is written in.
      item: {
        findFirst: jest.fn(async () => ({
          id: ITEM,
          isStockTracked: true,
          code: 'RICE',
          unit: 'sack',
          units: [],
        })),
      },
      stockDocument: {
        findFirst: jest.fn(async () => document),
        create: jest.fn(async ({ data }: any) => ({ id: 'doc-wo', ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
    };
    const posting = {
      post: jest.fn(async () => ({ id: 'journal-1', entryNumber: 'JE-2026-0009' })),
    };
    const accounts = {
      resolve: jest.fn(async () => ({ inventory: 'acc-inventory', inventoryDifference: 'acc-difference-5107' })),
    };
    const audit = { record: jest.fn(async () => undefined) };
    const settings = { get: jest.fn(async () => ({ allowNegativeStock: false })) };
    const warehouses = {
      resolve: jest.fn(async () => WAREHOUSE),
      assertWarehouseAvailable: jest.fn(async () => undefined),
      availableQuantity: jest.fn(async () => D('10')),
    };
    const numbers = { next: jest.fn(async () => 'WO-2026-0001') };

    const service = new StockDocumentsService(
      prisma as never,
      numbers as never,
      posting as never,
      accounts as never,
      audit as never,
      settings as never,
      warehouses as never,
      { assertPostable: jest.fn(async () => undefined) } as never,
      fakeLedger() as never,
    );
    // The two reads that would need a real book are stubbed: what is under test
    // is the policy around them, not the SQL.
    (service as any).balance = jest.fn(async () => ({ quantity: D('10'), value: D('100') }));
    (service as any).move = jest.fn(async () => undefined);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'doc-wo' } as never);

    return { service, prisma, tx, posting, accounts, audit, document };
  }

  it('refuses a write-off with no reason, before writing anything', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.create(COMPANY, BRANCH, AUTHOR, {
        kind: 'WRITE_OFF',
        branchId: BRANCH,
        toWarehouseId: WAREHOUSE,
        documentDate: '2026-11-01',
        lines: [{ itemId: ITEM, quantity: -1 }],
      } as never),
    ).rejects.toThrow(/needs a reason/i);
    expect(prisma.stockDocument.create).not.toHaveBeenCalled();
  });

  it('refuses a write-off whose line would RECEIVE the goods it claims to destroy', async () => {
    const { service, prisma } = makeService();

    // The sign of the line is the direction of the movement. A positive line
    // on a write-off would have booked stock IN under a document that says the
    // goods were thrown away.
    await expect(
      service.create(COMPANY, BRANCH, AUTHOR, {
        kind: 'WRITE_OFF',
        branchId: BRANCH,
        toWarehouseId: WAREHOUSE,
        documentDate: '2026-11-01',
        reason: 'sacks torn by water',
        lines: [{ itemId: ITEM, quantity: 5 }],
      } as never),
    ).rejects.toThrow(/negative/i);
    expect(prisma.stockDocument.create).not.toHaveBeenCalled();
  });

  it('refuses a kind it does not know rather than storing it', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.create(COMPANY, BRANCH, AUTHOR, {
        kind: 'SCRAP_MAYBE',
        branchId: BRANCH,
        documentDate: '2026-11-01',
        lines: [{ itemId: ITEM, quantity: -1 }],
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.stockDocument.create).not.toHaveBeenCalled();
  });

  it('refuses an opening balance through the adjustment path', async () => {
    const { service } = makeService();

    await expect(
      service.create(COMPANY, BRANCH, AUTHOR, {
        kind: 'OPENING',
        branchId: BRANCH,
        documentDate: '2026-11-01',
        lines: [{ itemId: ITEM, quantity: 10 }],
      } as never),
    ).rejects.toThrow(/opening balance document/i);
  });

  it('approves nothing but a write-off', async () => {
    const { service, document } = makeService();
    document.kind = 'ADJUSTMENT';

    await expect(service.approve(COMPANY, APPROVER, 'doc-wo')).rejects.toThrow(
      /only a write-off needs an approval/i,
    );
  });

  it('will not let the person who recorded the loss approve it', async () => {
    const { service } = makeService();

    await expect(service.approve(COMPANY, AUTHOR, 'doc-wo')).rejects.toThrow(/cannot approve/i);
  });

  it('approves once and reports the second approval as already done', async () => {
    const { service, prisma, document } = makeService();

    await service.approve(COMPANY, APPROVER, 'doc-wo');
    const claim = (prisma.stockDocument.updateMany.mock.calls[0] as any[])[0];
    expect(claim.where).toMatchObject({ id: 'doc-wo', approvedAt: null });

    document.approvedAt = new Date();
    document.approvedBy = APPROVER;
    await expect(service.approve(COMPANY, 'user-other', 'doc-wo')).rejects.toThrow(
      /already approved/i,
    );
  });

  it('reports the lost race rather than overwriting the first name', async () => {
    const { service, prisma } = makeService();
    prisma.stockDocument.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.approve(COMPANY, APPROVER, 'doc-wo')).rejects.toThrow(
      /approved by someone else a moment ago/i,
    );
  });

  it('does not post an unapproved write-off', async () => {
    const { service } = makeService();

    await expect(service.post(COMPANY, APPROVER, 'doc-wo')).rejects.toThrow(
      /must be approved before it is posted/i,
    );
  });

  it('lets the approver post the loss they signed, and the recorder too', async () => {
    // Approval is the separation of duties: the person who recorded the loss
    // may not sign it. Posting is the errand that follows, and either of the
    // two may run it - requiring a third person made a write-off impossible to
    // book on a company with one manager.
    const byApprover = makeService();
    byApprover.document.approvedAt = new Date();
    byApprover.document.approvedBy = APPROVER;
    await byApprover.service.post(COMPANY, APPROVER, 'doc-wo');
    expect(byApprover.prisma.stockDocument.findFirst).toHaveBeenCalled();

    const byRecorder = makeService();
    byRecorder.document.approvedAt = new Date();
    byRecorder.document.approvedBy = APPROVER;
    await byRecorder.service.post(COMPANY, AUTHOR, 'doc-wo');
    expect(byRecorder.prisma.stockDocument.findFirst).toHaveBeenCalled();
  });

  it('posts the loss to the inventory-difference account, and says what it was', async () => {
    const { service, document, posting, accounts, tx } = makeService();
    document.approvedAt = new Date();
    document.approvedBy = APPROVER;

    await service.post(COMPANY, AUTHOR, 'doc-wo');

    expect(accounts.resolve).toHaveBeenCalledWith(tx, COMPANY, [
      'inventory',
      'inventoryDifference',
    ]);
    const entry = (posting.post.mock.calls[0] as any[])[1] as any;
    expect(entry.sourceType).toBe('STOCK_DOCUMENT');
    expect(entry.sourceNumber).toBe('WO-2026-0001');
    // 4 units off a shelf averaging 10: the goods leave inventory at 40 and the
    // 40 lands on the difference account as a debit - a cost, not a credit.
    expect(entry.lines).toEqual([
      {
        accountId: 'acc-inventory',
        credit: expect.anything(),
        description: 'Stock decrease',
      },
      {
        accountId: 'acc-difference-5107',
        debit: expect.anything(),
        description: 'sacks torn by water',
        costCenterId: null,
      },
    ]);
    expect(entry.lines[0].credit.toFixed(4)).toBe('40.0000');
    expect(entry.lines[1].debit.toFixed(4)).toBe('40.0000');
  });

  it('takes the loss out of the lot the line names, and closes an emptied lot', async () => {
    const { service, document, tx } = makeService();
    document.approvedAt = new Date();
    document.approvedBy = APPROVER;
    document.lines[0].batchId = 'lot-1';
    document.lines[0].unitCost = D('10');

    await service.post(COMPANY, AUTHOR, 'doc-wo');

    const claim = (tx.itemBatch.updateMany.mock.calls[0] as any[])[0];
    expect(claim.where).toMatchObject({ id: 'lot-1' });
    expect(claim.where.remainingQuantity.gte.toFixed(4)).toBe('4.0000');
    expect(claim.data.remainingQuantity.decrement.toFixed(4)).toBe('4.0000');
    // An emptied lot is closed, never deleted: its movements stay readable.
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('puts a surplus found in a lot back into that lot', async () => {
    const { service, document, tx } = makeService();
    // A positive adjustment for goods found in a lot: the shelf gains them and
    // so does the lot, or the lot card would deny stock the shelf shows.
    document.kind = 'ADJUSTMENT';
    document.lines[0].quantity = D('2');
    document.lines[0].unitCost = D('10');
    document.lines[0].batchId = 'lot-1';

    await service.post(COMPANY, AUTHOR, 'doc-wo');

    const claim = (tx.itemBatch.updateMany.mock.calls[0] as any[])[0];
    expect(claim.data.remainingQuantity.increment.toFixed(4)).toBe('2.0000');
    expect(claim.data.receivedQuantity.increment.toFixed(4)).toBe('2.0000');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('writes the lot and the shelf onto the movement the loss produced', async () => {
    // The document names the lot and the shelf; the stock movement is what the
    // shelf card and the lot card are read from. A movement that dropped them
    // left the bin still showing goods that had been destroyed.
    const { service, document } = makeService();
    document.approvedAt = new Date();
    document.approvedBy = APPROVER;
    document.lines[0].batchId = 'lot-1';
    document.lines[0].storageLocationId = 'bin-shelf-1';
    document.lines[0].unitCost = D('10');

    await service.post(COMPANY, AUTHOR, 'doc-wo');

    const moved = ((service as any).move as jest.Mock).mock.calls[0][1];
    expect(moved.batchId).toBe('lot-1');
    expect(moved.storageLocationId).toBe('bin-shelf-1');
    expect(moved.direction).toBe('OUT');
    expect(moved.quantity.toFixed(4)).toBe('4.0000');
    expect(moved.warehouseId).toBe(WAREHOUSE);
  });

  it('writes the shelf average onto the document line it carried out', async () => {
    const { service, document, tx } = makeService();
    document.approvedAt = new Date();
    document.approvedBy = APPROVER;

    await service.post(COMPANY, AUTHOR, 'doc-wo');

    const written = (tx.stockDocumentLine.update.mock.calls[0] as any[])[0];
    expect(written.where).toEqual({ id: 'line-1' });
    expect(written.data.unitCost.toFixed(4)).toBe('10.0000');
    expect(written.data.totalCost.toFixed(4)).toBe('40.0000');
  });
});
