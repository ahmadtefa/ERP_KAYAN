import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { StockLedgerService } from './stock-ledger.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const W1 = '44444444-4444-4444-8444-444444444441';
const W2 = '44444444-4444-4444-8444-444444444442';
const ITEM = '55555555-5555-4555-8555-555555555551';
const ITEM2 = '55555555-5555-4555-8555-555555555552';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// More stock-book checks on a real migrated PostgreSQL: fractions, rounding drift,
/// long movement runs, items kept apart. Per-item and per-shelf, never a shared figure.
/// Synthetic data only.
(vmReady ? describe : describe.skip)('stock ledger invariants, second set (real schema)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  const ledger = new StockLedgerService();
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const tx = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>): Promise<T> => prisma.$transaction(fn);
  const at = (warehouseId: string | null, itemId = ITEM) => ({ companyId: COMPANY, branchId: BRANCH, warehouseId, itemId });
  const shelf = async (warehouseId: string, itemId = ITEM) => {
    const p = await tx((t) => ledger.position(t, at(warehouseId, itemId)));
    return { q: p.quantity.toString(), v: p.value.toString() };
  };
  const issue = (warehouseId: string, qty: string, itemId = ITEM) =>
    tx(async (t) => {
      const priced = await ledger.issueValue(t, at(warehouseId, itemId), qty);
      return ledger.post(t, { ...at(warehouseId, itemId), quantity: new Prisma.Decimal(qty).negated(), value: priced.value.negated() });
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO warehouses(id,"companyId","branchId",code,"nameEn","nameAr","isDefault","isActive","updatedAt") VALUES
      ('${W1}','${COMPANY}','${BRANCH}','W1','Main','رئيسي',true,true,now()),
      ('${W2}','${COMPANY}','${BRANCH}','W2','Second','ثانٍ',false,true,now())`);
    await run(`INSERT INTO items(id,"companyId",code,"nameEn","nameAr",unit,"isStockTracked","salePrice","updatedAt") VALUES
      ('${ITEM}','${COMPANY}','I1','Item one','صنف أول','piece',true,10,now()),
      ('${ITEM2}','${COMPANY}','I2','Item two','صنف ثان','piece',true,10,now())`);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('01 fractional quantities keep the value to the cent, and the shelf average is value divided by quantity', async () => {
    await tx((t) => ledger.receive(t, at(W1), '2.5', '12.5'));
    const p = await shelf(W1);
    expect(p).toEqual({ q: '2.5', v: '12.5' });
    const priced = await tx((t) => ledger.issueValue(t, at(W1), '1.5'));
    expect(Number(priced.value.toString())).toBeCloseTo(7.5, 4);
  });

  it('02 issuing in thirds empties the shelf to exactly zero value, with no rounding leftover', async () => {
    await tx((t) => ledger.receive(t, at(W1, ITEM2), '3', '10'));
    for (let i = 0; i < 3; i++) await issue(W1, '1', ITEM2);
    expect(await shelf(W1, ITEM2)).toEqual({ q: '0', v: '0' });
  });

  it('03 two items on the same shelf never mix quantity or value', async () => {
    await tx((t) => ledger.receive(t, at(W2), '7', '70'));
    await tx((t) => ledger.receive(t, at(W2, ITEM2), '2', '30'));
    expect(await shelf(W2)).toEqual({ q: '7', v: '70' });
    expect(await shelf(W2, ITEM2)).toEqual({ q: '2', v: '30' });
  });

  it('04 a long mixed run of receipts and issues ends with branch and shelves in agreement', async () => {
    for (let i = 1; i <= 15; i++) {
      await tx((t) => ledger.receive(t, at(i % 2 ? W1 : W2), String(i), String(i * 11)));
      if (i % 3 === 0) await issue(i % 2 ? W2 : W1, '1').catch(() => undefined);
    }
    const r = await tx((t) => ledger.reconcile(t, at(null)));
    expect(r.difference.toString()).toBe('0');
    expect(r.valueDifference.toString()).toBe('0');
  });

  it('05 a refused issue leaves the shelf and the branch exactly as they were', async () => {
    const shelfBefore = await shelf(W2);
    const branchBefore = await tx((t) => ledger.position(t, at(null)));
    await expect(issue(W2, '100000')).rejects.toBeDefined();
    expect(await shelf(W2)).toEqual(shelfBefore);
    const branchAfter = await tx((t) => ledger.position(t, at(null)));
    expect(branchAfter.quantity.toString()).toBe(branchBefore.quantity.toString());
    expect(branchAfter.value.toString()).toBe(branchBefore.value.toString());
  });

  it('06 an empty shelf never carries value, and no value is negative', async () => {
    const bad = await prisma.$queryRawUnsafe(`SELECT 1 FROM warehouse_stock_balances WHERE (quantity = 0 AND value <> 0) OR value < 0 UNION ALL SELECT 1 FROM stock_balances WHERE (quantity = 0 AND value <> 0) OR value < 0`);
    expect(bad).toEqual([]);
  });

  it('07 every shelf row belongs to a warehouse and an item of the same company', async () => {
    const bad = await prisma.$queryRawUnsafe(`SELECT s."warehouseId" FROM warehouse_stock_balances s LEFT JOIN warehouses w ON w.id = s."warehouseId" LEFT JOIN items i ON i.id = s."itemId" WHERE w."companyId" IS DISTINCT FROM i."companyId"`);
    expect(bad).toEqual([]);
  });

  it('08 many simultaneous issues from one shelf never take more than it holds', async () => {
    await tx((t) => ledger.receive(t, at(W1, ITEM), '8', '80'));
    const before = Number((await shelf(W1)).q);
    const settled = await Promise.allSettled(Array.from({ length: 12 }, () => issue(W1, '1')));
    const ok = settled.filter((s) => s.status === 'fulfilled').length;
    expect(ok).toBeLessThanOrEqual(before);
    expect(Number((await shelf(W1)).q)).toBe(before - ok);
    const r = await tx((t) => ledger.reconcile(t, at(null)));
    expect(r.difference.toString()).toBe('0');
  });
});
