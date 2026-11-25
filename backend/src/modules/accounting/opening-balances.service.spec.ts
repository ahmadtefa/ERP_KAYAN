import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';

import { OpeningBalancesService } from './opening-balances.service';

describe('OpeningBalancesService', () => {
  it('refuses duplicate stock items in one opening document before creating anything', async () => {
    const tx = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-id' }) },
      account: {
        findFirst: jest.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          code: where.id === 'inventory-id' ? '1104' : '3101',
          isPostable: true,
          isActive: true,
        })),
      },
      item: {
        findFirst: jest.fn().mockResolvedValue({ id: 'item-id', isStockTracked: true }),
      },
      openingBalance: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
      openingBalance: { findFirst: jest.fn() },
    };
    const service = new OpeningBalancesService(
      prisma as never,
      { next: jest.fn() } as never,
      {} as never,
      { resolve: jest.fn().mockResolvedValue({ inventory: 'inventory-id' }) } as never,
      { record: jest.fn() } as never,
      { resolve: jest.fn() } as never,
      { post: jest.fn() } as never,
    );

    await expect(service.create('company-id', 'branch-id', 'user-id', {
      asOfDate: '2026-01-01',
      lines: [
        { accountId: 'inventory-id', itemId: 'item-id', debit: '10', quantity: '1', unitCost: '10' },
        { accountId: 'inventory-id', itemId: 'item-id', debit: '10', quantity: '1', unitCost: '10' },
      ],
    })).rejects.toThrow(/stock item .* is repeated/i);

    expect(tx.openingBalance.create).not.toHaveBeenCalled();
  });

  it('does not write stock or accounting when a concurrent post loses its draft claim', async () => {
    const document = {
      id: 'opening-id',
      companyId: 'company-id',
      branchId: 'branch-id',
      warehouseId: 'warehouse-id',
      documentNumber: 'OB-1',
      asOfDate: new Date('2026-01-01T00:00:00.000Z'),
      description: 'Opening balances',
      status: InvoiceStatus.DRAFT,
      journalEntryId: null,
      totalDebit: new Prisma.Decimal(25),
      totalCredit: new Prisma.Decimal(25),
      lines: [
        {
          id: 'line-id',
          lineNumber: 1,
          itemId: 'item-id',
          debit: new Prisma.Decimal(25),
          quantity: new Prisma.Decimal(1),
          unitCost: new Prisma.Decimal(25),
        },
      ],
    };
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([]),
      openingBalance: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      stockMovement: { create: jest.fn() },
    };
    const prisma = {
      openingBalance: {
        findFirst: jest.fn().mockResolvedValueOnce(document).mockResolvedValueOnce(null),
      },
      $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)),
    };
    const posting = { post: jest.fn() };
    const audit = { record: jest.fn() };
    const service = new OpeningBalancesService(
      prisma as never,
      {} as never,
      posting as never,
      {} as never,
      audit as never,
      { resolve: jest.fn().mockResolvedValue('warehouse-id') } as never,
      { post: jest.fn() } as never,
    );

    await expect(service.post('company-id', 'user-id', 'opening-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(tx.openingBalance.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'opening-id',
        updatedAt: undefined,
        companyId: 'company-id',
        status: InvoiceStatus.DRAFT,
        deletedAt: null,
      },
      data: expect.objectContaining({
        status: InvoiceStatus.POSTED,
        postedBy: 'user-id',
        postedAt: expect.any(Date),
      }),
    });
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(posting.post).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not reverse opening stock when enough quantity remains but its value has been consumed', async () => {
    const document = {
      id: 'opening-id',
      companyId: 'company-id',
      branchId: 'branch-id',
      warehouseId: 'warehouse-id',
      documentNumber: 'OB-1',
      asOfDate: new Date('2026-01-01T00:00:00.000Z'),
      description: 'Opening balances',
      status: InvoiceStatus.POSTED,
      journalEntryId: 'journal-id',
      lines: [
        {
          id: 'line-id',
          lineNumber: 1,
          itemId: 'item-id',
          debit: new Prisma.Decimal(125),
          quantity: new Prisma.Decimal(5),
          unitCost: new Prisma.Decimal(25),
        },
      ],
    };
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([
        { quantity: new Prisma.Decimal(5), value: new Prisma.Decimal(100) },
      ]),
      stockMovement: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([{ itemId: 'item-id', warehouseId: 'warehouse-id', direction: 'IN', quantity: new Prisma.Decimal(5), totalCost: new Prisma.Decimal(125), storageLocationId: null }]) },
      stockBalance: { update: jest.fn() },
      openingBalance: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      openingBalance: { findFirst: jest.fn().mockResolvedValue(document) },
      $transaction: jest.fn((work: (client: unknown) => unknown) => work(tx)),
    };
    const posting = { reverse: jest.fn().mockResolvedValue({ entryNumber: 'JE-REV-1' }) };
    const warehouses = { resolveForReversal: jest.fn().mockResolvedValue('warehouse-id') };
    const audit = { record: jest.fn() };
    const service = new OpeningBalancesService(
      prisma as never,
      {} as never,
      posting as never,
      {} as never,
      audit as never,
      warehouses as never,
      { post: jest.fn() } as never,
    );

    await expect(service.reverse('company-id', 'user-id', 'opening-id')).rejects.toThrow(
      /inventory value are available/i,
    );

    expect(posting.reverse).toHaveBeenCalledTimes(1);
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.openingBalance.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  describe('opening stock shelf', () => {
    const build = (shelf: unknown) => {
      const tx = {
        branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-id' }) },
        account: { findFirst: jest.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, code: where.id === 'inventory-id' ? '1104' : '3101', isPostable: true, isActive: true })) },
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'item-id', isStockTracked: true }) },
        storageLocation: { findFirst: jest.fn().mockResolvedValue(shelf) },
        openingBalance: { create: jest.fn(async ({ data }: { data: unknown }) => ({ id: 'ob-1', documentNumber: 'OB-1', ...(data as object) })) },
      };
      const prisma = {
        $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
        openingBalance: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const service = new OpeningBalancesService(
        prisma as never, { next: jest.fn().mockResolvedValue('OB-1') } as never, {} as never,
        { resolve: jest.fn().mockResolvedValue({ inventory: 'inventory-id' }) } as never,
        { record: jest.fn(), recordRequired: jest.fn() } as never,
        { resolve: jest.fn().mockResolvedValue('wh-1') } as never,
        { post: jest.fn() } as never,
      );
      jest.spyOn(service, 'findOne').mockResolvedValue({} as never);
      return { service, tx };
    };
    const dto = {
      asOfDate: '2026-01-01',
      lines: [
        { accountId: 'inventory-id', itemId: 'item-id', debit: '10', quantity: '1', unitCost: '10', storageLocationId: 'shelf-1' },
        { accountId: 'equity-id', credit: '10' },
      ],
    };

    it('stores the shelf on the item line when it is active and in the opening warehouse', async () => {
      const { service, tx } = build({ id: 'shelf-1', code: 'A-01', isActive: true, warehouseId: 'wh-1' });
      await service.create('company-id', 'branch-id', 'user-id', dto as never);
      const lines = (tx.openingBalance.create.mock.calls[0][0] as { data: { lines: { create: Array<{ storageLocationId?: string | null }> } } }).data.lines.create;
      expect(lines[0].storageLocationId).toBe('shelf-1');
      expect(lines[1].storageLocationId ?? null).toBeNull();
    });

    it('refuses a lot-controlled item before writing anything, naming the line and the item', async () => {
      const { service, tx } = build({ id: 'shelf-1', code: 'A-01', isActive: true, warehouseId: 'wh-1' });
      tx.item.findFirst.mockResolvedValue({ id: 'item-id', code: 'MILK', isStockTracked: true, requiresBatch: true, requiresProductionDate: false, requiresExpiryDate: true });
      const err = await service.create('company-id', 'branch-id', 'user-id', dto as never).catch((e) => e);
      expect(err.response.code).toBe('OPENING_LOT_CONTROLLED_ITEM');
      expect(err.response.message).toMatch(/MILK/);
      expect(err.response.errors.lineNumber).toBe('1');
      expect(tx.openingBalance.create).not.toHaveBeenCalled();
    });

    it('refuses an inactive shelf naming it, and creates nothing', async () => {
      const { service, tx } = build({ id: 'shelf-1', code: 'A-01', isActive: false, warehouseId: 'wh-1' });
      await expect(service.create('company-id', 'branch-id', 'user-id', dto as never)).rejects.toThrow(/A-01.*غير مفعّل/s);
      expect(tx.openingBalance.create).not.toHaveBeenCalled();
    });

    it('refuses a shelf of another warehouse, and creates nothing', async () => {
      const { service, tx } = build({ id: 'shelf-1', code: 'A-01', isActive: true, warehouseId: 'other' });
      await expect(service.create('company-id', 'branch-id', 'user-id', dto as never)).rejects.toThrow(/A-01.*مخزنًا آخر/s);
      expect(tx.openingBalance.create).not.toHaveBeenCalled();
    });
  });

  describe('opening stock reverse ledger', () => {
    const run = (claim: number, origin: Array<Record<string, unknown>> = [{ itemId: 'item-id', warehouseId: 'warehouse-id', direction: 'IN', quantity: new Prisma.Decimal(5), totalCost: new Prisma.Decimal(125), storageLocationId: null }]) => {
      const document = {
        id: 'opening-id', companyId: 'company-id', branchId: 'branch-id', warehouseId: 'warehouse-id',
        documentNumber: 'OB-1', status: InvoiceStatus.POSTED, journalEntryId: 'journal-id',
        lines: [{ id: 'l1', lineNumber: 1, itemId: 'item-id', storageLocationId: null, debit: new Prisma.Decimal(125), quantity: new Prisma.Decimal(5), unitCost: new Prisma.Decimal(25) }],
      };
      const tx = {
        $executeRaw: jest.fn(),
        $queryRaw: jest.fn().mockResolvedValue([{ quantity: new Prisma.Decimal(5), value: new Prisma.Decimal(125) }]),
        stockMovement: { create: jest.fn(), findMany: jest.fn().mockResolvedValue(origin) },
        openingBalance: { updateMany: jest.fn().mockResolvedValue({ count: claim }), update: jest.fn() },
      };
      const prisma = {
        openingBalance: { findFirst: jest.fn().mockResolvedValue(document) },
        $transaction: jest.fn((work: (client: unknown) => unknown) => work(tx)),
      };
      const posting = { reverse: jest.fn().mockResolvedValue({ entryNumber: 'JE-REV-1' }) };
      const ledger = { post: jest.fn() };
      const service = new OpeningBalancesService(
        prisma as never, {} as never, posting as never, {} as never, { record: jest.fn() } as never,
        { resolveForReversal: jest.fn().mockResolvedValue('warehouse-id') } as never, ledger as never,
      );
      jest.spyOn(service, 'findOne').mockResolvedValue({} as never);
      return { service, tx, posting, ledger };
    };

    it('claims the posted document first, then moves the branch AND warehouse book out through the ledger', async () => {
      const { service, tx, posting, ledger } = run(1);
      await service.reverse('company-id', 'user-id', 'opening-id');
      expect(tx.openingBalance.updateMany.mock.invocationCallOrder[0]).toBeLessThan(posting.reverse.mock.invocationCallOrder[0]);
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.openingBalance.updateMany.mock.invocationCallOrder[0]);
      expect(ledger.post).toHaveBeenCalledTimes(1);
      const posted = ledger.post.mock.calls[0][1] as { warehouseId: string; quantity: Prisma.Decimal; value: Prisma.Decimal };
      expect(posted.warehouseId).toBe('warehouse-id');
      expect(posted.quantity.toFixed(4)).toBe('-5.0000');
      expect(posted.value.toFixed(4)).toBe('-125.0000');
    });

    it('takes a historical branch-only opening back out of the branch only, never a fresh default warehouse', async () => {
      const { service, tx, ledger } = run(1, [{ itemId: 'item-id', warehouseId: null, direction: 'IN', quantity: new Prisma.Decimal(5), totalCost: new Prisma.Decimal(125), storageLocationId: null }]);
      await service.reverse('company-id', 'user-id', 'opening-id');
      const posted = ledger.post.mock.calls[0][1] as { warehouseId: string | null };
      expect(posted.warehouseId).toBeNull();
      expect((tx.stockMovement.create.mock.calls[0][0] as { data: { warehouseId: string | null } }).data.warehouseId).toBeNull();
    });

    it.each([
      ['several origins', [0, 1]],
      ['different quantity', [{ quantity: new Prisma.Decimal(4) }]],
      ['different value', [{ totalCost: new Prisma.Decimal(100) }]],
      ['different shelf', [{ storageLocationId: 'shelf-x' }]],
    ])('refuses atomically on historical ambiguity: %s', async (_name, change) => {
      const base = { itemId: 'item-id', warehouseId: 'warehouse-id', direction: 'IN', quantity: new Prisma.Decimal(5), totalCost: new Prisma.Decimal(125), storageLocationId: null };
      const origin = (change as unknown[])[0] === 0 ? [base, { ...base, warehouseId: 'other-wh' }] : [{ ...base, ...(change[0] as object) }];
      const { service, tx, posting, ledger } = run(1, origin);
      await expect(service.reverse('company-id', 'user-id', 'opening-id')).rejects.toThrow(/does not match the line with certainty/);
      expect(tx.openingBalance.updateMany).not.toHaveBeenCalled();
      expect(posting.reverse).not.toHaveBeenCalled();
      expect(ledger.post).not.toHaveBeenCalled();
    });

    it('refuses atomically when no original movement shows where the stock entered', async () => {
      const { service, tx, posting, ledger } = run(1, []);
      await expect(service.reverse('company-id', 'user-id', 'opening-id')).rejects.toThrow(/no original stock movement/);
      expect(posting.reverse).not.toHaveBeenCalled();
      expect(ledger.post).not.toHaveBeenCalled();
      expect(tx.openingBalance.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a second or concurrent reverse before the journal or stock is touched', async () => {
      const { service, tx, posting, ledger } = run(0);
      await expect(service.reverse('company-id', 'user-id', 'opening-id')).rejects.toThrow(/already reversed/);
      expect(posting.reverse).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(ledger.post).not.toHaveBeenCalled();
    });
  });
});
