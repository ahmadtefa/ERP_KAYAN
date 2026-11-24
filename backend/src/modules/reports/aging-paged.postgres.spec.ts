import { InvoiceDocumentType, InvoiceStatus, PrismaClient } from '@prisma/client';
import { createPgAdapter } from '../../common/prisma/prisma.service';
import { AgingService } from './aging.service';

// Needs a scratch PostgreSQL with migrations: KAYAN_AGING_PG=1 DATABASE_URL=<scratch db>.
const run = process.env.KAYAN_AGING_PG === '1';
(run ? describe : describe.skip)('paged aging equals the legacy report', () => {
  const prisma = new PrismaClient({ adapter: createPgAdapter() });
  const service = new AgingService(prisma as any);
  const company = 'c0000000-0000-4000-8000-0000000a9100';
  const br1 = 'b0000000-0000-4000-8000-0000000a9101';
  const br2 = 'b0000000-0000-4000-8000-0000000a9102';
  const pid = (i: number) => `a000000${i}-0000-4000-8000-0000000a9200`;
  const day = (offset: number) => new Date(Date.UTC(2026, 9, 18 + offset));

  const invoiceRows = () => {
    const rows: any[] = [];
    let n = 0;
    const add = (party: number, branchId: string, type: InvoiceDocumentType, total: number, paid: number,
      dateOffset: number, dueOffset: number | null, status: InvoiceStatus = InvoiceStatus.POSTED, deleted = false) => {
      n += 1;
      rows.push({
        n, party, branchId, type, total, paid, invoiceDate: day(dateOffset),
        dueDate: dueOffset === null ? null : day(dueOffset), status, deletedAt: deleted ? new Date() : null,
      });
    };
    // party 0: invoice mix across every bucket, a credit note, a fully paid one (excluded)
    add(0, br1, 'INVOICE', 114, 0, -10, 20);        // not due
    add(0, br1, 'INVOICE', 200, 50, -50, -20);      // 20 days late
    add(0, br2, 'INVOICE', 300.5, 0, -100, null);   // no due date: 100 days
    add(0, br1, 'INVOICE', 80, 0, -140, -45);       // 45
    add(0, br1, 'INVOICE', 70, 0, -200, -75);       // 75
    add(0, br1, 'INVOICE', 60, 60, -30, -10);       // zero balance: excluded
    add(0, br1, 'CREDIT_NOTE', 34.2, 0, -5, null);  // reduces what is owed, never late
    add(0, br2, 'DEBIT_NOTE', 10, 4, -5, -90);      // signed like a credit note per legacy rule
    // party 1: only a credit note, so a negative balance
    add(1, br1, 'CREDIT_NOTE', 500, 100, -3, null);
    // party 2: ties with party 3 on total, to check the party order is deterministic
    add(2, br1, 'INVOICE', 90, 0, -1, 5);
    add(3, br1, 'INVOICE', 90, 0, -1, 5);
    // excluded rows: draft, deleted, dated after the as-of date
    add(4, br1, 'INVOICE', 999, 0, -1, 1, InvoiceStatus.DRAFT);
    add(4, br1, 'INVOICE', 999, 0, -1, 1, InvoiceStatus.POSTED, true);
    add(4, br1, 'INVOICE', 999, 0, 5, 9);
    // party 5: exact boundary days (0, 1, 30, 31, 60, 61, 90, 91 days overdue)
    [0, 1, 30, 31, 60, 61, 90, 91].forEach((late, i) => add(5, br1, 'INVOICE', 10 + i, 0, -100, -late));
    return rows;
  };

  beforeAll(async () => {
    if(process.env.NODE_ENV !== 'test' || new URL(process.env.DATABASE_URL ?? '').pathname !== '/erp_kayan_acceptance') throw new Error('Isolated acceptance database required');
    await cleanup();
    await prisma.company.create({ data: { id: company, isActive:false, deletedAt:new Date(), code: 'AGP', nameEn: 'Aging paged', nameAr: 'تقادم' } });
    for (const [bid, code] of [[br1, 'AG1'], [br2, 'AG2']]) {
      await prisma.branch.create({ data: { id: bid, companyId: company, code, nameEn: code, nameAr: code } });
    }
    for (let i = 0; i < 6; i += 1) {
      await prisma.customer.create({ data: { id: pid(i), companyId: company, code: `AC${i}`, nameEn: `Cust ${i}`, nameAr: `عميل ${i}` } });
      await prisma.supplier.create({ data: { id: pid(i).replace('a0', 'a1'), companyId: company, code: `AS${i}`, nameEn: `Sup ${i}`, nameAr: `مورد ${i}` } });
    }
    const acc = (code: string, type: any) => prisma.account.create({
      data: { id: `ac000000-0000-4000-8000-${code.padStart(12, '0')}`, companyId: company, code, nameEn: code, nameAr: code, type },
    });
    const ar = await acc('1103', 'ASSET'); const ap = await acc('2101', 'LIABILITY'); const sales = await acc('4101', 'REVENUE');
    let entryNo = 0;
    const entry = async (branchId: string, dateOffset: number, status: any, lines: Array<[string, number, number]>) => {
      entryNo += 1;
      const debit = lines.reduce((t, l) => t + l[1], 0); const credit = lines.reduce((t, l) => t + l[2], 0);
      await prisma.journalEntry.create({
        data: {
          companyId: company, branchId, entryNumber: `AGJ-${entryNo}`, entryDate: day(dateOffset), status,
          totalDebit: debit, totalCredit: credit,
          lines: { create: lines.map(([accountId, d, c], i) => ({ lineNumber: i + 1, accountId, debit: d, credit: c })) },
        },
      });
    };
    await entry(br1, -20, 'POSTED', [[ar.id, 700, 0], [sales.id, 0, 700]]);
    await entry(br2, -10, 'REVERSED', [[ar.id, 50, 0], [sales.id, 0, 50]]);
    await entry(br1, -5, 'POSTED', [[ar.id, 0, 120], [sales.id, 120, 0]]);
    await entry(br1, -1, 'DRAFT', [[ar.id, 9999, 0], [sales.id, 0, 9999]]);   // draft: not in the ledger
    await entry(br1, 3, 'POSTED', [[ar.id, 8888, 0], [sales.id, 0, 8888]]);  // after the as-of date
    await entry(br1, -20, 'POSTED', [[sales.id, 400, 0], [ap.id, 0, 400]]);
    await entry(br2, -10, 'POSTED', [[ap.id, 100, 0], [sales.id, 0, 100]]);
    for (const r of invoiceRows()) {
      const common = {
        companyId: company, branchId: r.branchId, invoiceNumber: `AG-${r.n}`, invoiceDate: r.invoiceDate,
        dueDate: r.dueDate, status: r.status, documentType: r.type, totalAmount: r.total, paidAmount: r.paid,
        deletedAt: r.deletedAt,
      };
      await prisma.salesInvoice.create({ data: { ...common, customerId: pid(r.party) } });
      await prisma.purchaseInvoice.create({ data: { ...common, supplierId: pid(r.party).replace('a0', 'a1') } });
    }
  }, 60_000);

  afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

  async function cleanup() {
    await prisma.$executeRaw`DELETE FROM journal_lines WHERE "journalEntryId" IN (SELECT id FROM journal_entries WHERE "companyId" = ${company}::uuid)`;
    await prisma.journalEntry.deleteMany({ where: { companyId: company } });
    await prisma.account.deleteMany({ where: { companyId: company } });
    await prisma.salesInvoice.deleteMany({ where: { companyId: company } });
    await prisma.purchaseInvoice.deleteMany({ where: { companyId: company } });
    await prisma.customer.deleteMany({ where: { companyId: company } });
    await prisma.supplier.deleteMany({ where: { companyId: company } });
    await prisma.branch.deleteMany({ where: { companyId: company } });
    await prisma.company.deleteMany({ where: { id: company } });
  }

  const sortKey = (a: any, b: any) => (a.partyId < b.partyId ? -1 : 1);

  const cases: Array<[string, Record<string, unknown>]> = [
    ['as of the seeded date', { asOf: '2026-10-18' }],
    ['one branch', { asOf: '2026-10-18', branchId: br2 }],
    ['an earlier as-of date', { asOf: '2026-09-01' }],
    ['one party', { asOf: '2026-10-18', party: 0 }],
  ];

  it.each(['receivables', 'payables'] as const)('%s: every party row, totals and buckets match, over all pages', async (method) => {
    for (const [, params] of cases) {
      const { party, ...rest } = params as any;
      const filter = party === undefined ? {} : method === 'receivables'
        ? { customerId: pid(party) } : { supplierId: pid(party).replace('a0', 'a1') };
      const legacy: any = await (service as any)[method](company, { ...rest, ...filter });
      const pages: any[] = [];
      for (let page = 1; page <= 10; page += 1) {
        const paged: any = await (service as any)[method](company, { ...rest, ...filter, pageSize: 2, page });
        pages.push(paged);
        if (page >= paged.paging.totalPages) break;
      }
      const rows = pages.flatMap((p) => p.rows);
      const stripped = legacy.rows.map(({ invoices, ...r }: any) => r);
      expect([...rows].sort(sortKey)).toEqual([...stripped].sort(sortKey));
      // Global totals, buckets and reconciliation cover every row, not just the page.
      for (const p of pages) {
        expect(p.totals).toEqual(legacy.totals);
        expect(p.paging.totalParties).toBe(legacy.rows.length);
        expect(p.asOf).toBe(legacy.asOf);
      }
      // Deterministic order: total descending, then party id.
      const totals = rows.map((r: any) => Number(r.total));
      expect(totals).toEqual([...totals].sort((a, b) => b - a));
      const ties = rows.filter((r: any, i: number) => i > 0 && r.total === rows[i - 1].total);
      for (const r of ties) expect(rows[rows.indexOf(r) - 1].partyId < r.partyId).toBe(true);
    }
  });

  it.each(['receivables', 'payables'] as const)('%s: a party invoice page equals the legacy invoices', async (method) => {
    const legacy: any = await (service as any)[method](company, { asOf: '2026-10-18' });
    for (const row of legacy.rows) {
      const first: any = await (service as any)[method](company, {
        asOf: '2026-10-18', pageSize: 1, detailPartyId: row.partyId, invoicePageSize: 3, invoicePage: 1,
      });
      expect(first.invoices.total).toBe(row.invoices.length);
      const pastEnd:any = await (service as any)[method](company, {asOf:'2026-10-18',pageSize:1,detailPartyId:row.partyId,invoicePageSize:3,invoicePage:1000});
      expect(pastEnd.invoices.total).toBe(row.invoices.length);expect(pastEnd.invoices.rows).toEqual([]);
      const got: any[] = [];
      for (let page = 1; got.length < row.invoices.length; page += 1) {
        const p: any = await (service as any)[method](company, {
          asOf: '2026-10-18', pageSize: 1, detailPartyId: row.partyId, invoicePageSize: 3, invoicePage: page,
        });
        got.push(...p.invoices.rows);
      }
      const byNumber = (a: any, b: any) => (a.invoiceNumber < b.invoiceNumber ? -1 : 1);
      expect([...got].sort(byNumber)).toEqual([...row.invoices].sort(byNumber));
    }
  });

  it('reconciles against a non-zero ledger, with the branch filter applied to the ledger too', async () => {
    const expectations: Array<['receivables' | 'payables', Record<string, unknown>, string]> = [
      ['receivables', { asOf: '2026-10-18' }, '630.0000'],
      ['receivables', { asOf: '2026-10-18', branchId: br2 }, '50.0000'],
      ['receivables', { asOf: '2026-09-01' }, '0.0000'],
      ['payables', { asOf: '2026-10-18' }, '-300.0000'],
      ['payables', { asOf: '2026-10-18', branchId: br2 }, '100.0000'],
    ];
    for (const [method, params, ledger] of expectations) {
      const legacy: any = await (service as any)[method](company, params);
      const paged: any = await (service as any)[method](company, { ...params, pageSize: 3 });
      expect(legacy.totals.ledgerBalance).toBe(ledger);
      expect(paged.totals).toEqual(legacy.totals);
      expect(paged.totals.differenceFromLedger).not.toBe('0.0000');
    }
  });
});
