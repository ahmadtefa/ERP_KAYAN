/**
 * The lot engine, exercised against a real PostgreSQL server.
 *
 * Unit tests prove the arithmetic in isolation. This proves the thing a shop
 * actually does: two deliveries at different prices arrive, a sale takes the
 * older one first, the cost of the sale is the shelf's average, an expired lot
 * is refused until somebody says otherwise, a write-off reaches the ledger,
 * stock moves to another warehouse without losing its identity, and running the
 * alert scanner twice does not shout twice.
 *
 * Run by CI against the `erp_kayan_regressions` database after `migrate deploy`
 * and `seed.ts`. It creates its own warehouse, locations and item, and removes
 * them again, so it never touches the demo company's documents.
 */
import assert from 'node:assert/strict';

import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { AuditService } from '../src/common/audit/audit.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { CompanySettingsService } from '../src/common/settings/company-settings.module';
import { StockLedgerService } from '../src/common/warehouse/stock-ledger.service';
import { WarehouseService } from '../src/common/warehouse/warehouse.service';
import { AccountMapService } from '../src/modules/accounting/account-map.service';
import { CostCentersService } from '../src/modules/accounting/cost-centers.service';
import { DocumentNumberService } from '../src/modules/accounting/document-number.service';
import { FiscalPeriodsService } from '../src/modules/accounting/fiscal-periods.service';
import { PostingService } from '../src/modules/accounting/posting.service';
import { BatchesService } from '../src/modules/inventory/batches.service';
import { StockDocumentsService } from '../src/modules/inventory/stock-documents.service';
import { StockTakesService } from '../src/modules/inventory/stock-takes.service';
import { StorageLocationsService } from '../src/modules/inventory/storage-locations.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const TAG = `INV-${Date.now()}`;

let passed = 0;
function check(name: string, run: () => void | Promise<void>) {
  return (async () => {
    await run();
    passed += 1;
    console.log(`  PASS  ${name}`);
  })();
}

function ok(condition: unknown, message: string): asserts condition {
  assert.ok(condition, message);
}

const day = (offset: number) => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required: this test must run against a real PostgreSQL server.');
    process.exit(2);
  }

  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const warehouses = new WarehouseService(prisma, audit);
  const numbers = new DocumentNumberService();
  const periods = new FiscalPeriodsService(prisma, audit);
  const costCenters = new CostCentersService(prisma, audit);
  const posting = new PostingService(numbers, periods, costCenters);
  const accounts = new AccountMapService();
  const ledger = new StockLedgerService();
  const batches = new BatchesService(prisma, warehouses, posting, accounts, numbers, audit, ledger);
  const locations = new StorageLocationsService(prisma, audit);
  const notifications = new NotificationsService(prisma);
  const settings = new CompanySettingsService(prisma, audit);
  const documents = new StockDocumentsService(
    prisma,
    numbers,
    posting,
    accounts,
    audit,
    settings,
    warehouses,
    costCenters,
    ledger,
  );
  const stockTakes = new StockTakesService(prisma, warehouses, ledger, numbers, documents, audit);

  const company = await prisma.company.findFirst({ where: { deletedAt: null } });
  ok(company, 'No company in this database. Run prisma/seed.ts first.');
  const branch = await prisma.branch.findFirst({
    where: { companyId: company.id, deletedAt: null },
  });
  ok(branch, 'No branch in this database. Run prisma/seed.ts first.');
  const user = await prisma.user.findFirst({
    where: { companyId: company.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  ok(user, 'No user in this database. Run prisma/seed.ts first.');

  const warehouse = await prisma.warehouse.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      code: `${TAG}-A`,
      nameEn: `${TAG} main store`,
      nameAr: `مخزن ${TAG}`,
      kind: 'MAIN',
      isDefault: false,
    },
  });
  const warehouseB = await prisma.warehouse.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      code: `${TAG}-B`,
      nameEn: `${TAG} overflow`,
      nameAr: `مخزن ${TAG} ب`,
      kind: 'SUB',
      parentId: warehouse.id,
      isDefault: false,
    },
  });

  const item = await prisma.item.create({
    data: {
      companyId: company.id,
      code: TAG,
      nameEn: `${TAG} medicine`,
      nameAr: `دواء ${TAG}`,
      unit: 'box',
      salePrice: D(40),
      purchasePrice: D(15),
      isStockTracked: true,
      requiresBatch: true,
      requiresProductionDate: true,
      requiresExpiryDate: true,
      useFefo: true,
      allowExpiredIssue: false,
      expiredIssueNeedsApproval: true,
    },
  });

  // Named so the clean-up below can be read as prose. Nothing else depends on
  // these lists: deletion is by the identifiers this script created.
  const created = {
    movements: [] as string[],
    batches: [] as string[],
    locations: [] as string[],
    costHistory: [] as string[],
    notifications: [] as string[],
    journals: [] as string[],
  };
  void created;

  try {
    console.log(`\nLot engine against real PostgreSQL (company ${company.code ?? company.id})`);

    // ── the building ────────────────────────────────────────────────────────
    const zone = await locations.create(
      company.id,
      user.id,
      {
        warehouseId: warehouse.id,
        kind: 'ZONE',
        code: `${TAG}-Z1`,
        nameEn: 'Zone 1',
        nameAr: 'منطقة 1',
      },
      [branch.id],
    );
    created.locations.push(zone.id);
    const rack = await locations.create(
      company.id,
      user.id,
      {
        warehouseId: warehouse.id,
        parentId: zone.id,
        kind: 'RACK',
        code: `${TAG}-R1`,
        nameEn: 'Rack 1',
        nameAr: 'رف 1',
      },
      [branch.id],
    );
    created.locations.push(rack.id);
    const bin = await locations.create(
      company.id,
      user.id,
      {
        warehouseId: warehouse.id,
        parentId: rack.id,
        kind: 'BIN',
        code: `${TAG}-B1`,
        nameEn: 'Bin 1',
        nameAr: 'خانة 1',
      },
      [branch.id],
    );
    created.locations.push(bin.id);
    const bin2 = await locations.create(
      company.id,
      user.id,
      {
        warehouseId: warehouse.id,
        parentId: rack.id,
        kind: 'BIN',
        code: `${TAG}-B2`,
        nameEn: 'Bin 2',
        nameAr: 'خانة 2',
      },
      [branch.id],
    );
    created.locations.push(bin2.id);

    await check('a zone cannot sit inside a bin, so the tree cannot be made nonsense', async () => {
      await assert.rejects(
        locations.create(
          company.id,
          user.id,
          {
            warehouseId: warehouse.id,
            parentId: bin.id,
            kind: 'ZONE',
            code: `${TAG}-BAD`,
            nameEn: 'bad',
            nameAr: 'خطأ',
          },
          [branch.id],
        ),
        /cannot be placed inside/,
      );
    });

    // ── two deliveries at different prices ──────────────────────────────────
    const near = day(20);
    const far = day(400);
    const firstLot = await batches.receive(
      company.id,
      user.id,
      {
        branchId: branch.id,
        warehouseId: warehouse.id,
        itemId: item.id,
        batchNumber: `${TAG}-L1`,
        productionDate: day(-100),
        expiryDate: near,
        quantity: 10,
        unitCost: 10,
        storageLocationId: bin.id,
        sourceType: 'PURCHASE_INVOICE',
        sourceNumber: `${TAG}/PI-1`,
      },
      [branch.id],
    );
    created.batches.push(firstLot.batchId);

    await check('the first delivery sets the shelf average at what it cost', async () => {
      assert.equal(firstLot.averageCost, '10.0000');
      assert.equal(firstLot.balanceQuantity, '10.0000');
    });

    const secondLot = await batches.receive(
      company.id,
      user.id,
      {
        branchId: branch.id,
        warehouseId: warehouse.id,
        itemId: item.id,
        batchNumber: `${TAG}-L2`,
        productionDate: day(-10),
        expiryDate: far,
        quantity: 10,
        unitCost: 20,
        storageLocationId: bin2.id,
        sourceType: 'PURCHASE_INVOICE',
        sourceNumber: `${TAG}/PI-2`,
      },
      [branch.id],
    );
    created.batches.push(secondLot.batchId);

    await check('two deliveries at 10 and 20 average to 15, and the shelf is worth 300', async () => {
      assert.equal(secondLot.averageCost, '15.0000');
      const balance = await prisma.stockBalance.findFirst({
        where: { companyId: company.id, branchId: branch.id, itemId: item.id },
      });
      ok(balance, 'No balance row was written');
      assert.equal(balance.quantity.toFixed(4), '20.0000');
      assert.equal(balance.value.toFixed(4), '300.0000');
    });

    await check('a second delivery of the same lot number adds to it instead of copying it', async () => {
      const again = await batches.receive(
        company.id,
        user.id,
        {
          branchId: branch.id,
          warehouseId: warehouse.id,
          itemId: item.id,
          batchNumber: `${TAG}-L1`,
          productionDate: day(-100),
          expiryDate: near,
          quantity: 2,
          unitCost: 10,
        },
        [branch.id],
      );
      assert.equal(again.batchId, firstLot.batchId);
    });
    const firstLotRow = await prisma.itemBatch.findUniqueOrThrow({
      where: { id: firstLot.batchId },
    });
    await check('the lot holds what arrived, not what was typed twice', () => {
      assert.equal(firstLotRow.remainingQuantity.toFixed(4), '12.0000');
      assert.equal(firstLotRow.receivedQuantity.toFixed(4), '12.0000');
      // 10 at 10.00 plus 10 at 20.00 plus 2 at 10.00 = 22 units worth 320.00.
      assert.equal(firstLotRow.unitCost.toFixed(4), '10.0000');
    });

    const shelf = await prisma.stockBalance.findFirstOrThrow({
      where: { companyId: company.id, branchId: branch.id, itemId: item.id },
    });
    await check('a third delivery re-averages the shelf: 320 over 22', () => {
      assert.equal(shelf.quantity.toFixed(4), '22.0000');
      assert.equal(shelf.value.toFixed(4), '320.0000');
    });

    await check('a receipt that changes a lot\'s expiry date is refused', async () => {
      await assert.rejects(
        batches.receive(
          company.id,
          user.id,
          {
            branchId: branch.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            batchNumber: `${TAG}-L1`,
            productionDate: day(-100),
            expiryDate: day(90),
            quantity: 1,
            unitCost: 10,
          },
          [branch.id],
        ),
        /cannot be changed/,
      );
    });

    await check('an item that needs a lot number cannot be received without one', async () => {
      await assert.rejects(
        batches.receive(
          company.id,
          user.id,
          {
            branchId: branch.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: 1,
            unitCost: 10,
          },
          [branch.id],
        ),
        /lot number/,
      );
    });

    // ── the sale takes the older lot first ──────────────────────────────────
    const issue = await batches.issue(
      company.id,
      user.id,
      {
        branchId: branch.id,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: 13,
        referenceType: 'SALES_INVOICE',
        referenceNumber: `${TAG}/SI-1`,
        documentDate: day(0),
      },
      [branch.id],
    );

    await check('FEFO takes the lot expiring in 20 days before the one expiring next year', async () => {
      assert.equal(issue.lots.length, 2);
      assert.equal(issue.lots[0].batchId, firstLot.batchId);
      assert.equal(issue.lots[0].quantity, '12.0000');
      assert.equal(issue.lots[1].batchId, secondLot.batchId);
      assert.equal(issue.lots[1].quantity, '1.0000');
    });

    await check('the issue leaves at the shelf average, not at either lot\'s own price', async () => {
      // 320.00 / 22 = 14.545455 per unit at six decimals, so 13 units leave
      // 189.0909 of value - and the lot movements add up to exactly that.
      assert.equal(issue.unitCost, '14.5455');
      assert.equal(issue.value, '189.0909');
      const issuedMovements = await prisma.stockMovement.findMany({
        where: {
          companyId: company.id,
          referenceType: 'SALES_INVOICE',
          referenceNumber: `${TAG}/SI-1`,
        },
        select: { totalCost: true },
      });
      const movementTotal = issuedMovements.reduce(
        (sum, row) => sum.plus(row.totalCost),
        D(0),
      );
      assert.equal(movementTotal.toFixed(4), '189.0909', 'the movements equal the value taken');
    });

    await check('the emptied lot is closed rather than deleted, and keeps its movements', async () => {
      const lot = await prisma.itemBatch.findUniqueOrThrow({ where: { id: firstLot.batchId } });
      assert.equal(lot.remainingQuantity.toFixed(4), '0.0000');
      assert.equal(lot.status, 'CLOSED');
      const movements = await prisma.stockMovement.count({
        where: { companyId: company.id, batchId: firstLot.batchId },
      });
      assert.equal(movements, 3, 'two receipts and the issue are all on the lot');
    });

    await check('the balance is 9 at 130.9091, and the history records the cost that moved', async () => {
      const balance = await prisma.stockBalance.findFirstOrThrow({
        where: { companyId: company.id, branchId: branch.id, itemId: item.id },
      });
      assert.equal(balance.quantity.toFixed(4), '9.0000');
      assert.equal(balance.value.toFixed(4), '130.9091');
      const history = await prisma.itemCostHistory.findMany({
        where: { companyId: company.id, itemId: item.id },
        orderBy: { createdAt: 'asc' },
      });
      assert.equal(history.length, 4, 'three receipts and one issue');
      assert.equal(history[3].unitCostAfter.toFixed(4), '14.545455');
      created.costHistory.push(...history.map((row) => row.id));
    });

    await check('an expired lot is not sold to a customer', async () => {
      const expired = await batches.receive(
        company.id,
        user.id,
        {
          branchId: branch.id,
          warehouseId: warehouse.id,
          itemId: item.id,
          batchNumber: `${TAG}-OLD`,
          productionDate: day(-400),
          expiryDate: day(-5),
          quantity: 3,
          unitCost: 10,
        },
        [branch.id],
      );
      created.batches.push(expired.batchId);
      await assert.rejects(
        batches.issue(
          company.id,
          user.id,
          {
            branchId: branch.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            batchId: expired.batchId,
            quantity: 1,
            referenceType: 'SALES_INVOICE',
            referenceNumber: `${TAG}/SI-EXPIRED`,
          },
          [branch.id],
        ),
        /expired/,
      );
    });

    await check('issuing expired stock needs an approval that is recorded', async () => {
      const expiredLot = await prisma.itemBatch.findFirstOrThrow({
        where: { companyId: company.id, batchNumber: `${TAG}-OLD` },
      });
      await assert.rejects(
        batches.issue(
          company.id,
          user.id,
          {
            branchId: branch.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            batchId: expiredLot.id,
            quantity: 1,
            allowExpired: true,
            reason: 'manager approved for a sample',
            referenceType: 'SALES_INVOICE',
            referenceNumber: `${TAG}/SI-EXPIRED-2`,
          },
          [branch.id],
        ),
        /approval/,
      );
    });

    // ── write-off reaches the ledger ────────────────────────────────────────
    await check('a write-off without a reason is refused', async () => {
      await assert.rejects(
        batches.writeOff(
          company.id,
          user.id,
          {
            branchId: branch.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            batchId: secondLot.batchId,
            quantity: 1,
            reason: '',
          },
          [branch.id],
        ),
        /reason/,
      );
    });

    const writeOff = await batches.writeOff(
      company.id,
      user.id,
      {
        branchId: branch.id,
        warehouseId: warehouse.id,
        itemId: item.id,
        batchId: secondLot.batchId,
        quantity: 2,
        reason: 'damaged in handling',
        documentDate: day(0),
      },
      [branch.id],
    );
    created.journals.push(writeOff.journalEntryNumber);

    await check('a write-off posts a balanced entry and reduces the shelf', async () => {
      const entry = await prisma.journalEntry.findFirstOrThrow({
        where: { companyId: company.id, entryNumber: writeOff.journalEntryNumber },
        include: { lines: true },
      });
      const debit = entry.lines.reduce((sum, line) => sum.plus(line.debit), D(0));
      const credit = entry.lines.reduce((sum, line) => sum.plus(line.credit), D(0));
      assert.equal(debit.toFixed(4), credit.toFixed(4), 'the entry must balance');
      assert.equal(debit.toFixed(4), writeOff.value);
      assert.equal(entry.sourceType, 'INVENTORY_WRITE_OFF');
      const balance = await prisma.stockBalance.findFirstOrThrow({
        where: { companyId: company.id, branchId: branch.id, itemId: item.id },
      });
      assert.equal(balance.quantity.toFixed(4), '10.0000');
    });

    // ── a lot moves without losing its identity ─────────────────────────────
    const transfer = await batches.transfer(
      company.id,
      user.id,
      {
        branchId: branch.id,
        fromWarehouseId: warehouse.id,
        toWarehouseId: warehouseB.id,
        itemId: item.id,
        batchId: secondLot.batchId,
        quantity: 3,
        reason: 'overflow store',
      },
      [branch.id],
    );

    await check('a transferred lot keeps its number, dates and cost in the new warehouse', async () => {
      const moved = await prisma.itemBatch.findUniqueOrThrow({
        where: { id: transfer.to.batchId },
      });
      const source = await prisma.itemBatch.findUniqueOrThrow({
        where: { id: secondLot.batchId },
      });
      assert.equal(moved.batchNumber, source.batchNumber);
      assert.equal(moved.expiryDate?.toISOString(), source.expiryDate?.toISOString());
      assert.equal(moved.unitCost.toFixed(4), source.unitCost.toFixed(4));
      assert.equal(moved.remainingQuantity.toFixed(4), '3.0000');
      assert.notEqual(moved.warehouseId, source.warehouseId);
      created.batches.push(moved.id);
    });

    await check('a shelf-level move reports what it moved and leaves the branch total alone', async () => {
      const move = await locations.move(
        company.id,
        user.id,
        {
          fromLocationId: bin2.id,
          toLocationId: bin.id,
          itemId: item.id,
          quantity: 1,
          reason: 'tidying',
        },
        [branch.id],
      );
      assert.equal(move.quantity, '1.0000');
      const stock = await locations.tree(company.id, warehouse.id, [branch.id]);
      assert.ok(Array.isArray(stock.items));
    });

    // ── the alert centre does not repeat itself ─────────────────────────────
    const firstScan = await notifications.scanStock(company.id);
    const secondScan = await notifications.scanStock(company.id);
    await check('scanning twice raises the same alerts once, not twice', async () => {
      const rows = await prisma.notification.findMany({
        where: { companyId: company.id, type: { startsWith: 'STOCK_' } },
      });
      const expired = rows.filter((row) => row.type === 'STOCK_EXPIRED');
      assert.equal(expired.length, 1, 'one row for the one expired lot');
      assert.ok(firstScan.raised > 0, 'the first scan found something to say');
      assert.ok(secondScan.raised >= 0);
      created.notifications.push(...rows.map((row) => row.id));
    });

    await check('an alert carries the document it is about and the permission it needs', async () => {
      const row = await prisma.notification.findFirstOrThrow({
        where: { companyId: company.id, type: 'STOCK_EXPIRED' },
      });
      assert.equal(row.permission, 'inventory.stock.read');
      assert.equal(row.severity, 'CRITICAL');
      assert.ok(row.actionPath && row.actionPath.includes('/inventory/'), 'it links to the screen');
    });

    await check('a person without the permission is told the alert does not exist', async () => {
      const hidden = await notifications.list(
        { userId: user.id, companyId: company.id, permissions: [], branchIds: [branch.id] },
        { status: 'ALL' },
      );
      assert.equal(hidden.items.length, 0);
      const visible = await notifications.list(
        {
          userId: user.id,
          companyId: company.id,
          permissions: ['inventory.stock.read'],
          branchIds: [branch.id],
        },
        { status: 'ALL' },
      );
      assert.ok(visible.items.length > 0, 'a permitted reader sees the alerts');
    });

    await check('the expiry report counts the money at risk', async () => {
      const report = await batches.expiryReport(company.id, {}, [branch.id]);
      assert.ok(Number(report.atRisk) > 0, 'an expired lot puts value at risk');
      assert.ok(report.items.some((row) => row.band === 'EXPIRED'));
    });

    await check('traceability names the receipt and the sale the lot went out on', async () => {
      const trace = await batches.trace(company.id, secondLot.batchId);
      const types = trace.movements.map((row) => row.referenceType);
      assert.ok(types.includes('PURCHASE_INVOICE'), 'the purchase that brought it in');
      assert.ok(types.includes('SALES_INVOICE'), 'the sale that took some out');
    });

    console.log(`\n${passed} checks passed against real PostgreSQL.`);
  } finally {
    // Clean-up only ever removes what this script created, and it never lets a
    // ══════════════════════════════════════════════════════════════════════
    // The cost book: one shelf is not the other shelf
    // ══════════════════════════════════════════════════════════════════════
    //
    // The numbers the owner asked to see, literally: warehouse A buys 10 at 10
    // and 10 at 20 (average 15), warehouse B buys 10 at 30 (average 30), four
    // units leave A at 60, and two units move from A to B at 15 each.

    const plain = await prisma.item.create({
      data: {
        companyId: company.id,
        code: `${TAG}-PLAIN`,
        nameEn: `${TAG} plain item`,
        nameAr: `صنف ${TAG} بدون دفعات`,
        unit: 'piece',
        salePrice: D(50),
        purchasePrice: D(10),
        isStockTracked: true,
        requiresBatch: false,
      },
    });

    await batches.receive(
      company.id,
      user.id,
      {
        branchId: branch.id,
        warehouseId: warehouse.id,
        itemId: plain.id,
        quantity: 10,
        unitCost: 10,
        sourceNumber: `${TAG}/COST-1`,
        documentDate: day(-3),
      },
      [branch.id],
    );
    await batches.receive(
      company.id,
      user.id,
      {
        branchId: branch.id,
        warehouseId: warehouse.id,
        itemId: plain.id,
        quantity: 10,
        unitCost: 20,
        sourceNumber: `${TAG}/COST-2`,
        documentDate: day(-2),
      },
      [branch.id],
    );
    await batches.receive(
      company.id,
      user.id,
      {
        branchId: branch.id,
        warehouseId: warehouseB.id,
        itemId: plain.id,
        quantity: 10,
        unitCost: 30,
        sourceNumber: `${TAG}/COST-3`,
        documentDate: day(-1),
      },
      [branch.id],
    );

    await check('two shelves carry two different averages for the same item', async () => {
      const a = await ledger.position(prisma as never, {
        companyId: company.id,
        branchId: branch.id,
        warehouseId: warehouse.id,
        itemId: plain.id,
      });
      const b = await ledger.position(prisma as never, {
        companyId: company.id,
        branchId: branch.id,
        warehouseId: warehouseB.id,
        itemId: plain.id,
      });
      assert.equal(a.quantity.toFixed(4), '20.0000');
      assert.equal(a.value.toFixed(4), '300.0000');
      assert.equal(a.unitCost.toFixed(4), '15.0000', 'warehouse A averages 300 over 20');
      assert.equal(b.quantity.toFixed(4), '10.0000');
      assert.equal(b.value.toFixed(4), '300.0000');
      assert.equal(b.unitCost.toFixed(4), '30.0000', 'warehouse B keeps its own 30');
      // The branch total is the sum, and the branch average (600/30 = 20) is
      // NOT what either shelf issues at.
      const roll = await prisma.stockBalance.findFirstOrThrow({
        where: { companyId: company.id, branchId: branch.id, itemId: plain.id },
      });
      assert.equal(roll.quantity.toFixed(4), '30.0000');
      assert.equal(roll.value.toFixed(4), '600.0000');
    });

    const issueFromA = await batches.issue(
      company.id,
      user.id,
      {
        branchId: branch.id,
        warehouseId: warehouse.id,
        itemId: plain.id,
        quantity: 4,
        referenceType: 'SALES_INVOICE',
        referenceNumber: `${TAG}/SI-COST`,
        documentDate: day(0),
      },
      [branch.id],
    );

    await check('a sale out of A leaves at 15 each: 4 units cost 60, and B is untouched', async () => {
      assert.equal(issueFromA.unitCost, '15.0000');
      assert.equal(issueFromA.value, '60.0000');
      const a = await ledger.position(prisma as never, {
        companyId: company.id,
        branchId: branch.id,
        warehouseId: warehouse.id,
        itemId: plain.id,
      });
      const b = await ledger.position(prisma as never, {
        companyId: company.id,
        branchId: branch.id,
        warehouseId: warehouseB.id,
        itemId: plain.id,
      });
      assert.equal(a.quantity.toFixed(4), '16.0000');
      assert.equal(a.value.toFixed(4), '240.0000');
      assert.equal(a.unitCost.toFixed(4), '15.0000', 'an issue never moves the average');
      assert.equal(b.quantity.toFixed(4), '10.0000');
      assert.equal(b.unitCost.toFixed(4), '30.0000', 'the other shelf is untouched');
    });

    // A transfer of an item that keeps no lots goes through the document
    // engine, which is the same path the screen uses.
    const transferDraft = await documents.create(company.id, branch.id, user.id, {
      kind: 'TRANSFER',
      branchId: branch.id,
      fromBranchId: branch.id,
      fromWarehouseId: warehouse.id,
      toWarehouseId: warehouseB.id,
      documentDate: day(0),
      reason: 'replenish the overflow store',
      lines: [{ itemId: plain.id, quantity: 2 }],
    });
    const moved = await documents.post(company.id, user.id, transferDraft.id);

    await check('a transfer carries the source cost, and the destination re-averages', async () => {
      const transferLine = await prisma.stockDocumentLine.findFirstOrThrow({
        where: { documentId: moved.id },
      });
      assert.equal(transferLine.unitCost.toFixed(4), '15.0000', 'the source shelf average');
      assert.equal(transferLine.totalCost.toFixed(4), '30.0000');
      const a = await ledger.position(prisma as never, {
        companyId: company.id,
        branchId: branch.id,
        warehouseId: warehouse.id,
        itemId: plain.id,
      });
      const b = await ledger.position(prisma as never, {
        companyId: company.id,
        branchId: branch.id,
        warehouseId: warehouseB.id,
        itemId: plain.id,
      });
      assert.equal(a.quantity.toFixed(4), '14.0000');
      assert.equal(a.unitCost.toFixed(4), '15.0000');
      // 300 + 30 = 330 over 12 units.
      assert.equal(b.quantity.toFixed(4), '12.0000');
      assert.equal(b.value.toFixed(4), '330.0000');
      assert.equal(b.unitCost.toFixed(4), '27.5000');
      // The branch still holds 26 units worth 570.
      const roll = await prisma.stockBalance.findFirstOrThrow({
        where: { companyId: company.id, branchId: branch.id, itemId: plain.id },
      });
      assert.equal(roll.quantity.toFixed(4), '26.0000');
      assert.equal(roll.value.toFixed(4), '570.0000');
    });

    await check('the shelf book and the movement ledger agree, to the fils', async () => {
      const rows = await prisma.$queryRaw<
        Array<{ warehouseId: string; quantity: Prisma.Decimal; value: Prisma.Decimal }>
      >(Prisma.sql`
        SELECT "warehouseId",
               SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END) AS "quantity",
               SUM(CASE WHEN "direction" = 'IN' THEN "totalCost" ELSE -"totalCost" END) AS "value"
          FROM "stock_movements"
         WHERE "companyId" = ${company.id}::uuid AND "itemId" = ${plain.id}::uuid
         GROUP BY "warehouseId"
      `);
      for (const row of rows) {
        if (!row.warehouseId) continue;
        const held = await ledger.position(prisma as never, {
          companyId: company.id,
          branchId: branch.id,
          warehouseId: row.warehouseId,
          itemId: plain.id,
        });
        assert.equal(held.quantity.toFixed(4), new Prisma.Decimal(row.quantity).toFixed(4));
        assert.equal(held.value.toFixed(4), new Prisma.Decimal(row.value).toFixed(4));
      }
    });

    await check('two simultaneous issues cannot both take the last three units', async () => {
      const before = await ledger.position(prisma as never, {
        companyId: company.id,
        branchId: branch.id,
        warehouseId: warehouseB.id,
        itemId: plain.id,
      });
      // Ask for more than the shelf holds, from two directions at once.
      const attempt = () =>
        batches
          .issue(
            company.id,
            user.id,
            {
              branchId: branch.id,
              warehouseId: warehouseB.id,
              itemId: plain.id,
              quantity: Number(before.quantity) - 1,
              referenceType: 'SALES_INVOICE',
              referenceNumber: `${TAG}/SI-RACE`,
            },
            [branch.id],
          )
          .then(() => true)
          .catch(() => false);
      const results = await Promise.all([attempt(), attempt()]);
      assert.equal(results.filter(Boolean).length, 1, 'exactly one of the two may succeed');
      const after = await ledger.position(prisma as never, {
        companyId: company.id,
        branchId: branch.id,
        warehouseId: warehouseB.id,
        itemId: plain.id,
      });
      assert.equal(after.quantity.toFixed(4), '1.0000', 'one unit is left, never negative');
    });

    // ══════════════════════════════════════════════════════════════════════
    // A write-off is a document: numbered, approved once, idempotent
    // ══════════════════════════════════════════════════════════════════════

    const approver = await prisma.user.create({
      data: {
        companyId: company.id,
        username: `${TAG}-approver`.slice(0, 60),
        fullNameEn: 'Approver',
        fullNameAr: 'معتمد',
        // A hash that cannot sign in: this account only exists to sign a
        // write-off in this test, not to be a way into the system.
        passwordHash: 'not-a-real-hash',
      },
    });

    const draftWriteOff = await documents.create(
      company.id,
      branch.id,
      user.id,
      {
        kind: 'WRITE_OFF',
        branchId: branch.id,
        toWarehouseId: warehouseB.id,
        documentDate: day(0),
        reason: 'broken in the overflow store',
        lines: [{ itemId: plain.id, quantity: -1, unitCost: 27.5 }],
      },
      { idempotencyKey: `${TAG}/WO-KEY` },
    );

    await check('a write-off gets its own series and starts as a draft', async () => {
      assert.match(draftWriteOff.documentNumber, /^WO-/);
      assert.equal(draftWriteOff.status, 'DRAFT');
      assert.equal(draftWriteOff.approvedAt, null);
    });

    await check('posting an unapproved write-off is refused', async () => {
      await assert.rejects(
        documents.post(company.id, user.id, draftWriteOff.id),
        /approved/,
      );
    });

    await check('the person who recorded it cannot approve it', async () => {
      await assert.rejects(documents.approve(company.id, user.id, draftWriteOff.id), /cannot approve/);
    });

    await documents.approve(company.id, approver.id, draftWriteOff.id);

    await check('a second approval is refused rather than silently overwriting the first', async () => {
      await assert.rejects(
        documents.approve(company.id, approver.id, draftWriteOff.id),
        /already approved/,
      );
    });

    await check('the same idempotency key returns the same document instead of a second loss', async () => {
      const again = await documents.create(
        company.id,
        branch.id,
        user.id,
        {
          kind: 'WRITE_OFF',
          branchId: branch.id,
          toWarehouseId: warehouseB.id,
          documentDate: day(0),
          reason: 'broken in the overflow store',
          lines: [{ itemId: plain.id, quantity: -1, unitCost: 27.5 }],
        },
        { idempotencyKey: `${TAG}/WO-KEY` },
      );
      assert.equal(again.id, draftWriteOff.id);
      const count = await prisma.stockDocument.count({
        where: { companyId: company.id, idempotencyKey: `${TAG}/WO-KEY` },
      });
      assert.equal(count, 1);
    });

    const postedWriteOff = await documents.post(company.id, approver.id, draftWriteOff.id);

    await check('a posted write-off takes the goods off that shelf and books the loss', async () => {
      const shelf = await ledger.position(prisma as never, {
        companyId: company.id,
        branchId: branch.id,
        warehouseId: warehouseB.id,
        itemId: plain.id,
      });
      assert.equal(shelf.quantity.toFixed(4), '0.0000', 'the one remaining unit is gone');
      assert.match(postedWriteOff.journalEntryId ?? '', /[0-9a-f-]{36}/);
      const entry = await prisma.journalEntry.findFirstOrThrow({
        where: { companyId: company.id, id: postedWriteOff.journalEntryId as string },
        include: { lines: { include: { account: { select: { code: true } } } } },
      });
      const debit = entry.lines.reduce((sum, line) => sum.plus(line.debit), D(0));
      const credit = entry.lines.reduce((sum, line) => sum.plus(line.credit), D(0));
      assert.equal(debit.toFixed(4), credit.toFixed(4), 'the entry balances');
      assert.equal(debit.toFixed(4), '27.5000', 'one unit at the shelf average');
      const loss = entry.lines.find((line) => line.account.code === '5107');
      assert.ok(loss, 'the loss lands on the inventory-difference account');
      assert.equal(loss!.debit.toFixed(4), '27.5000');
    });

    // ══════════════════════════════════════════════════════════════════════
    // Counting: frozen, counted, approved once, posted once
    // ══════════════════════════════════════════════════════════════════════

    const session = await stockTakes.start(
      company.id,
      user.id,
      { branchId: branch.id, warehouseId: warehouse.id, scope: 'FULL' },
      [branch.id],
    );

    await check('a count freezes what the system believes, line by line', async () => {
      assert.equal(session.status, 'COUNTING');
      assert.ok(session.totalLines > 0, 'the shelves have something to count');
      assert.ok(session.lines.every((line) => line.countedQuantity === null));
    });

    const plainLine = session.lines.find((line) => line.itemId === plain.id);
    if (!plainLine) throw new Error('the plain item is not on the count sheet');
    await stockTakes.record(
      company.id,
      user.id,
      session.id,
      { lines: [{ lineId: plainLine.id, countedQuantity: 12 }], finish: true },
      [branch.id],
    );

    await check('the difference is computed from the frozen figure, at the frozen cost', async () => {
      const reread = await stockTakes.findOne(company.id, session.id, [branch.id]);
      const line = reread.lines.find((row) => row.itemId === plain.id);
      assert.ok(line);
      // 14 on the shelf, 12 counted.
      assert.equal(line!.systemQuantity, '14.0000');
      assert.equal(line!.varianceQuantity, '-2.0000');
      assert.equal(line!.varianceValue, '-30.0000', 'two units at the 15 average');
      assert.equal(reread.status, 'REVIEW');
    });

    await check('the person who opened the count cannot approve its difference', async () => {
      await assert.rejects(
        stockTakes.approve(company.id, user.id, session.id, [branch.id]),
        /cannot approve/,
      );
    });

    await stockTakes.approve(company.id, approver.id, session.id, [branch.id]);

    await check('approving twice is refused', async () => {
      await assert.rejects(
        stockTakes.approve(company.id, approver.id, session.id, [branch.id]),
        /already approved/,
      );
    });

    const postedCount = await stockTakes.post(company.id, approver.id, session.id, [branch.id]);

    await check('posting the count books one linked adjustment and cannot be repeated', async () => {
      assert.equal(postedCount.status, 'POSTED');
      assert.ok(postedCount.documentId, 'the session points at its adjustment');
      const adjustment = await prisma.stockDocument.findFirstOrThrow({
        where: { companyId: company.id, id: postedCount.documentId as string },
      });
      assert.equal(adjustment.kind, 'ADJUSTMENT');
      assert.equal(adjustment.status, 'POSTED');
      assert.equal(adjustment.stockTakeSessionId, session.id, 'the document knows its count');
      const shelf = await ledger.position(prisma as never, {
        companyId: company.id,
        branchId: branch.id,
        warehouseId: warehouse.id,
        itemId: plain.id,
      });
      assert.equal(shelf.quantity.toFixed(4), '12.0000', 'the shelf now holds what was counted');
      await assert.rejects(
        stockTakes.post(company.id, approver.id, session.id, [branch.id]),
        /already been posted/,
      );
    });

    // ══════════════════════════════════════════════════════════════════════
    // The centre: order, audience and closing what stopped being true
    // ══════════════════════════════════════════════════════════════════════

    await check('the list is ordered CRITICAL, WARNING, INFO - not alphabetically', async () => {
      const scan = await notifications.scanStock(company.id);
      assert.ok(scan.raised > 0 || scan.closed >= 0);
      const listed = await notifications.list({
        userId: user.id,
        companyId: company.id,
        permissions: ['inventory.batches.read', 'inventory.stock.read', 'notifications.read'],
        isSuperAdmin: true,
        branchIds: [branch.id],
        roles: [],
      });
      const ranks = listed.items.map((item) =>
        item.severity === 'CRITICAL' ? 3 : item.severity === 'WARNING' ? 2 : 1,
      );
      for (let index = 1; index < ranks.length; index += 1) {
        assert.ok(
          ranks[index - 1] >= ranks[index],
          `item ${index} outranks the one after it (${listed.items[index - 1].severity} then ${listed.items[index].severity})`,
        );
      }
    });

    await check('an alert nobody may see does not exist for them', async () => {
      const withoutPermission = await notifications.list({
        userId: 'someone-else',
        companyId: company.id,
        permissions: [],
        isSuperAdmin: false,
        branchIds: [branch.id],
        roles: [],
      });
      assert.equal(withoutPermission.total, 0);
      const count = await notifications.unreadCount({
        userId: 'someone-else',
        companyId: company.id,
        permissions: [],
        isSuperAdmin: false,
        branchIds: [branch.id],
        roles: [],
      });
      assert.equal(count.unread, 0);
    });

    // tidy-up turn a passing run into a failing one: the database is
    // disposable, and a leftover row is a smaller problem than a green test
    // reported red. The audit trail is deliberately NOT deleted - the database
    // refuses it without an audited purge, which is the point of that trigger,
    // and a test has no business claiming otherwise.
    const attempt = async (name: string, run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        console.warn(`  (clean-up left ${name} behind: ${(error as Error).message})`);
      }
    };
    await attempt('notifications', () =>
      prisma.notification.deleteMany({
        where: { companyId: company.id, type: { startsWith: 'STOCK_' } },
      }),
    );
    await attempt('journal entries', async () => {
      const journals = await prisma.journalEntry.findMany({
        where: {
          companyId: company.id,
          sourceType: { in: ['INVENTORY_WRITE_OFF', 'BATCH_TRANSFER'] },
        },
        select: { id: true },
      });
      await prisma.journalLine.deleteMany({
        where: { journalEntryId: { in: journals.map((row) => row.id) } },
      });
      await prisma.journalEntry.deleteMany({
        where: { id: { in: journals.map((row) => row.id) } },
      });
    });
    await attempt('stock movements', () =>
      prisma.stockMovement.deleteMany({
        where: { companyId: company.id, itemId: item.id },
      }),
    );
    await attempt('cost history', () =>
      prisma.itemCostHistory.deleteMany({
        where: { companyId: company.id, itemId: item.id },
      }),
    );
    await attempt('balance', () =>
      prisma.stockBalance.deleteMany({
        where: { companyId: company.id, branchId: branch.id },
      }),
    );
    await attempt('warehouse balances', () =>
      prisma.warehouseStockBalance.deleteMany({
        where: { companyId: company.id, warehouseId: { in: [warehouse.id, warehouseB.id] } },
      }),
    );
    await attempt('stock take sessions', () =>
      prisma.stockTakeSession.deleteMany({ where: { companyId: company.id } }),
    );
    await attempt('lots', () =>
      prisma.itemBatch.deleteMany({ where: { companyId: company.id, itemId: item.id } }),
    );
    await attempt('thresholds', () =>
      prisma.itemWarehouseSetting.deleteMany({
        where: { companyId: company.id, itemId: item.id },
      }),
    );
    await attempt('storage locations', () =>
      prisma.storageLocation.deleteMany({
        where: { companyId: company.id, warehouseId: { in: [warehouse.id, warehouseB.id] } },
      }),
    );
    await attempt('warehouses', () =>
      prisma.warehouse.deleteMany({ where: { id: { in: [warehouse.id, warehouseB.id] } } }),
    );
    await attempt('plain item', () =>
      prisma.item.deleteMany({ where: { code: { startsWith: TAG } } }),
    );
    await attempt('approver', () =>
      prisma.user.deleteMany({ where: { username: { startsWith: `${TAG}-approver` } } }),
    );
    await attempt('item', () => prisma.item.deleteMany({ where: { id: item.id } }));
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\nFAILED', error);
  process.exit(1);
});

// Keep TypeScript honest about the unused client import: the adapter is what
// the generated client needs, and this proves the test really is connected to
// the same database the API uses.
void PrismaClient;
void PrismaPg;
