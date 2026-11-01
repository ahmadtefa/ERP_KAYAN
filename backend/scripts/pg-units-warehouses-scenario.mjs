/**
 * The scenario the owner asked for, against a REAL PostgreSQL database.
 *
 *   عبوة is the base unit, كرتونة = 12, باكت = 6.
 *   Receive 10 cartons into the front store  -> 120 عبوات, back store 0
 *   Transfer 3 cartons to the back store     -> front 84 / back 36
 *   The branch total stays 120, and the movement log reads "3 كراتين = 36 عبوات".
 *   Then: reverse the transfer, and prove the numbers come back.
 *
 * Everything below is recomputed independently with raw SQL from
 * `stock_movements`; the service's own answer is never trusted on its own. The
 * item is created through the production ItemsService with the packing table
 * the item screen sends, so the unit rows are written by the real code path.
 *
 * It also pins the two rules that protect history:
 *   - the base unit of an item with stock recorded against it cannot be
 *     renamed (Arabic refusal), while a new packing unit can still be added;
 *   - a posted transfer is reversed, never edited or deleted, and cannot be
 *     reversed twice.
 *
 * Run it on a machine with PostgreSQL and a migrated database:
 *
 *   DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/kayan_test \
 *     node scripts/pg-units-warehouses-scenario.mjs
 *
 * It needs `npm run build` first: it imports the compiled services, so it
 * exercises exactly what ships.
 *
 * CI runs it in the backend job, right after the migrations are applied to the
 * ephemeral PostgreSQL - so it is executed on every push, not kept as a file
 * nobody runs. A committed scenario that has never run is a claim, not a test.
 */
import { randomUUID } from 'node:crypto';

import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BadRequestException } from '@nestjs/common';

import { AuditService } from '../dist/src/common/audit/audit.service.js';
import { CompanySettingsService } from '../dist/src/common/settings/company-settings.module.js';
import { WarehouseService } from '../dist/src/common/warehouse/warehouse.service.js';
import { AccountMapService } from '../dist/src/modules/accounting/account-map.service.js';
import { CostCentersService } from '../dist/src/modules/accounting/cost-centers.service.js';
import { DocumentNumberService } from '../dist/src/modules/accounting/document-number.service.js';
import { FiscalPeriodsService } from '../dist/src/modules/accounting/fiscal-periods.service.js';
import { PostingService } from '../dist/src/modules/accounting/posting.service.js';
import { ItemsService } from '../dist/src/modules/inventory/items.service.js';
import { StockDocumentsService } from '../dist/src/modules/inventory/stock-documents.service.js';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error('DATABASE_URL is required');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const dec = (value) => new Prisma.Decimal(value);

function makeClient(applicationName) {
  const url = new URL(DB_URL);
  url.searchParams.set('application_name', applicationName);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
}

async function main() {
  const prisma = makeClient('scenario-units-warehouses');

  // Its own company, always. The scenario runs in CI after the seeded tenant
  // and after the HTTP scenarios, and a check that quietly wrote its stores
  // and movements into the company those tests sign in to would be measuring
  // them instead of itself. A tagged code keeps it unique on a database that
  // already holds one.
  const tag = randomUUID().slice(0, 6);
  const company = await prisma.company.create({
    data: {
      id: randomUUID(),
      code: `CUWS-${tag}`,
      nameEn: 'Units and warehouses scenario',
      nameAr: 'سيناريو الوحدات والمخازن',
    },
  });
  const companyId = company.id;
  console.log(`Created throwaway company ${company.code}`);

  const user = await prisma.user.create({
    data: {
      companyId,
      username: `units-scenario-${tag}`,
      fullNameEn: 'Units scenario',
      fullNameAr: 'سيناريو الوحدات',
      // Never a real credential.
      passwordHash: 'scenario-placeholder-not-a-real-credential',
    },
  });
  const userId = user.id;

  const branch = await prisma.branch.create({
    data: {
      companyId,
      code: `UB-${tag}`,
      nameEn: `Units branch ${tag}`,
      nameAr: `فرع الوحدات ${tag}`,
      kind: 'HEADQUARTERS',
    },
  });
  const front = await prisma.warehouse.create({
    data: {
      companyId,
      branchId: branch.id,
      code: `UB-FRONT-${tag}`,
      nameEn: 'Front store',
      nameAr: 'المخزن الأمامي',
      isDefault: true,
    },
  });
  const back = await prisma.warehouse.create({
    data: {
      companyId,
      branchId: branch.id,
      code: `UB-BACK-${tag}`,
      nameEn: 'Back store',
      nameAr: 'المخزن الخلفي',
    },
  });

  // The real service graph, no stubs.
  const audit = new AuditService(prisma);
  const accounts = new AccountMapService();
  const numbers = new DocumentNumberService();
  const periods = new FiscalPeriodsService(prisma, audit);
  const costCenters = new CostCentersService(prisma, audit);
  const posting = new PostingService(numbers, periods, costCenters);
  const settings = new CompanySettingsService(prisma, audit);
  const warehouses = new WarehouseService(prisma, audit);
  const items = new ItemsService(prisma, audit, accounts, posting, warehouses);
  const stock = new StockDocumentsService(
    prisma,
    numbers,
    posting,
    accounts,
    audit,
    settings,
    warehouses,
    costCenters,
  );

  /**
   * A positive adjustment posts to the stock account and to the inventory-
   * difference account, so both must exist. They are created here only if the
   * chart of accounts does not carry them already - a real company's chart is
   * left alone.
   */
  async function ensureAccount(code, type, nameEn, nameAr) {
    const existing = await prisma.account.findFirst({ where: { companyId, code } });
    if (existing) return existing;
    return prisma.account.create({
      data: { companyId, code, type, nameEn, nameAr, isPostable: true, isActive: true },
    });
  }
  await ensureAccount('1104', 'ASSET', 'Inventory', 'المخزون');
  await ensureAccount('5107', 'EXPENSE', 'Inventory difference', 'فروق المخزون');

  /** Independent per-warehouse balance, the same formula the reports use. */
  const card = async (warehouseId, itemId) => {
    const rows = await prisma.$queryRaw`
      select coalesce(sum(case when direction = 'IN' then quantity else -quantity end), 0)::text as q
        from stock_movements
       where "companyId" = ${companyId}::uuid
         and "warehouseId" = ${warehouseId}::uuid
         and "itemId" = ${itemId}::uuid`;
    return Number(rows[0].q);
  };

  // ================================================= S0  the item and its units
  console.log('\n[S0] an item created with its packing table in one request');
  const item = await items.create(
    companyId,
    userId,
    {
      code: `WATER-${tag}`,
      nameEn: 'Water bottle',
      nameAr: 'مياه',
      unit: 'عبوة',
      salePrice: '5',
      units: [
        { unit: 'عبوة', factor: '1', salePrice: '5' },
        { unit: 'كرتونة', factor: '12', salePrice: '55' },
        { unit: 'باكت', factor: '6', salePrice: '28' },
      ],
    },
    branch.id,
  );
  const unitRows = await prisma.itemUnit.findMany({
    where: { itemId: item.id },
    orderBy: { factor: 'asc' },
  });
  check('S0 three unit rows written with the item', unitRows.length === 3, `${unitRows.length}`);
  check(
    'S0 exactly one factor-1 row and it is the base unit',
    unitRows.filter((row) => Number(row.factor) === 1).length === 1 &&
      unitRows.find((row) => Number(row.factor) === 1)?.unit === 'عبوة',
  );
  check(
    'S0 the factors are absolute to the base unit, never chained',
    unitRows.some((row) => row.unit === 'كرتونة' && Number(row.factor) === 12) &&
      unitRows.some((row) => row.unit === 'باكت' && Number(row.factor) === 6),
  );

  // ================================================= S1  receive 10 cartons
  console.log('\n[S1] receive 10 cartons into the front store');
  const receipt = await stock.create(companyId, branch.id, userId, {
    kind: 'ADJUSTMENT',
    documentDate: '2051-06-01',
    reason: 'goods received',
    // A positive adjustment in the received unit: the same move() path a
    // purchase invoice uses, so the snapshot it writes is the real one.
    lines: [{ itemId: item.id, quantity: 10, unitName: 'كرتونة', unitCost: '4.5' }],
    toWarehouseId: front.id,
  });
  await stock.post(companyId, userId, receipt.id);

  const frontAfterReceipt = await card(front.id, item.id);
  const backAfterReceipt = await card(back.id, item.id);
  check('S1 front store holds 120 base bottles', frontAfterReceipt === 120, `${frontAfterReceipt}`);
  check('S1 back store still empty', backAfterReceipt === 0, `${backAfterReceipt}`);

  const receiptMovement = await prisma.stockMovement.findFirst({
    where: { companyId, referenceId: receipt.id, itemId: item.id },
  });
  check(
    'S1 the movement kept what was entered: 10 كرتونة × 12 = 120',
    receiptMovement &&
      receiptMovement.enteredUnit === 'كرتونة' &&
      Number(receiptMovement.enteredQuantity) === 10 &&
      Number(receiptMovement.unitFactor) === 12 &&
      Number(receiptMovement.quantity) === 120,
    receiptMovement
      ? `${receiptMovement.enteredQuantity} ${receiptMovement.enteredUnit} × ${receiptMovement.unitFactor} = ${receiptMovement.quantity}`
      : 'no movement',
  );

  // ================================================= S2  transfer 3 cartons
  console.log('\n[S2] transfer 3 cartons from the front store to the back store');
  const transfer = await stock.create(companyId, branch.id, userId, {
    kind: 'TRANSFER',
    documentDate: '2051-06-02',
    notes: 'internal move',
    fromWarehouseId: front.id,
    toWarehouseId: back.id,
    lines: [{ itemId: item.id, quantity: 3, unitName: 'كرتونة', unitCost: '4.5' }],
  });
  await stock.post(companyId, userId, transfer.id);

  const frontAfterTransfer = await card(front.id, item.id);
  const backAfterTransfer = await card(back.id, item.id);
  check('S2 front store 84', frontAfterTransfer === 84, `${frontAfterTransfer}`);
  check('S2 back store 36', backAfterTransfer === 36, `${backAfterTransfer}`);
  check(
    'S2 the branch total is conserved at 120',
    frontAfterTransfer + backAfterTransfer === 120,
    `${frontAfterTransfer} + ${backAfterTransfer}`,
  );

  const transferMoves = await prisma.stockMovement.findMany({
    where: { companyId, referenceId: transfer.id },
  });
  check('S2 one OUT and one IN movement', transferMoves.length === 2, `${transferMoves.length}`);
  check(
    'S2 the log reads 3 كراتين = 36 عبوات on both legs',
    transferMoves.every(
      (move) =>
        move.enteredUnit === 'كرتونة' &&
        Number(move.enteredQuantity) === 3 &&
        Number(move.unitFactor) === 12 &&
        Number(move.quantity) === 36,
    ),
    transferMoves
      .map((m) => `${m.direction}: ${m.enteredQuantity} ${m.enteredUnit} × ${m.unitFactor} = ${m.quantity}`)
      .join(' | '),
  );

  // ================================================= S3  the warehouse report
  console.log('\n[S3] the per-warehouse balance report sums back to the branch');
  // The report is as-of a date, and this scenario dated its documents in 2051
  // so a closed period in the real company could never block them. Asking for
  // today's report would therefore be asking about a day before the movements
  // existed and honestly answer "nothing": the date is named here so the check
  // is about the warehouses, not about the calendar.
  const report = await warehouses.balanceReport(
    companyId,
    { itemId: item.id, includeZero: true, asOf: '2051-12-31' },
    [branch.id],
    true,
  );
  const reportRow = (warehouseId) => report.rows.find((row) => row.warehouseId === warehouseId);
  check(
    'S3 the report shows 84 in the front store and 36 in the back store',
    Number(reportRow(front.id)?.quantity) === 84 && Number(reportRow(back.id)?.quantity) === 36,
    `${reportRow(front.id)?.quantity} / ${reportRow(back.id)?.quantity}`,
  );
  check(
    'S3 the item total equals the sum of its warehouses (120)',
    Number(report.itemTotals.find((row) => row.itemId === item.id)?.quantity) === 120,
    `${report.itemTotals.find((row) => row.itemId === item.id)?.quantity}`,
  );
  check(
    'S3 the packing breakdown is rendered in the item units',
    reportRow(front.id)?.breakdown?.text === '7 كرتونة' &&
      reportRow(back.id)?.breakdown?.text === '3 كرتونة',
    `${reportRow(front.id)?.breakdown?.text} / ${reportRow(back.id)?.breakdown?.text}`,
  );

  // ================================================= S4  history is protected
  console.log('\n[S4] the base unit cannot be renamed under recorded stock');
  let renameError = null;
  try {
    await items.update(companyId, userId, item.id, { unit: 'علبة' }, true, true);
  } catch (error) {
    renameError = error;
  }
  check(
    'S4 renaming the base unit is refused with a 400 and an Arabic reason',
    renameError instanceof BadRequestException &&
      /لا يمكن تغيير وحدة الأساس/.test(renameError.message),
    renameError ? renameError.message.slice(0, 60) : 'no error',
  );
  const afterRefusal = await prisma.item.findUnique({ where: { id: item.id } });
  check('S4 the stored base unit is untouched', afterRefusal.unit === 'عبوة', afterRefusal.unit);

  // Adding a packing unit is still allowed - the goods are the same goods.
  const extended = await items.update(
    companyId,
    userId,
    item.id,
    {
      units: [
        { unit: 'عبوة', factor: '1' },
        { unit: 'كرتونة', factor: '12' },
        { unit: 'باكت', factor: '6' },
        { unit: 'شيكارة', factor: '24' },
      ],
    },
    true,
    true,
  );
  const afterExtend = await prisma.itemUnit.findMany({ where: { itemId: item.id, isActive: true } });
  check('S4 a new packing unit was accepted alongside the history', afterExtend.length === 4, `${afterExtend.length}`);
  check('S4 the saved base unit survived the unit-table save', extended.unit === 'عبوة', extended.unit);

  // ================================================= S5  reverse, not edit
  console.log('\n[S5] a posted transfer is reversed, and only once');
  await stock.reverse(companyId, userId, transfer.id);
  const frontAfterReverse = await card(front.id, item.id);
  const backAfterReverse = await card(back.id, item.id);
  check('S5 reversal brings the stores back to 120 / 0', frontAfterReverse === 120 && backAfterReverse === 0,
    `${frontAfterReverse} / ${backAfterReverse}`);

  const reversedDoc = await prisma.stockDocument.findUnique({ where: { id: transfer.id } });
  check('S5 the original document is still there, marked reversed', reversedDoc.status === 'REVERSED',
    reversedDoc.status);

  const reversalMoves = await prisma.stockMovement.findMany({
    where: { companyId, referenceType: 'STOCK_DOCUMENT_REVERSAL', referenceId: transfer.id },
  });
  check('S5 the counter-movement links back to the original document', reversalMoves.length === 2,
    `${reversalMoves.length}`);

  let secondReverse = null;
  try {
    await stock.reverse(companyId, userId, transfer.id);
  } catch (error) {
    secondReverse = error;
  }
  check('S5 a second reversal is refused', secondReverse instanceof BadRequestException,
    secondReverse ? secondReverse.message : 'no error');

  // ================================================= S6  after a restart
  console.log('\n[S6] the numbers survive a new connection (an application restart)');
  const fresh = makeClient('scenario-units-warehouses-restart');
  const storedUnits = await fresh.itemUnit.findMany({ where: { itemId: item.id } });
  const storedItem = await fresh.item.findUnique({ where: { id: item.id } });
  const movements = await fresh.stockMovement.count({ where: { companyId, itemId: item.id } });
  await fresh.$disconnect();
  check('S6 units, factors and the base unit are still there', storedUnits.length === 4 && storedItem.unit === 'عبوة',
    `${storedUnits.length} units, base ${storedItem.unit}`);
  check('S6 the movement log is still there', movements >= 5, `${movements} movements`);

  // ================================================= S7  the fraction rule
  console.log('\n[S7] a unit that cannot be split refuses half of itself');
  const bakery = await items.create(
    companyId,
    userId,
    {
      code: `BREAD-${tag}`,
      nameEn: 'Bread pack',
      nameAr: 'خبز',
      unit: 'عبوة',
      units: [
        { unit: 'عبوة', factor: '1' },
        { unit: 'باكت', factor: '6', allowFraction: false },
      ],
    },
    branch.id,
  );
  const bakeryUnits = await prisma.itemUnit.findMany({ where: { itemId: bakery.id } });
  check('S7 باكت = 6 base packs, fractions off',
    bakeryUnits.some((row) => row.unit === 'باكت' && Number(row.factor) === 6 && row.allowFraction === false));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log(`Failures: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Scenario aborted:', error);
  process.exitCode = 1;
});
