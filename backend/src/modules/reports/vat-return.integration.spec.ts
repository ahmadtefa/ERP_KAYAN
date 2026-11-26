import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { VatReturnService } from './vat-return.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const BRANCH2 = '22222222-2222-4222-8222-222222222223';
const CUST = 'c0000000-0000-4000-8000-000000000001';
const SUPP = 'e0000000-0000-4000-8000-000000000001';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// The VAT return SQL against a real migrated PostgreSQL.
(vmReady ? describe : describe.skip)('VAT return (real schema)', () => {
  let prisma: any;
  let svc: VatReturnService;
  let n = 0;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const uid = () => `f0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  // one invoice with one line: base, rate -> tax = base * rate / 100
  async function doc(side: 'sales' | 'purchase', date: string, type: string, status: string, base: number, rate: number, opts: { branch?: string; deleted?: boolean } = {}) {
    const id = uid();
    const tax = (base * rate) / 100;
    const party = side === 'sales' ? `"customerId"` : `"supplierId"`;
    const table = side === 'sales' ? 'sales_invoices' : 'purchase_invoices';
    await run(
      `INSERT INTO ${table}(id,"companyId","branchId","invoiceNumber","invoiceDate",${party},"updatedAt",status,"documentType","subTotal","taxAmount","totalAmount","deletedAt")
       VALUES ('${id}','${COMPANY}','${opts.branch ?? BRANCH}','V-${n}','${date}','${side === 'sales' ? CUST : SUPP}',now(),'${status}','${type}',${base},${tax},${base + tax},${opts.deleted ? 'now()' : 'NULL'})`,
    );
    await run(
      `INSERT INTO ${side === 'sales' ? 'sales_invoice_lines' : 'purchase_invoice_lines'}(id,"invoiceId","lineNumber",description,quantity,"unitPrice","taxRate","taxAmount","lineTotal")
       VALUES ('${uid()}','${id}',1,'x',1,${base},${rate},${tax},${base})`,
    );
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now()),('${BRANCH2}','${COMPANY}','B','B','ب',now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${CUST}','${COMPANY}','C','C','ع',now())`);
    await run(`INSERT INTO suppliers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${SUPP}','${COMPANY}','S','S','م',now())`);
    svc = new VatReturnService(prisma as never);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('counts posted documents in the period only, credit notes subtract, input is separate', async () => {
    await doc('sales', '2026-03-05', 'INVOICE', 'POSTED', 1000, 14);
    await doc('sales', '2026-03-31', 'INVOICE', 'POSTED', 200, 14); // last day is inside
    await doc('sales', '2026-03-10', 'CREDIT_NOTE', 'POSTED', 100, 14);
    await doc('sales', '2026-03-10', 'INVOICE', 'POSTED', 500, 0);
    await doc('sales', '2026-02-28', 'INVOICE', 'POSTED', 9999, 14); // before
    await doc('sales', '2026-04-01', 'INVOICE', 'POSTED', 9999, 14); // after
    await doc('sales', '2026-03-12', 'INVOICE', 'DRAFT', 9999, 14);
    await doc('sales', '2026-03-12', 'INVOICE', 'REVERSED', 9999, 14);
    await doc('sales', '2026-03-12', 'INVOICE', 'POSTED', 9999, 14, { deleted: true });
    await doc('purchase', '2026-03-08', 'INVOICE', 'POSTED', 600, 14);
    await doc('purchase', '2026-03-09', 'CREDIT_NOTE', 'POSTED', 100, 14);
    await doc('purchase', '2026-03-09', 'INVOICE', 'DRAFT', 9999, 14);

    const r = await svc.report(COMPANY, { from: '2026-03-01', to: '2026-03-31' });
    // output: 14%: 1000+200-100 = 1100 base, 154 tax; 0%: 500 base
    expect(r.output.rates).toEqual([
      { rate: '0.00', taxableBase: '500.0000', tax: '0.0000', documents: 1 },
      { rate: '14.00', taxableBase: '1100.0000', tax: '154.0000', documents: 3 },
    ]);
    expect(r.output.tax).toBe('154.0000');
    // input: 600 - 100 = 500 base, 70 tax
    expect(r.input.rates).toEqual([{ rate: '14.00', taxableBase: '500.0000', tax: '70.0000', documents: 2 }]);
    expect(r.net).toBe('84.0000');
    expect(r.position).toBe('PAYABLE');
  });

  it('a branch filter narrows both sides', async () => {
    await doc('sales', '2026-05-05', 'INVOICE', 'POSTED', 100, 14, { branch: BRANCH2 });
    await doc('purchase', '2026-05-05', 'INVOICE', 'POSTED', 300, 14, { branch: BRANCH2 });
    const b2 = await svc.report(COMPANY, { from: '2026-05-01', to: '2026-05-31', branchId: BRANCH2 });
    expect(b2.net).toBe('-28.0000');
    expect(b2.position).toBe('REFUNDABLE');
    const b1 = await svc.report(COMPANY, { from: '2026-05-01', to: '2026-05-31', branchId: BRANCH });
    expect(b1.position).toBe('NIL');
    expect(b1.output.rates).toEqual([]);
  });

  it('another company never appears', async () => {
    const other = await svc.report('99999999-9999-4999-8999-999999999999', { from: '2026-01-01', to: '2026-12-31' });
    expect(other.net).toBe('0.0000');
  });
});
