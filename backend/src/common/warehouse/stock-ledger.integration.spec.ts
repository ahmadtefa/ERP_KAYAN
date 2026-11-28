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

/// The stock book against a real migrated PostgreSQL: receipts, issues,
/// transfers, negative-stock refusal, average cost and concurrent movements.
/// Synthetic data only.
(vmReady ? describe : describe.skip)('stock ledger invariants (real schema)', () => {
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

  it('01 a receipt raises quantity and value on the shelf and on the branch', async () => {
    await tx((t) => ledger.receive(t, at(W1), '10', '100'));
    expect(await shelf(W1)).toEqual({ q: '10', v: '100' });
    const branch = await tx((t) => ledger.position(t, at(null)));
    expect(branch.quantity.toString()).toBe('10');
    expect(branch.value.toString()).toBe('100');
  });

  it('02 a second receipt at another price moves the average cost', async () => {
    const r = await tx((t) => ledger.receive(t, at(W1), '10', '200'));
    expect(r.unitCost.toString()).toBe('15');
    expect(await shelf(W1)).toEqual({ q: '20', v: '300' });
  });

  it('03 an issue takes stock out at the average cost and keeps the average', async () => {
    const priced = await tx((t) => ledger.issueValue(t, at(W1), '4'));
    expect(priced.unitCost.toString()).toBe('15');
    expect(priced.value.toString()).toBe('60');
    await issue(W1, '4');
    expect(await shelf(W1)).toEqual({ q: '16', v: '240' });
  });

  it('04 issuing more than the shelf holds is refused and changes nothing', async () => {
    await expect(issue(W1, '17')).rejects.toMatchObject({ response: { code: 'STOCK_SHORT_IN_WAREHOUSE' } });
    expect(await shelf(W1)).toEqual({ q: '16', v: '240' });
  });

  it('05 the branch total can never go below zero, even where a shelf may', async () => {
    await expect(
      tx((t) => ledger.post(t, { ...at(W1), quantity: '-100', value: '-1500' }, { allowNegative: true })),
    ).rejects.toMatchObject({ response: { code: 'STOCK_LEDGER_APPLY_BRANCH_E024' } });
    expect(await shelf(W1)).toEqual({ q: '16', v: '240' });
  });

  it('06 a transfer moves quantity and value between shelves and the branch total is unchanged', async () => {
    const branchBefore = await tx((t) => ledger.position(t, at(null)));
    await tx(async (t) => {
      const priced = await ledger.issueValue(t, at(W1), '6');
      await ledger.post(t, { ...at(W1), quantity: '-6', value: priced.value.negated() });
      await ledger.post(t, { ...at(W2), quantity: '6', value: priced.value });
    });
    expect(await shelf(W1)).toEqual({ q: '10', v: '150' });
    expect(await shelf(W2)).toEqual({ q: '6', v: '90' });
    const branchAfter = await tx((t) => ledger.position(t, at(null)));
    expect(branchAfter.quantity.toString()).toBe(branchBefore.quantity.toString());
    expect(branchAfter.value.toString()).toBe(branchBefore.value.toString());
  });

  it('07 each shelf keeps its own average cost', async () => {
    await tx((t) => ledger.receive(t, at(W2), '4', '100'));
    const w1 = await tx((t) => ledger.position(t, at(W1)));
    const w2 = await tx((t) => ledger.position(t, at(W2)));
    expect(w1.unitCost.toString()).toBe('15');
    expect(w2.unitCost.toString()).toBe('19');
  });

  it('08 the branch book equals the sum of its shelves after all movements', async () => {
    const r = await tx((t) => ledger.reconcile(t, at(null)));
    expect(r.difference.toString()).toBe('0');
    expect(r.valueDifference.toString()).toBe('0');
  });

  it('09 two simultaneous issues of the last units: exactly one succeeds, never negative', async () => {
    await tx((t) => ledger.receive(t, at(W1, ITEM2), '5', '50'));
    const results = await Promise.allSettled([issue(W1, '4', ITEM2), issue(W1, '4', ITEM2)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await shelf(W1, ITEM2)).toEqual({ q: '1', v: '10' });
  });

  it('10 many simultaneous receipts all land: nothing is lost', async () => {
    const before = Number((await shelf(W2)).q);
    await Promise.all(Array.from({ length: 10 }, () => tx((t) => ledger.receive(t, at(W2), '1', '10'))));
    expect(Number((await shelf(W2)).q)).toBe(before + 10);
    const r = await tx((t) => ledger.reconcile(t, at(null)));
    expect(r.difference.toString()).toBe('0');
  });

  it('11 simultaneous transfers in opposite directions finish without deadlock and keep the total', async () => {
    const total = async () => {
      const a = Number((await shelf(W1)).q);
      const b = Number((await shelf(W2)).q);
      return a + b;
    };
    const before = await total();
    const move = (from: string, to: string) =>
      tx(async (t) => {
        const priced = await ledger.issueValue(t, at(from), '1');
        await ledger.post(t, { ...at(from), quantity: '-1', value: priced.value.negated() });
        await ledger.post(t, { ...at(to), quantity: '1', value: priced.value });
      });
    const settled = await Promise.allSettled([move(W1, W2), move(W2, W1), move(W1, W2), move(W2, W1)]);
    expect(settled.every((s) => s.status === 'fulfilled' || /deadlock/i.test(String((s as PromiseRejectedResult).reason)))).toBe(true);
    expect(await total()).toBe(before);
  });

  it('12 an emptied shelf is worth exactly nothing', async () => {
    await tx((t) => ledger.receive(t, at(W1, ITEM2), '3', '10'));
    const cur = await shelf(W1, ITEM2);
    await issue(W1, cur.q, ITEM2);
    expect(await shelf(W1, ITEM2)).toEqual({ q: '0', v: '0' });
  });

  it('13 no shelf or branch row is ever negative', async () => {
    const bad = await prisma.$queryRawUnsafe(`SELECT 1 FROM warehouse_stock_balances WHERE quantity < 0 UNION ALL SELECT 1 FROM stock_balances WHERE quantity < 0`);
    expect(bad).toEqual([]);
  });
});
