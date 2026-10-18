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
      {} as never,
    );

    await expect(service.post('company-id', 'user-id', 'opening-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(tx.openingBalance.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'opening-id',
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
      $queryRaw: jest.fn().mockResolvedValue([
        { quantity: new Prisma.Decimal(5), value: new Prisma.Decimal(100) },
      ]),
      stockMovement: { create: jest.fn() },
      stockBalance: { update: jest.fn() },
      openingBalance: { update: jest.fn() },
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
});
