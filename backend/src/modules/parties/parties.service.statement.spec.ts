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
          notes: null,
        },
        {
          id: 'inv-new',
          invoiceNumber: 'S-2',
          invoiceDate: new Date('2026-03-01'),
          totalAmount: money(50),
          documentType: 'INVOICE',
          notes: null,
        },
      ],
      vouchers: [
        {
          id: 'v-1',
          voucherNumber: 'R-1',
          voucherDate: new Date('2026-02-15'),
          kind: 'RECEIPT',
          amount: money(30),
          description: null,
        },
        {
          id: 'v-old',
          voucherNumber: 'R-0',
          voucherDate: new Date('2026-01-20'),
          kind: 'RECEIPT',
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
          notes: null,
        },
      ],
      vouchers: [
        {
          id: 'v-2',
          voucherNumber: 'PAY-1',
          voucherDate: new Date('2026-02-10'),
          kind: 'PAYMENT',
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
});
