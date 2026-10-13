import { BadRequestException } from '@nestjs/common';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { SalesInvoicesService } from './sales-invoices.service';

describe('invoice posting concurrency guards', () => {
  it('does not post a sales invoice when another request already claimed the draft', async () => {
    const invoice = {
      id: 'sales-1',
      companyId: 'company-1',
      status: 'DRAFT',
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      salesInvoice: { findFirst: jest.fn().mockResolvedValue(invoice) },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback({ salesInvoice: { updateMany } }),
      ),
    };
    const resolve = jest.fn();
    const service = new SalesInvoicesService(
      prisma as any,
      {} as any,
      {} as any,
      { resolve } as any,
      {} as any,
    );

    await expect(service.post('company-1', 'user-1', 'sales-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'sales-1',
        companyId: 'company-1',
        status: 'DRAFT',
        deletedAt: null,
      },
      data: { status: 'POSTED' },
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not post a purchase invoice when another request already claimed the draft', async () => {
    const invoice = {
      id: 'purchase-1',
      companyId: 'company-1',
      status: 'DRAFT',
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      purchaseInvoice: { findFirst: jest.fn().mockResolvedValue(invoice) },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback({ purchaseInvoice: { updateMany } }),
      ),
    };
    const resolve = jest.fn();
    const service = new PurchaseInvoicesService(
      prisma as any,
      {} as any,
      {} as any,
      { resolve } as any,
      {} as any,
    );

    await expect(
      service.post('company-1', 'user-1', 'purchase-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'purchase-1',
        companyId: 'company-1',
        status: 'DRAFT',
        deletedAt: null,
      },
      data: { status: 'POSTED' },
    });
    expect(resolve).not.toHaveBeenCalled();
  });
});
