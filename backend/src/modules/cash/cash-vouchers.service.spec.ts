import { BadRequestException } from '@nestjs/common';
import { CashVoucherKind, InvoiceStatus, Prisma } from '@prisma/client';

import { CashVouchersService } from './cash-vouchers.service';

/**
 * Allocations are the part of a voucher that can quietly corrupt the books:
 * they mark invoices as paid. These tests pin down what a voucher may name,
 * so a receipt can never settle another customer's invoice, a payment can
 * never settle a sales invoice, and one invoice cannot be claimed twice in
 * the same voucher beyond what it is owed.
 */
describe('CashVouchersService allocation validation', () => {
  const companyId = 'company-1';
  const branchId = 'branch-1';
  const userId = 'user-1';
  const customerId = 'customer-1';
  const supplierId = 'supplier-1';

  const cashAccount = {
    id: 'cash-1',
    accountId: 'gl-cash',
    currency: 'SAR',
    isActive: true,
    code: 'CASH',
  };

  const salesInvoice = {
    id: 'si-1',
    invoiceNumber: 'SI-0001',
    customerId,
    status: InvoiceStatus.POSTED,
    currency: 'SAR',
    totalAmount: new Prisma.Decimal(100),
    paidAmount: new Prisma.Decimal(0),
  };

  const purchaseInvoice = {
    id: 'pi-1',
    invoiceNumber: 'PI-0001',
    supplierId,
    status: InvoiceStatus.POSTED,
    currency: 'SAR',
    totalAmount: new Prisma.Decimal(100),
    paidAmount: new Prisma.Decimal(0),
  };

  function buildService(overrides: {
    salesInvoices?: any[];
    purchaseInvoices?: any[];
  } = {}) {
    const tx = {
      cashVoucher: {
        create: jest.fn().mockResolvedValue({ id: 'voucher-1', voucherNumber: 'RC-0001' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      salesInvoice: {
        findFirst: jest.fn().mockResolvedValue(salesInvoice),
        update: jest.fn().mockResolvedValue({}),
      },
      purchaseInvoice: {
        findFirst: jest.fn().mockResolvedValue(purchaseInvoice),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      cashAccount: { findFirst: jest.fn().mockResolvedValue(cashAccount) },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: customerId, isActive: true }) },
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: supplierId, isActive: true }) },
      salesInvoice: {
        findMany: jest.fn().mockResolvedValue(overrides.salesInvoices ?? [salesInvoice]),
      },
      purchaseInvoice: {
        findMany: jest.fn().mockResolvedValue(overrides.purchaseInvoices ?? [purchaseInvoice]),
      },
      cashVoucher: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) => cb(tx)),
    };
    const numbers = { next: jest.fn().mockResolvedValue('RC-0001') };
    const posting = {
      post: jest.fn().mockResolvedValue({ id: 'journal-1', entryNumber: 'JE-0001' }),
      reverse: jest.fn(),
    };
    const accounts = {
      resolve: jest.fn().mockResolvedValue({
        accountsReceivable: 'gl-ar',
        accountsPayable: 'gl-ap',
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new CashVouchersService(
      prisma as any,
      numbers as any,
      posting as any,
      accounts as any,
      audit as any,
    );
    return { service, prisma, tx, numbers, posting, accounts, audit };
  }

  const receiptDto = (allocations: any[]) => ({
    kind: 'RECEIPT',
    cashAccountId: 'cash-1',
    voucherDate: '2026-10-24',
    amount: '100',
    customerId,
    allocations,
  });

  it('rejects an allocation that names two invoices at once', async () => {
    const { service } = buildService();
    await expect(
      service.create(companyId, branchId, userId, receiptDto([
        { salesInvoiceId: 'si-1', purchaseInvoiceId: 'pi-1', amount: '40' },
      ])),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an allocation that names no invoice', async () => {
    const { service } = buildService();
    await expect(
      service.create(companyId, branchId, userId, receiptDto([{ amount: '40' }])),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an allocation against a missing invoice', async () => {
    const { service } = buildService({ salesInvoices: [] });
    await expect(
      service.create(companyId, branchId, userId, receiptDto([
        { salesInvoiceId: 'missing', amount: '40' },
      ])),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invoice that belongs to someone other than the voucher customer', async () => {
    const { service } = buildService({
      salesInvoices: [{ ...salesInvoice, customerId: 'customer-2' }],
    });
    await expect(
      service.create(companyId, branchId, userId, receiptDto([
        { salesInvoiceId: 'si-1', amount: '40' },
      ])),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a purchase invoice on a receipt, and a sales invoice on a payment', async () => {
    const { service } = buildService();
    await expect(
      service.create(companyId, branchId, userId, receiptDto([
        { purchaseInvoiceId: 'pi-1', amount: '40' },
      ])),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create(companyId, branchId, userId, {
        kind: 'PAYMENT',
        cashAccountId: 'cash-1',
        voucherDate: '2026-10-24',
        amount: '100',
        supplierId,
        allocations: [{ salesInvoiceId: 'si-1', amount: '40' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invoice in a different currency than the cash account', async () => {
    const { service } = buildService({
      salesInvoices: [{ ...salesInvoice, currency: 'USD' }],
    });
    await expect(
      service.create(companyId, branchId, userId, receiptDto([
        { salesInvoiceId: 'si-1', amount: '40' },
      ])),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a reversed invoice', async () => {
    const { service } = buildService({
      salesInvoices: [{ ...salesInvoice, status: InvoiceStatus.REVERSED }],
    });
    await expect(
      service.create(companyId, branchId, userId, receiptDto([
        { salesInvoiceId: 'si-1', amount: '40' },
      ])),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects repeated allocations whose total exceeds what the invoice is owed', async () => {
    const { service } = buildService();
    await expect(
      service.create(companyId, branchId, userId, receiptDto([
        { salesInvoiceId: 'si-1', amount: '70' },
        { salesInvoiceId: 'si-1', amount: '70' },
      ])),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a draft voucher with a valid allocation', async () => {
    const { service, prisma } = buildService();
    prisma.cashVoucher.findFirst.mockResolvedValue({
      id: 'voucher-1',
      voucherNumber: 'RC-0001',
      voucherDate: new Date('2026-10-24T00:00:00.000Z'),
      kind: CashVoucherKind.RECEIPT,
      amount: new Prisma.Decimal(100),
      currency: 'SAR',
      status: InvoiceStatus.DRAFT,
      description: null,
      reference: null,
      journalEntryId: null,
      postedAt: null,
      reconciledAt: null,
      createdAt: new Date('2026-10-24T00:00:00.000Z'),
      cashAccount: { code: 'CASH', nameEn: 'Cash', nameAr: 'الخزينة', kind: 'CASH' },
      customer: { code: 'C-1', nameEn: 'Customer', nameAr: 'عميل' },
      supplier: null,
      allocations: [
        {
          id: 'alloc-1',
          salesInvoiceId: 'si-1',
          purchaseInvoiceId: null,
          amount: new Prisma.Decimal(40),
          salesInvoice: { id: 'si-1', invoiceNumber: 'SI-0001', totalAmount: new Prisma.Decimal(100), paidAmount: new Prisma.Decimal(0) },
          purchaseInvoice: null,
        },
      ],
    });

    const created = await service.create(companyId, branchId, userId, receiptDto([
      { salesInvoiceId: 'si-1', amount: '40' },
    ]));
    expect(created.allocations).toHaveLength(1);
    expect(created.allocations[0].amount).toBe('40.0000');
  });

  function draftVoucher(overrides: Record<string, unknown> = {}) {
    return {
      id: 'voucher-1',
      companyId,
      branchId,
      voucherNumber: 'RC-0001',
      voucherDate: new Date('2026-10-24T00:00:00.000Z'),
      kind: CashVoucherKind.RECEIPT,
      amount: new Prisma.Decimal(40),
      currency: 'SAR',
      status: InvoiceStatus.DRAFT,
      customerId,
      supplierId: null,
      counterAccountId: null,
      description: null,
      journalEntryId: null,
      allocations: [
        {
          id: 'alloc-1',
          salesInvoiceId: 'si-1',
          purchaseInvoiceId: null,
          amount: new Prisma.Decimal(40),
        },
      ],
      cashAccount: { id: 'cash-1', accountId: 'gl-cash', isActive: true, code: 'CASH' },
      ...overrides,
    };
  }

  it('refuses to post a legacy draft whose allocated invoice has been reversed', async () => {
    const { service, prisma, tx } = buildService();
    prisma.cashVoucher.findFirst.mockResolvedValue(draftVoucher());
    tx.salesInvoice.findFirst.mockResolvedValue({
      ...salesInvoice,
      status: InvoiceStatus.REVERSED,
    });

    await expect(service.post(companyId, userId, 'voucher-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.salesInvoice.update).not.toHaveBeenCalled();
  });

  it('refuses to post a draft that settles an invoice nobody has posted yet', async () => {
    const { service, prisma, tx } = buildService();
    prisma.cashVoucher.findFirst.mockResolvedValue(draftVoucher());
    tx.salesInvoice.findFirst.mockResolvedValue({
      ...salesInvoice,
      status: InvoiceStatus.DRAFT,
    });

    await expect(
      service.post(companyId, userId, 'voucher-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to post a legacy draft whose invoice belongs to another customer', async () => {
    const { service, prisma, tx } = buildService();
    prisma.cashVoucher.findFirst.mockResolvedValue(draftVoucher());
    tx.salesInvoice.findFirst.mockResolvedValue({
      ...salesInvoice,
      customerId: 'customer-2',
    });

    await expect(service.post(companyId, userId, 'voucher-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.salesInvoice.update).not.toHaveBeenCalled();
  });

  it('refuses to post a legacy draft that settles a sales invoice with a payment', async () => {
    const { service, prisma, tx } = buildService();
    prisma.cashVoucher.findFirst.mockResolvedValue(
      draftVoucher({ kind: CashVoucherKind.PAYMENT }),
    );
    tx.salesInvoice.findFirst.mockResolvedValue(salesInvoice);

    await expect(service.post(companyId, userId, 'voucher-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.salesInvoice.update).not.toHaveBeenCalled();
  });
});
