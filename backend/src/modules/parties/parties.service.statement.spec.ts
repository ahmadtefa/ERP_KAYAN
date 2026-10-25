import { Prisma } from '@prisma/client';

import { PartiesService } from './parties.service';

const money = (value: number) => new Prisma.Decimal(value);

function stub(data: {
  party?: unknown;
  invoices?: unknown[];
  vouchers?: unknown[];
}) {
  return {
    customer: {
      findFirst: jest.fn(async () => data.party ?? { id: 'c-1' }),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    supplier: {
      findFirst: jest.fn(async () => data.party ?? { id: 's-1' }),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    salesInvoice: {
      findMany: jest.fn(async () => data.invoices ?? []),
    },
    purchaseInvoice: {
      findMany: jest.fn(async () => data.invoices ?? []),
    },
    cashVoucher: {
      findMany: jest.fn(async () => data.vouchers ?? []),
    },
    $transaction: jest.fn(async (work: unknown[]) => Promise.all(work)),
    $queryRaw: jest.fn(async () => []),
  };
}

const baseParty = {
  id: 'c-1',
  paymentTermDays: 0,
  companyId: 'company-1',
  code: 'C01',
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

describe('PartiesService statement', () => {
  it('runs a customer balance with an opening balance and ordered movements', async () => {
    const prisma = stub({
      party: baseParty,
      invoices: [
        {
          id: 'inv-old',
          invoiceNumber: 'S-1',
          invoiceDate: new Date('2026-01-10'),
          totalAmount: money(100),
          documentType: 'INVOICE',
          status: 'POSTED',
          notes: null,
        },
        {
          id: 'inv-new',
          invoiceNumber: 'S-2',
          invoiceDate: new Date('2026-03-01'),
          totalAmount: money(50),
          documentType: 'INVOICE',
          status: 'POSTED',
          notes: null,
        },
      ],
      vouchers: [
        {
          id: 'v-1',
          voucherNumber: 'R-1',
          voucherDate: new Date('2026-02-15'),
          kind: 'RECEIPT',
          status: 'POSTED',
          amount: money(30),
          description: null,
        },
        {
          id: 'v-old',
          voucherNumber: 'R-0',
          voucherDate: new Date('2026-01-20'),
          kind: 'RECEIPT',
          status: 'POSTED',
          amount: money(10),
          description: null,
        },
      ],
    });
    const service = new PartiesService(prisma as never, { record: jest.fn() } as never);

    const statement = await service.statement('company-1', 'customer', 'c-1', {
      from: '2026-02-01',
      to: '2026-03-31',
    });

    // 100 invoiced in January less 10 received in January is the opening.
    expect(statement.openingBalance).toBe('90.0000');
    // In the period: receipt 30 (credit) then invoice 50 (debit).
    expect(statement.rows.map((row: { number: string }) => row.number)).toEqual(['R-1', 'S-2']);
    expect(statement.rows[0].balance).toBe('60.0000');
    expect(statement.rows[1].balance).toBe('110.0000');
    expect(statement.closingBalance).toBe('110.0000');
    // Every row says on its face that it is a posted document, so a printed
    // statement can be read without asking the screen what it left out.
    expect(statement.rows.every((row: { status: string }) => row.status === 'POSTED')).toBe(
      true,
    );
  });

  it('mirrors the direction for a supplier: purchases are credits', async () => {
    const prisma = stub({
      party: { ...baseParty, id: 's-1', code: 'V01' },
      invoices: [
        {
          id: 'pinv',
          invoiceNumber: 'P-1',
          invoiceDate: new Date('2026-02-02'),
          totalAmount: money(200),
          documentType: 'INVOICE',
          status: 'POSTED',
          notes: null,
        },
      ],
      vouchers: [
        {
          id: 'v-2',
          voucherNumber: 'PAY-1',
          voucherDate: new Date('2026-02-10'),
          kind: 'PAYMENT',
          status: 'POSTED',
          amount: money(80),
          description: null,
        },
      ],
    });
    const service = new PartiesService(prisma as never, { record: jest.fn() } as never);

    const statement = await service.statement('company-1', 'supplier', 's-1', {
      from: '2026-02-01',
      to: '2026-02-28',
    });

    // A purchase is what we owe (credit); a payment reduces it (debit).
    expect(statement.openingBalance).toBe('0.0000');
    expect(statement.rows[0].credit).toBe('200.0000');
    expect(statement.rows[1].debit).toBe('80.0000');
    // Negative closing for a supplier means we owe them 120.
    expect(statement.closingBalance).toBe('-120.0000');
  });

  it('orders documents that share a date, so the statement never changes shape', async () => {
    const sameDay = new Date('2026-02-05');
    const prisma = stub({
      party: baseParty,
      invoices: [
        {
          id: 'inv-b',
          invoiceNumber: 'S-2',
          invoiceDate: sameDay,
          totalAmount: money(50),
          documentType: 'INVOICE',
          status: 'POSTED',
          notes: null,
        },
        {
          id: 'inv-a',
          invoiceNumber: 'S-1',
          invoiceDate: sameDay,
          totalAmount: money(100),
          documentType: 'INVOICE',
          status: 'POSTED',
          notes: null,
        },
      ],
      vouchers: [
        {
          // The stub hands the rows back in this order; the service must not
          // keep it, because the database is free to return any order it likes.
          id: 'v-1',
          voucherNumber: 'R-9',
          voucherDate: sameDay,
          kind: 'RECEIPT',
          status: 'POSTED',
          amount: money(30),
          description: null,
        },
      ],
    });
    const service = new PartiesService(prisma as never, { record: jest.fn() } as never);

    const statement = await service.statement('company-1', 'customer', 'c-1', {
      from: '2026-02-01',
      to: '2026-02-28',
    });

    expect(statement.rows.map((row: { number: string }) => row.number)).toEqual([
      'R-9',
      'S-1',
      'S-2',
    ]);
    // Receipt 30, then +100, then +50 - one balance per row, in that order.
    expect(statement.rows.map((row: { balance: string }) => row.balance)).toEqual([
      '-30.0000',
      '70.0000',
      '120.0000',
    ]);
    expect(statement.closingBalance).toBe('120.0000');
    // Opening plus the period's own movements has to land on the closing,
    // whatever order the rows arrived in.
    const net = Number(statement.totalDebit) - Number(statement.totalCredit);
    expect(Number(statement.openingBalance) + net).toBeCloseTo(
      Number(statement.closingBalance),
      4,
    );
  });
});
