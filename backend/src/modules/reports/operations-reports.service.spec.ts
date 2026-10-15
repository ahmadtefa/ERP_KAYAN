import { Prisma } from '@prisma/client';

import { OperationsReportsService } from './operations-reports.service';

/// A Prisma stub that answers only what the report under test reads.
function prismaStub(overrides: Record<string, unknown> = {}) {
  return {
    salesInvoice: {
      findMany: jest.fn(async () => []),
    },
    purchaseInvoice: {
      findMany: jest.fn(async () => []),
    },
    cashVoucher: {
      findMany: jest.fn(async () => []),
    },
    $queryRaw: jest.fn(async () => []),
    ...overrides,
  };
}

const money = (value: number) => new Prisma.Decimal(value);

describe('OperationsReportsService', () => {
  it('reports sales invoices with per-document outstanding and totals', async () => {
    const invoice = {
      id: 'inv-1',
      invoiceNumber: 'S-100',
      invoiceDate: new Date('2026-03-05'),
      dueDate: new Date('2026-04-05'),
      documentType: 'INVOICE',
      status: 'POSTED',
      subTotal: money(100),
      discountAmount: money(0),
      taxAmount: money(14),
      totalAmount: money(114),
      paidAmount: money(50),
      costOfGoods: money(60),
      customer: { id: 'c-1', code: 'C01', nameEn: 'Acme', nameAr: 'أكمي' },
    };
    const prisma = prismaStub({
      salesInvoice: { findMany: jest.fn(async () => [invoice]) },
    });
    const service = new OperationsReportsService(prisma as never);

    const report = await service.sales('company-1', { from: '2026-01-01', to: '2026-12-31' });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].outstanding).toBe('64.0000');
    expect(report.rows[0].grossProfit).toBe('54.0000');
    expect(report.totals.documents).toBe(1);
    expect(report.totals.total).toBe('114.0000');
    expect(report.totals.outstanding).toBe('64.0000');
  });

  it('filters sales by customer and rejects an unknown status', async () => {
    const findMany = jest.fn(async (_args: Record<string, any>) => [] as unknown[]);
    const service = new OperationsReportsService(
      prismaStub({ salesInvoice: { findMany } }) as never,
    );

    await service.sales('company-1', {
      from: '2026-01-01',
      to: '2026-12-31',
      customerId: 'c-9',
      status: 'DRAFT',
    });
    expect(findMany.mock.calls[0][0].where.customerId).toBe('c-9');
    expect(findMany.mock.calls[0][0].where.status).toBe('DRAFT');

    await expect(
      service.sales('company-1', { from: '2026-01-01', to: '2026-12-31', status: 'WEIRD' }),
    ).rejects.toThrow(/status must be/);
  });

  it('splits outstanding invoices into due and overdue', async () => {
    const past = new Date('2026-01-01');
    const future = new Date('2026-12-31');
    const invoice = (id: string, due: Date | null) => ({
      id,
      invoiceNumber: id.toUpperCase(),
      invoiceDate: new Date('2026-02-02'),
      dueDate: due,
      totalAmount: money(100),
      paidAmount: money(25),
      customer: { id: 'c-1', code: 'C01', nameEn: 'Acme', nameAr: 'أكمي' },
    });
    const findMany = jest.fn(async () => [
      invoice('inv-overdue', past),
      invoice('inv-due', future),
      invoice('inv-paid', past),
    ]);
    const service = new OperationsReportsService(
      prismaStub({ salesInvoice: { findMany } }) as never,
    );

    // The "paid" row still has 75 open; the service keeps only open balances.
    const report = await service.outstandingInvoices('company-1', {
      asOf: '2026-06-01',
      kind: 'sales',
    });

    expect(report.rows).toHaveLength(3);
    const overdue = report.rows.filter((row: { state: string }) => row.state === 'OVERDUE');
    const due = report.rows.filter((row: { state: string }) => row.state === 'DUE');
    expect(overdue).toHaveLength(2);
    expect(due).toHaveLength(1);
    expect(report.totals.outstanding).toBe('225.0000');
    expect(report.totals.overdue).toBe('150.0000');
  });

  it('rejects an unknown payments kind', async () => {
    const service = new OperationsReportsService(prismaStub() as never);
    await expect(
      service.payments('company-1', { from: '2026-01-01', to: '2026-12-31', kind: 'CASH' }),
    ).rejects.toThrow(/kind must be/);
  });
});
