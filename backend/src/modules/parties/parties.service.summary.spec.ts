import { Prisma } from '@prisma/client';

import { PartiesService } from './parties.service';

const money = (value: number) => new Prisma.Decimal(value);

/// A partner card with one invoice and the vouchers that moved money.
function stub(options: {
  kind: 'customer' | 'supplier';
  total: number;
  paid: number;
  vouchers: Array<{ amount: number; settled: number }>;
}) {
  const invoices = [
    {
      id: 'invoice-1',
      invoiceNumber: 'SI-1',
      invoiceDate: new Date('2026-10-01'),
      dueDate: null,
      totalAmount: money(options.total),
      paidAmount: money(options.paid),
      documentType: 'INVOICE',
      status: 'POSTED',
    },
  ];
  const vouchers = options.vouchers.map((voucher, index) => ({
    id: `voucher-${index}`,
    voucherNumber: `RC-${index}`,
    voucherDate: new Date('2026-10-02'),
    kind: options.kind === 'customer' ? 'RECEIPT' : 'PAYMENT',
    amount: money(voucher.amount),
    status: 'POSTED',
    // The voucher names its partner; that is what makes it theirs.
    customerId: options.kind === 'customer' ? 'c-1' : null,
    supplierId: options.kind === 'supplier' ? 's-1' : null,
    allocations: voucher.settled ? [{ amount: money(voucher.settled) }] : [],
  }));
  const party = {
    id: options.kind === 'customer' ? 'c-1' : 's-1',
    paymentTermDays: 0,
    companyId: 'company-1',
    code: 'P01',
    nameEn: 'Acme',
    nameAr: 'أكمي',
    phone: null,
    email: null,
    taxNumber: null,
    address: null,
    creditLimit: money(0),
    isActive: true,
    notes: null,
    createdAt: new Date('2026-01-01'),
  };
  return {
    customer: { findFirst: jest.fn(async () => party), findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    supplier: { findFirst: jest.fn(async () => party), findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    salesInvoice: { findMany: jest.fn(async () => (options.kind === 'customer' ? invoices : [])) },
    purchaseInvoice: { findMany: jest.fn(async () => (options.kind === 'supplier' ? invoices : [])) },
    cashVoucher: { findMany: jest.fn(async () => vouchers) },
    $transaction: jest.fn(async (work: unknown[]) => Promise.all(work)),
    $queryRaw: jest.fn(async () => []),
  };
}

describe('PartiesService summary money on account', () => {
  it('reports what is unpaid and what was paid on account, and nets them', async () => {
    const prisma = stub({
      kind: 'customer',
      total: 1000,
      paid: 600,
      // 600 settled the invoice; 200 was paid with no invoice named.
      vouchers: [
        { amount: 600, settled: 600 },
        { amount: 200, settled: 0 },
      ],
    });
    const summary = await new PartiesService(prisma as never, { record: jest.fn() } as never).summary('company-1', 'customer', 'c-1');

    expect(summary.totals.outstanding).toBe('400.0000');
    expect(summary.totals.onAccount).toBe('200.0000');
    expect(summary.totals.netBalance).toBe('200.0000');
    // What the customer actually paid is both vouchers, not just the allocated one.
    expect(summary.totals.paid).toBe('800.0000');
  });

  it('does not subtract a voucher that settled everything from the balance', async () => {
    const prisma = stub({
      kind: 'customer',
      total: 500,
      paid: 500,
      vouchers: [{ amount: 500, settled: 500 }],
    });
    const summary = await new PartiesService(prisma as never, { record: jest.fn() } as never).summary('company-1', 'customer', 'c-1');

    expect(summary.totals.onAccount).toBe('0.0000');
    expect(summary.totals.netBalance).toBe('0.0000');
  });

  it('uses a refund to reduce the money held on account instead of adding to it', async () => {
    const prisma = stub({
      kind: 'customer',
      total: 1000,
      paid: 1000,
      // 200 received on account, then 50 refunded.
      vouchers: [
        { amount: 200, settled: 0 },
        { amount: 50, settled: 0 },
      ],
    });
    // The stub makes every voucher the party's normal kind; make the second a
    // refund explicitly, because that is the case being pinned here.
    (prisma.cashVoucher.findMany as jest.Mock).mockImplementation(async () => [
      { id: 'v1', voucherNumber: 'RC-1', voucherDate: new Date('2026-10-02'), kind: 'RECEIPT', amount: money(200), status: 'POSTED', customerId: 'c-1', supplierId: null, allocations: [] },
      { id: 'v2', voucherNumber: 'PV-1', voucherDate: new Date('2026-10-03'), kind: 'PAYMENT', amount: money(50), status: 'POSTED', customerId: 'c-1', supplierId: null, allocations: [] },
    ]);
    const summary = await new PartiesService(prisma as never, { record: jest.fn() } as never).summary('company-1', 'customer', 'c-1');

    expect(summary.totals.onAccount).toBe('150.0000');
    expect(summary.totals.netBalance).toBe('-150.0000');
    // The refund goes back out, so the customer's settled total is a net 150.
    expect(summary.totals.paid).toBe('150.0000');
  });

  it('treats an unallocated supplier payment as a prepayment, not as a discount', async () => {
    const prisma = stub({
      kind: 'supplier',
      total: 960,
      paid: 960,
      vouchers: [
        { amount: 960, settled: 960 },
        { amount: 40, settled: 0 },
      ],
    });
    const summary = await new PartiesService(prisma as never, { record: jest.fn() } as never).summary('company-1', 'supplier', 's-1');

    expect(summary.totals.outstanding).toBe('0.0000');
    expect(summary.totals.onAccount).toBe('40.0000');
    // Negative: the supplier holds 40 of ours.
    expect(summary.totals.netBalance).toBe('-40.0000');
    // Paid is read from the supplier's side too: what we paid them, not a
    // mirror-image negative that a reader would have to translate.
    expect(summary.totals.paid).toBe('1000.0000');
  });

  it('nets a credit note against the invoices instead of leaving it out', async () => {
    // A sales return is stored as an invoice with the opposite meaning. The
    // card and the statement are shown side by side, and the control account
    // carries the net figure; if the card ignored the note it would sit above
    // both of them by exactly the value of the return.
    const prisma = stub({ kind: 'customer', total: 1000, paid: 0, vouchers: [] });
    (prisma.salesInvoice.findMany as jest.Mock).mockImplementation(async () => [
      {
        id: 'inv-1',
        invoiceNumber: 'SI-1',
        invoiceDate: new Date('2026-10-01'),
        dueDate: null,
        totalAmount: money(1000),
        paidAmount: money(0),
        documentType: 'INVOICE',
        status: 'POSTED',
      },
      {
        id: 'cn-1',
        invoiceNumber: 'SR-1',
        invoiceDate: new Date('2026-10-05'),
        dueDate: null,
        totalAmount: money(200),
        paidAmount: money(0),
        documentType: 'CREDIT_NOTE',
        status: 'POSTED',
      },
    ]);
    const summary = await new PartiesService(prisma as never, { record: jest.fn() } as never).summary('company-1', 'customer', 'c-1');

    // 1000 invoiced less the 200 that came back.
    expect(summary.totals.invoiced).toBe('800.0000');
    expect(summary.totals.outstanding).toBe('800.0000');
    expect(summary.totals.netBalance).toBe('800.0000');
    // The tile says "invoices": a return is not one.
    expect(summary.totals.invoices).toBe(1);
    // And the row carries the kind a tap should open.
    expect(summary.recentDocuments.find((doc) => doc.id === 'cn-1')?.kind).toBe('CREDIT_NOTE');
    expect(summary.recentDocuments.find((doc) => doc.id === 'cn-1')?.amount).toBe('-200.0000');
  });

  it('treats money back from a supplier as a reduction of what was paid', async () => {
    const prisma = stub({
      kind: 'supplier',
      total: 960,
      paid: 960,
      vouchers: [{ amount: 960, settled: 960 }],
    });
    (prisma.cashVoucher.findMany as jest.Mock).mockImplementation(async () => [
      { id: 'v1', voucherNumber: 'PV-1', voucherDate: new Date('2026-10-02'), kind: 'PAYMENT', amount: money(960), status: 'POSTED', customerId: null, supplierId: 's-1', allocations: [{ amount: money(960) }] },
      { id: 'v2', voucherNumber: 'PV-2', voucherDate: new Date('2026-10-03'), kind: 'PAYMENT', amount: money(40), status: 'POSTED', customerId: null, supplierId: 's-1', allocations: [] },
      { id: 'v3', voucherNumber: 'RC-9', voucherDate: new Date('2026-10-04'), kind: 'RECEIPT', amount: money(10), status: 'POSTED', customerId: null, supplierId: 's-1', allocations: [] },
    ]);
    const summary = await new PartiesService(prisma as never, { record: jest.fn() } as never).summary('company-1', 'supplier', 's-1');

    // 960 settled the invoice, 40 was a prepayment, 10 came back.
    expect(summary.totals.paid).toBe('990.0000');
    expect(summary.totals.onAccount).toBe('30.0000');
    expect(summary.totals.netBalance).toBe('-30.0000');
  });
});
