import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { SerialsService } from './serials.service';


const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const AR = 'a0000000-0000-4000-8000-0000000000a1';
const AP = 'a0000000-0000-4000-8000-0000000000a2';
const GL = 'b0000000-0000-4000-8000-a00000000011';
const BANK = 'b0000000-0000-4000-8000-b00000000011';
const BANK_OFF = 'b0000000-0000-4000-8000-b00000000012';
const CUST = 'c0000000-0000-4000-8000-000000000001';
const SUPP = 'e0000000-0000-4000-8000-000000000001';
const INV = 'd0000000-0000-4000-8000-000000000001';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Serial numbers and warranty against a real migrated PostgreSQL.
(vmReady ? describe : describe.skip)('serial numbers (real schema)', () => {
  let prisma: any;
  let svc: SerialsService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const query = (sql: string) => prisma.$queryRawUnsafe(sql) as Promise<Array<Record<string, any>>>;
  const ITEM = 'f0000000-0000-4000-8000-000000000001';
  const ITEM2 = 'f0000000-0000-4000-8000-000000000002';
  const WH = 'f0000000-0000-4000-8000-0000000000a1';
  const INV1 = 'd0000000-0000-4000-8000-000000000011';
  const INV_DRAFT = 'd0000000-0000-4000-8000-000000000012';
  const INV_LINE = 'd0000000-0000-4000-8000-0000000000e1';
  const ID_ = (n: number) => `d0000000-0000-4000-8000-0000000000${n}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','chq','Chq','ش','x',now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${CUST}','${COMPANY}','C','Customer','عميل',now())`);
    await run(`INSERT INTO warehouses(id,"companyId","branchId",code,"nameEn","nameAr","updatedAt") VALUES ('${WH}','${COMPANY}','${BRANCH}','W1','Main','الرئيسي',now())`);
    await run(`INSERT INTO items(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${ITEM}','${COMPANY}','LAP','Laptop','لابتوب',now()), ('${ITEM2}','${COMPANY}','MOU','Mouse','ماوس',now())`);
    await run(`INSERT INTO sales_invoices(id,"companyId","branchId","invoiceNumber","invoiceDate","customerId","updatedAt",status,"documentType","subTotal","taxAmount","totalAmount","paidAmount")
               VALUES ('${INV1}','${COMPANY}','${BRANCH}','SI-1','2026-01-31','${CUST}',now(),'POSTED','INVOICE',3000,0,3000,0),
                      ('${INV_DRAFT}','${COMPANY}','${BRANCH}','SI-2','2026-02-01','${CUST}',now(),'DRAFT','INVOICE',100,0,100,0)`);
    await run(`INSERT INTO sales_invoice_lines(id,"invoiceId","lineNumber","itemId",description,quantity,"unitPrice","lineTotal")
               VALUES ('${INV_LINE}','${INV1}',1,'${ITEM}','Laptop',3,1000,3000)`);
    const audit: never = { record: async () => {}, recordRequired: async () => {} } as never;
    svc = new SerialsService(prisma as never, audit);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('registers a list with a warranty and refuses a repeat as a whole', async () => {
    const r = await svc.register(COMPANY, USER, { itemId: ITEM, warehouseId: WH, serials: 'LAP-1\nLAP-2, LAP-3;LAP-4', warrantyMonths: '12' });
    expect(r.registered).toBe(4);
    await expect(svc.register(COMPANY, USER, { itemId: ITEM, serials: 'LAP-9, lap-2' })).rejects.toMatchObject({ response: { code: 'SERIAL_DUPLICATE' } });
    const missed = await svc.list(COMPANY, { q: 'LAP-9' });
    expect(missed.items).toHaveLength(0); // nothing from the refused list was saved
    expect((await svc.list(COMPANY, { itemId: ITEM })).totals.count).toBe(4);
  });

  it('the same serial can exist for a different item, not for the same one', async () => {
    await svc.register(COMPANY, USER, { itemId: ITEM2, serials: 'LAP-1' });
    const found: any = await svc.lookup(COMPANY, 'lap-1');
    expect(found.items).toHaveLength(2);
  });

  it('refuses bad input with the field named', async () => {
    await expect(svc.register(COMPANY, USER, { serials: 'A' })).rejects.toMatchObject({ response: { field: 'itemId' } });
    await expect(svc.register(COMPANY, USER, { itemId: ITEM, serials: '' })).rejects.toMatchObject({ response: { field: 'serials' } });
    await expect(svc.register(COMPANY, USER, { itemId: ITEM, serials: 'A B' })).rejects.toMatchObject({ response: { field: 'serials' } });
    await expect(svc.register(COMPANY, USER, { itemId: ITEM, serials: 'X1', warrantyMonths: '300' })).rejects.toMatchObject({ response: { field: 'warrantyMonths' } });
    await expect(svc.register(COMPANY, USER, { itemId: ITEM, serials: 'X1', warehouseId: '99999999-9999-4999-8999-999999999999' })).rejects.toMatchObject({ response: { field: 'warehouseId' } });
    await expect(svc.register(COMPANY, USER, { itemId: '99999999-9999-4999-8999-999999999999', serials: 'X1' })).rejects.toMatchObject({ response: { field: 'itemId' } });
  });

  it('selling starts the warranty from the invoice date, clamped to the end of a short month', async () => {
    const r = await svc.sell(COMPANY, USER, { salesInvoiceId: INV1, itemId: ITEM, serials: 'LAP-1, LAP-2', warrantyMonths: '1' });
    expect(r).toMatchObject({ sold: 2, invoiceNumber: 'SI-1', soldOn: '2026-01-31' });
    const f: any = await svc.lookup(COMPANY, 'LAP-1');
    const lap = f.items.find((i: any) => i.itemCode === 'LAP');
    expect(lap).toMatchObject({ status: 'SOLD', soldOn: '2026-01-31', warrantyEndsOn: '2026-02-28', invoiceNumber: 'SI-1', customerEn: 'Customer' });
    expect(lap.events.map((e: any) => e.action)).toEqual(['register', 'sell']);
  });

  it('uses the warranty recorded at registration unless one is given at the sale', async () => {
    await svc.sell(COMPANY, USER, { salesInvoiceId: INV1, itemId: ITEM, serials: 'LAP-3' });
    const f: any = await svc.lookup(COMPANY, 'LAP-3');
    expect(f.items.find((i: any) => i.itemCode === 'LAP')).toMatchObject({ warrantyMonths: 12, warrantyEndsOn: '2027-01-31' });
  });

  it('cannot assign more serials than the invoice sold, or one already sold, or one not registered', async () => {
    await expect(svc.sell(COMPANY, USER, { salesInvoiceId: INV1, itemId: ITEM, serials: 'LAP-4' })).rejects.toMatchObject({ response: { code: 'SERIAL_TOO_MANY' } });
    await expect(svc.sell(COMPANY, USER, { salesInvoiceId: INV1, itemId: ITEM, serials: 'NOPE-1' })).rejects.toMatchObject({ response: { code: 'SERIAL_NOT_FOUND' } });
    await expect(svc.sell(COMPANY, USER, { salesInvoiceId: INV_DRAFT, itemId: ITEM, serials: 'LAP-4' })).rejects.toMatchObject({ response: { field: 'salesInvoiceId' } });
    await expect(svc.sell(COMPANY, USER, { salesInvoiceId: INV1, itemId: ITEM2, serials: 'LAP-1' })).rejects.toMatchObject({ response: { field: 'itemId' } });
    await expect(svc.sell(COMPANY, USER, { itemId: ITEM, serials: 'LAP-4' })).rejects.toMatchObject({ response: { field: 'salesInvoiceId' } });
    const [{ n }] = await query(`SELECT count(*)::int AS n FROM serial_units WHERE status = 'SOLD' AND "itemId" = '${ITEM}'`);
    expect(n).toBe(3);
  });

  it('a sold unit is refused a second sale; two people taking the last slot on an invoice book one', async () => {
    await svc.register(COMPANY, USER, { itemId: ITEM, serials: 'RACE-1, RACE-2' });
    const inv = ID_(21);
    await run(`INSERT INTO sales_invoices(id,"companyId","branchId","invoiceNumber","invoiceDate","customerId","updatedAt",status,"documentType","subTotal","taxAmount","totalAmount","paidAmount")
               VALUES ('${inv}','${COMPANY}','${BRANCH}','SI-3','2026-03-01','${CUST}',now(),'POSTED','INVOICE',1000,0,1000,0)`);
    await run(`INSERT INTO sales_invoice_lines(id,"invoiceId","lineNumber","itemId",description,quantity,"unitPrice","lineTotal") VALUES ('${ID_(22)}','${inv}',1,'${ITEM}','Laptop',1,1000,1000)`);
    const results = await Promise.allSettled([
      svc.sell(COMPANY, USER, { salesInvoiceId: inv, itemId: ITEM, serials: 'RACE-1' }),
      svc.sell(COMPANY, USER, { salesInvoiceId: inv, itemId: ITEM, serials: 'RACE-2' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const [{ n }] = await query(`SELECT count(*)::int AS n FROM serial_units WHERE "salesInvoiceId" = '${inv}' AND status = 'SOLD'`);
    expect(n).toBe(1);
  });

  it('a return clears the sale and the unit can be sold again with a new warranty', async () => {
    const [u] = await query(`SELECT id FROM serial_units WHERE "serialNumber" = 'LAP-2' AND "itemId" = '${ITEM}'`);
    await expect(svc.act(COMPANY, USER, u.id, 'return', {})).rejects.toMatchObject({ response: { field: 'note' } });
    const back: any = await svc.act(COMPANY, USER, u.id, 'return', { note: 'faulty screen' });
    expect(back).toMatchObject({ status: 'RETURNED', soldOn: null, warrantyEndsOn: null, invoiceNumber: null, warranty: 'NOT_SOLD' });
    await expect(svc.act(COMPANY, USER, u.id, 'return', { note: 'again' })).rejects.toMatchObject({ response: { code: 'SERIAL_STATE' } });
    await svc.sell(COMPANY, USER, { salesInvoiceId: INV1, itemId: ITEM, serials: 'LAP-2', warrantyMonths: '6' });
    const f: any = await svc.lookup(COMPANY, 'LAP-2');
    const lap = f.items.find((i: any) => i.itemCode === 'LAP');
    expect(lap.status).toBe('SOLD');
    expect(lap.warrantyEndsOn).toBe('2026-07-31');
    expect(lap.events.map((e: any) => e.action)).toEqual(['register', 'sell', 'return', 'sell']);
  });

  it('scrapping needs a reason and only works on a unit that is not sold', async () => {
    const [sold] = await query(`SELECT id FROM serial_units WHERE "serialNumber" = 'LAP-3' AND "itemId" = '${ITEM}'`);
    await expect(svc.act(COMPANY, USER, sold.id, 'scrap', { note: 'broken' })).rejects.toMatchObject({ response: { code: 'SERIAL_STATE' } });
    const [shelf] = await query(`SELECT id FROM serial_units WHERE "serialNumber" = 'LAP-4' AND "itemId" = '${ITEM}'`);
    const gone: any = await svc.act(COMPANY, USER, shelf.id, 'scrap', { note: 'dropped' });
    expect(gone.status).toBe('SCRAPPED');
    await expect(svc.sell(COMPANY, USER, { salesInvoiceId: INV1, itemId: ITEM, serials: 'LAP-4' })).rejects.toBeDefined();
    await expect(svc.act(COMPANY, USER, '99999999-9999-4999-8999-999999999999', 'scrap', { note: 'x' })).rejects.toBeDefined();
  });

  it('the list filters by status, item, text and warranty ending soon', async () => {
    const sold: any = await svc.list(COMPANY, { status: 'SOLD' });
    expect(sold.items.every((i: any) => i.status === 'SOLD')).toBe(true);
    const text: any = await svc.list(COMPANY, { q: 'race' });
    expect(text.items.length).toBeGreaterThan(0);
    const none: any = await svc.list(COMPANY, { q: '%' });
    expect(none.items).toHaveLength(0); // a percent sign is text, not a wildcard
    await expect(svc.list(COMPANY, { status: 'nope' })).rejects.toMatchObject({ response: { field: 'status' } });
    await expect(svc.list(COMPANY, { warrantyEndingInDays: '-1' })).rejects.toMatchObject({ response: { field: 'warrantyEndingInDays' } });
    await expect(svc.lookup(COMPANY, 'does-not-exist')).rejects.toMatchObject({ response: { code: 'SERIAL_NOT_FOUND' } });
  });

  it('the unassigned report lists sold lines of tracked items that lack serial numbers', async () => {
    const r: any = await svc.unassigned(COMPANY, {});
    const inv3 = r.items.find((i: any) => i.invoiceNumber === 'SI-3');
    expect(inv3).toBeUndefined(); // its one laptop was assigned
    await run(`INSERT INTO sales_invoices(id,"companyId","branchId","invoiceNumber","invoiceDate","customerId","updatedAt",status,"documentType","subTotal","taxAmount","totalAmount","paidAmount")
               VALUES ('${ID_(31)}','${COMPANY}','${BRANCH}','SI-4','2026-04-01','${CUST}',now(),'POSTED','INVOICE',2000,0,2000,0)`);
    await run(`INSERT INTO sales_invoice_lines(id,"invoiceId","lineNumber","itemId",description,quantity,"unitPrice","lineTotal") VALUES ('${ID_(32)}','${ID_(31)}',1,'${ITEM}','Laptop',2,1000,2000)`);
    const after: any = await svc.unassigned(COMPANY, { from: '2026-04-01', to: '2026-04-30' });
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ invoiceNumber: 'SI-4', sold: 2, assigned: 0, missing: 2 });
    expect(after.totals).toEqual({ lines: 1, missing: 2 });
    const si1 = r.items.find((i: any) => i.invoiceNumber === 'SI-1');
    expect(si1).toBeUndefined(); // all three laptops on SI-1 have serial numbers
    await expect(svc.unassigned(COMPANY, { from: 'x' })).rejects.toMatchObject({ response: { field: 'from' } });
  });
});
