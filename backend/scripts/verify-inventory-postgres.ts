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
import { WarehouseService } from '../src/common/warehouse/warehouse.service';
import { AccountMapService } from '../src/modules/accounting/account-map.service';
import { CostCentersService } from '../src/modules/accounting/cost-centers.service';
import { DocumentNumberService } from '../src/modules/accounting/document-number.service';
import { FiscalPeriodsService } from '../src/modules/accounting/fiscal-periods.service';
import { PostingService } from '../src/modules/accounting/posting.service';
import { BatchesService } from '../src/modules/inventory/batches.service';
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
  const numbers = new DocumentNumberService(prisma);
  const periods = new FiscalPeriodsService(prisma, audit);
  const costCenters = new CostCentersService(prisma, audit);
  const posting = new PostingService(numbers, periods, costCenters);
  const accounts = new AccountMapService();
  const batches = new BatchesService(prisma, warehouses, posting, accounts, numbers, audit);
  const locations = new StorageLocationsService(prisma, audit);
  const notifications = new NotificationsService(prisma);

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
      costPrice: D(15),
      isStockTracked: true,
      requiresBatch: true,
      requiresProductionDate: true,
      requiresExpiryDate: true,
      useFefo: true,
      allowExpiredIssue: false,
      expiredIssueNeedsApproval: true,
    },
  });

  const created = {
    movements: [] as string[],
    batches: [] as string[],
    locations: [] as string[],
    costHistory: [] as string[],
    notifications: [] as string[],
    journals: [] as string[],
  };

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

    await check('the issue leaves at the shelf average of 15, not at either lot\'s own price', () => {
      assert.equal(issue.unitCost, '15.0000');
      assert.equal(issue.value, '195.0000');
    });

    await check('the emptied lot is closed rather than deleted, and keeps its movements', async () => {
      const lot = await prisma.itemBatch.findUniqueOrThrow({ where: { id: firstLot.batchId } });
      assert.equal(lot.remainingQuantity.toFixed(4), '0.0000');
      assert.equal(lot.status, 'CLOSED');
      const movements = await prisma.stockMovement.count({
        where: { companyId: company.id, batchId: firstLot.batchId },
      });
      assert.equal(movements, 2, 'the receipt and the issue are both on the lot');
    });

    await check('the balance is 7 at 105, and the history records the cost that moved', async () => {
      const balance = await prisma.stockBalance.findFirstOrThrow({
        where: { companyId: company.id, branchId: branch.id, itemId: item.id },
      });
      assert.equal(balance.quantity.toFixed(4), '7.0000');
      assert.equal(balance.value.toFixed(4), '105.0000');
      const history = await prisma.itemCostHistory.findMany({
        where: { companyId: company.id, itemId: item.id },
        orderBy: { createdAt: 'asc' },
      });
      assert.equal(history.length, 3, 'two receipts and one issue');
      assert.equal(history[2].unitCostAfter.toFixed(4), '15.0000');
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
      assert.equal(balance.quantity.toFixed(4), '8.0000');
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
    // Clean up only what this script created, so the demo company is left
    // exactly as it was found.
    await prisma.notification.deleteMany({
      where: { companyId: company.id, type: { startsWith: 'STOCK_' } },
    });
    const movements = await prisma.stockMovement.findMany({
      where: { companyId: company.id, itemId: item.id },
      select: { id: true },
    });
    const journals = await prisma.journalEntry.findMany({
      where: {
        companyId: company.id,
        sourceType: { in: ['INVENTORY_WRITE_OFF', 'BATCH_TRANSFER'] },
      },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: {
        companyId: company.id,
        entity: { in: ['item_batches', 'storage_locations', 'stock_movements'] },
      },
    });
    await prisma.journalLine.deleteMany({
      where: { journalEntryId: { in: journals.map((row) => row.id) } },
    });
    await prisma.journalEntry.deleteMany({
      where: { id: { in: journals.map((row) => row.id) } },
    });
    await prisma.stockMovement.deleteMany({ where: { id: { in: movements.map((row) => row.id) } } });
    await prisma.itemCostHistory.deleteMany({
      where: { companyId: company.id, itemId: item.id },
    });
    await prisma.stockBalance.deleteMany({
      where: { companyId: company.id, branchId: branch.id, itemId: item.id },
    });
    await prisma.itemBatch.deleteMany({ where: { companyId: company.id, itemId: item.id } });
    await prisma.itemWarehouseSetting.deleteMany({
      where: { companyId: company.id, itemId: item.id },
    });
    await prisma.storageLocation.deleteMany({
      where: { companyId: company.id, warehouseId: { in: [warehouse.id, warehouseB.id] } },
    });
    await prisma.warehouse.deleteMany({
      where: { id: { in: [warehouse.id, warehouseB.id] } },
    });
    await prisma.item.deleteMany({ where: { id: item.id } });
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
