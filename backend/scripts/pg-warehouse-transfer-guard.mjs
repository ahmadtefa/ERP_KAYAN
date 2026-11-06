/**
 * REAL PostgreSQL guard (classification B) for the warehouse-level negative
 * stock rule on stock transfers.
 *
 * The reported defect: with allowNegativeStock=false, a transfer between two
 * warehouses of the SAME branch could drive the source warehouse's derived
 * card to a negative quantity (observed: -16), because the only backstop was
 * the branch-granular stock_balances row (and its nonnegative CHECK), while
 * stock_balances has no warehouse dimension.
 *
 * This guard runs the production StockDocumentsService unchanged against a
 * REAL native PostgreSQL 18 server (started outside this script). Every
 * quantity below is recomputed independently with raw SQL from
 * stock_movements - the service result is never trusted on its own.
 *
 * Scenarios:
 *  T0  mandatory reproduction: source holds 4, destination 0, transfer 5,
 *      negatives disallowed -> rejected, nothing written, both cards unchanged
 *  T1  sufficient stock: 20 -> move 5 -> source 15 / destination 5
 *  T2  allowNegativeStock=true preserves the permissive behaviour (the source
 *      warehouse card may go negative while the branch total stays nonnegative)
 *  T3  two warehouses of one branch are checked independently (defect family)
 *  T4  cross-branch transfer beyond the source warehouse is rejected atomically
 *  T5  same-warehouse transfer is refused at create() before any transaction
 *  T6  multiple units of measure: entered sub-units compared in base units
 *  T7  retry/repost: a posted document cannot deduct twice; a rejected draft
 *      leaves the later valid posting unaffected
 *  T8  failure mid-posting rolls the whole transfer back (no half transfer)
 *  T9  accounting/integrity sweep: no journals for transfers, no orphan
 *      movements, no negative stock_balances, derived cards match movements
 *
 * Usage: DATABASE_URL=... node scripts/pg-warehouse-transfer-guard.mjs
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
const dec = (v) => new Prisma.Decimal(v);

function makeClient(applicationName) {
  const u = new URL(DB_URL);
  u.searchParams.set('application_name', applicationName);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: u.toString() }) });
}

/** Fails the IN leg of a transfer on demand, to prove transaction atomicity. */
class HalfFailureStockService extends StockDocumentsService {
  constructor(...args) {
    super(...args);
    this.failNextInLeg = false;
  }

  async move(tx, input) {
    if (this.failNextInLeg && input.direction === 'IN' && input.referenceType === 'STOCK_TRANSFER_IN') {
      throw new Error('simulated mid-posting failure');
    }
    return super.move(tx, input);
  }
}

async function main() {
  const prisma = makeClient('guard-warehouse-transfer');

  // Self-seeded company so the guard runs on a freshly migrated database.
  let company = await prisma.company.findFirst({ where: { isActive: true } });
  if (!company) {
    company = await prisma.company.create({
      data: { id: randomUUID(), code: 'CWGT', nameEn: 'Warehouse Transfer Guard Co', nameAr: 'شركة حارس التحويل' },
    });
    console.log(`Seeded company ${company.code} (${company.id}) on an empty database`);
  }
  const companyId = company.id;
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      companyId,
      username: `wt-guard-${suffix}`,
      fullNameEn: 'Warehouse transfer guard',
      fullNameAr: 'حارس تحويل المخازن',
      passwordHash: 'guard-placeholder-not-a-real-credential',
    },
  });
  const userId = user.id;

  // Real production service graph (no stubs).
  const audit = new AuditService(prisma);
  const accounts = new AccountMapService();
  const numbers = new DocumentNumberService();
  const periods = new FiscalPeriodsService(prisma, audit);
  const costCenters = new CostCentersService(prisma, audit);
  const posting = new PostingService(numbers, periods, costCenters);
  const settings = new CompanySettingsService(prisma, audit);
  const warehouses = new WarehouseService(prisma, audit);
  const stock = new StockDocumentsService(
    prisma, numbers, posting, accounts, audit, settings, warehouses, costCenters,
  );
  const failingStock = new HalfFailureStockService(
    prisma, numbers, posting, accounts, audit, settings, warehouses, costCenters,
  );

  const setNegativePolicy = async (allow) => {
    await prisma.companySetting.upsert({
      where: { companyId },
      create: { companyId, allowNegativeStock: allow },
      update: { allowNegativeStock: allow },
    });
  };

  /** Independent per-warehouse derived card, exactly the /inventory/stock formula. */
  const card = async (warehouseId, itemId) => {
    const rows = await prisma.$queryRaw`
      select coalesce(sum(case when direction = 'IN' then quantity else -quantity end), 0)::text as q
        from stock_movements
       where "companyId" = ${companyId}::uuid
         and "warehouseId" = ${warehouseId}::uuid
         and "itemId" = ${itemId}::uuid`;
    return Number(rows[0].q);
  };

  const docMovements = async (docId) =>
    prisma.stockMovement.findMany({ where: { companyId, referenceId: docId }, orderBy: { direction: 'asc' } });

  /**
   * Builds an isolated world: one branch (or two for cross-branch cases),
   * named warehouses, one item, a branch stock_balances row and seed IN
   * movements placed in the exact warehouse that owns the goods.
   */
  async function seedWorld(opts = {}) {
    const tag = randomUUID().slice(0, 6);
    const branch = await prisma.branch.create({
      data: { companyId, code: `WTB-${tag}`, nameEn: `Branch ${tag}`, nameAr: `فرع ${tag}`, kind: 'HEADQUARTERS' },
    });
    const branch2 = opts.twoBranches
      ? await prisma.branch.create({
          data: { companyId, code: `WTD-${tag}`, nameEn: `Branch2 ${tag}`, nameAr: `فرع2 ${tag}`, kind: 'BRANCH' },
        })
      : null;
    const warehouse = async (branchId, code, isDefault = false) =>
      prisma.warehouse.create({
        data: { companyId, branchId, code: `${code}-${tag}`, nameEn: code, nameAr: code, isDefault },
      });
    const wA = await warehouse(branch.id, 'A', true);
    const wB = await warehouse(branch.id, 'B');
    const wC = opts.thirdWarehouse ? await warehouse(branch.id, 'C') : null;
    const wD = branch2 ? await warehouse(branch2.id, 'D', true) : null;
    const item = await prisma.item.create({
      data: {
        companyId,
        code: `WTITEM-${tag}`,
        nameEn: `Item ${tag}`,
        nameAr: `صنف ${tag}`,
        unit: 'piece',
        ...(opts.carton
          ? {
              units: {
                create: { unit: 'carton', factor: dec(12) },
              },
            }
          : {}),
      },
      include: { units: true },
    });

    const seedInto = async (warehouseId, branchId, qty) => {
      if (!qty) return;
      await prisma.stockMovement.create({
        data: {
          companyId,
          branchId,
          warehouseId,
          itemId: item.id,
          movementDate: new Date('2051-01-05T00:00:00.000Z'),
          direction: 'IN',
          quantity: dec(qty),
          unitCost: dec(7.5),
          totalCost: dec(7.5 * qty),
          referenceType: 'SEED',
        },
      });
    };
    await seedInto(wA.id, branch.id, opts.a ?? 0);
    await seedInto(wB.id, branch.id, opts.b ?? 0);
    if (wC) await seedInto(wC.id, branch.id, opts.c ?? 0);
    if (wD) await seedInto(wD.id, branch2.id, opts.d ?? 0);

    const branchTotal = (opts.a ?? 0) + (opts.b ?? 0) + (opts.c ?? 0);
    if (branchTotal > 0) {
      await prisma.stockBalance.create({
        data: {
          companyId,
          branchId: branch.id,
          itemId: item.id,
          quantity: dec(branchTotal),
          value: dec(7.5 * branchTotal),
        },
      });
    }
    if (branch2 && (opts.d ?? 0) > 0) {
      await prisma.stockBalance.create({
        data: {
          companyId,
          branchId: branch2.id,
          itemId: item.id,
          quantity: dec(opts.d),
          value: dec(7.5 * opts.d),
        },
      });
    }
    return { branch, branch2, wA, wB, wC, wD, item };
  }

  const transferDoc = async (world, { from, to, branchFrom, branchTo, qty, lineExtra = {} }) =>
    prisma.stockDocument.create({
      data: {
        companyId,
        branchId: branchTo ?? world.branch.id,
        kind: 'TRANSFER',
        documentNumber: `ST-WT-${randomUUID().slice(0, 8)}`,
        documentDate: new Date('2051-06-01T00:00:00.000Z'),
        fromBranchId: branchFrom ?? world.branch.id,
        toBranchId: branchTo ?? world.branch.id,
        fromWarehouseId: from,
        toWarehouseId: to,
        status: 'DRAFT',
        lines: {
          create: {
            id: randomUUID(),
            itemId: world.item.id,
            lineNumber: 1,
            quantity: dec(qty),
            unitCost: dec(7.5),
            ...lineExtra,
          },
        },
      },
    });

  // ============================================================== T0
  console.log('\n[T0] mandatory reproduction: A=4, B=0, transfer 5, negatives disallowed');
  await setNegativePolicy(false);
  {
    const world = await seedWorld({ a: 4, b: 0 });
    const doc = await transferDoc(world, { from: world.wA.id, to: world.wB.id, qty: 5 });
    const beforeMovements = await prisma.stockMovement.count({ where: { companyId, itemId: world.item.id } });
    let err = null;
    try {
      await stock.post(companyId, userId, doc.id);
    } catch (e) {
      err = e;
    }
    const [cardA, cardB, afterMovements, refreshed, balance, journals] = await Promise.all([
      card(world.wA.id, world.item.id),
      card(world.wB.id, world.item.id),
      prisma.stockMovement.count({ where: { companyId, itemId: world.item.id } }),
      prisma.stockDocument.findUnique({ where: { id: doc.id } }),
      prisma.stockBalance.findUnique({
        where: { companyId_branchId_itemId: { companyId, branchId: world.branch.id, itemId: world.item.id } },
      }),
      prisma.journalEntry.count({ where: { companyId, sourceId: doc.id } }),
    ]);
    check('T0 transfer of 5 against 4 is rejected with a 400 warehouse rule',
      err instanceof BadRequestException && err.getStatus() === 400 && /selected warehouse|Not enough stock/.test(err.message),
      err ? `${err.constructor.name}: ${err.message}` : 'no error');
    check('T0 source warehouse stays at 4 (never -1)', cardA === 4, `cardA=${cardA}`);
    check('T0 destination warehouse stays at 0', cardB === 0, `cardB=${cardB}`);
    check('T0 no movement row written by the rejected posting', afterMovements === beforeMovements,
      `${beforeMovements} -> ${afterMovements}`);
    check('T0 rejected document stays DRAFT with no journal link',
      refreshed.status === 'DRAFT' && refreshed.journalEntryId === null, refreshed.status);
    check('T0 branch stock_balances untouched (quantity 4)', Number(balance.quantity) === 4, balance.quantity.toString());
    check('T0 no journal entry created', journals === 0, `journals=${journals}`);
    check('T0 rejected document has zero movements', (await docMovements(doc.id)).length === 0);
  }

  // ============================================================== T1
  console.log('\n[T1] sufficient stock: A=20, transfer 5 -> A=15, B=5');
  {
    const world = await seedWorld({ a: 20, b: 0 });
    const doc = await transferDoc(world, { from: world.wA.id, to: world.wB.id, qty: 5 });
    await stock.post(companyId, userId, doc.id);
    const [cardA, cardB, moves, refreshed, balance, journals] = await Promise.all([
      card(world.wA.id, world.item.id),
      card(world.wB.id, world.item.id),
      docMovements(doc.id),
      prisma.stockDocument.findUnique({ where: { id: doc.id } }),
      prisma.stockBalance.findUnique({
        where: { companyId_branchId_itemId: { companyId, branchId: world.branch.id, itemId: world.item.id } },
      }),
      prisma.journalEntry.count({ where: { companyId, sourceId: doc.id } }),
    ]);
    check('T1 source card 15 and destination card 5', cardA === 15 && cardB === 5, `${cardA}/${cardB}`);
    check('T1 exactly one OUT(5) and one IN(5) transfer movement',
      moves.length === 2 &&
        moves.some((m) => m.direction === 'OUT' && m.referenceType === 'STOCK_TRANSFER_OUT' && Number(m.quantity) === 5) &&
        moves.some((m) => m.direction === 'IN' && m.referenceType === 'STOCK_TRANSFER_IN' && Number(m.quantity) === 5));
    check('T1 both legs carry the same carrying cost (37.5000)',
      moves.every((m) => Number(m.totalCost) === 37.5), moves.map((m) => Number(m.totalCost)).join('/'));
    check('T1 document POSTED', refreshed.status === 'POSTED', refreshed.status);
    check('T1 branch total conserved at 20 in stock_balances', Number(balance.quantity) === 20, balance.quantity.toString());
    check('T1 internal transfer creates no journal entry', journals === 0, `journals=${journals}`);
  }

  // ============================================================== T2
  console.log('\n[T2] allowNegativeStock=true keeps the permissive warehouse behaviour');
  {
    const world = await seedWorld({ a: 0, b: 0, c: 5, thirdWarehouse: true });
    await setNegativePolicy(true);
    const doc = await transferDoc(world, { from: world.wA.id, to: world.wB.id, qty: 5 });
    let err = null;
    try {
      await stock.post(companyId, userId, doc.id);
    } catch (e) {
      err = e;
    }
    const [cardA, cardB, cardC, balance, refreshed] = await Promise.all([
      card(world.wA.id, world.item.id),
      card(world.wB.id, world.item.id),
      card(world.wC.id, world.item.id),
      prisma.stockBalance.findUnique({
        where: { companyId_branchId_itemId: { companyId, branchId: world.branch.id, itemId: world.item.id } },
      }),
      prisma.stockDocument.findUnique({ where: { id: doc.id } }),
    ]);
    check('T2 permissive transfer succeeds', err === null, err?.message);
    check('T2 source warehouse card is allowed to reach -5', cardA === -5, `cardA=${cardA}`);
    check('T2 destination card +5 and the third warehouse untouched', cardB === 5 && cardC === 5,
      `cardB=${cardB} cardC=${cardC}`);
    check('T2 branch stock_balances never goes negative (stays 5)', Number(balance.quantity) === 5,
      balance.quantity.toString());
    check('T2 permissive document is POSTED', refreshed.status === 'POSTED', refreshed.status);
    await setNegativePolicy(false);
  }

  // ============================================================== T3
  console.log('\n[T3] two warehouses of the same branch are checked independently');
  {
    const world = await seedWorld({ a: 4, b: 16 });
    // Branch total is 20 and covers 5; the source warehouse holds only 4.
    const greedy = await transferDoc(world, { from: world.wA.id, to: world.wB.id, qty: 5 });
    let err = null;
    try {
      await stock.post(companyId, userId, greedy.id);
    } catch (e) {
      err = e;
    }
    check('T3 branch-covered but warehouse-short transfer is rejected',
      err instanceof BadRequestException && /selected warehouse/.test(err.message), err?.message);
    check('T3 source stays 4 after the rejection', (await card(world.wA.id, world.item.id)) === 4);
    check('T3 destination stays 16 after the rejection', (await card(world.wB.id, world.item.id)) === 16);

    // A feasible transfer of exactly 4 then succeeds and touches only its two warehouses.
    const feasible = await transferDoc(world, { from: world.wA.id, to: world.wB.id, qty: 4 });
    await stock.post(companyId, userId, feasible.id);
    const [cardA, cardB, moves] = await Promise.all([
      card(world.wA.id, world.item.id),
      card(world.wB.id, world.item.id),
      docMovements(feasible.id),
    ]);
    check('T3 feasible transfer empties the source (0) and raises destination to 20',
      cardA === 0 && cardB === 20, `${cardA}/${cardB}`);
    check('T3 feasible transfer wrote exactly its OUT/IN pair', moves.length === 2);
  }

  // ============================================================== T4
  console.log('\n[T4] cross-branch transfer beyond the source warehouse is rejected atomically');
  {
    const world = await seedWorld({ a: 3, twoBranches: true });
    const doc = await transferDoc(world, {
      from: world.wA.id,
      to: world.wD.id,
      branchFrom: world.branch.id,
      branchTo: world.branch2.id,
      qty: 5,
    });
    const before = await prisma.stockMovement.count({ where: { companyId, itemId: world.item.id } });
    let err = null;
    try {
      await stock.post(companyId, userId, doc.id);
    } catch (e) {
      err = e;
    }
    const after = await prisma.stockMovement.count({ where: { companyId, itemId: world.item.id } });
    check('T4 cross-branch over-quantity transfer rejected',
      err instanceof BadRequestException && /Not enough stock/.test(err.message), err?.message);
    check('T4 zero movements written on either branch', before === after, `${before} -> ${after}`);
    check('T4 source card unchanged at 3', (await card(world.wA.id, world.item.id)) === 3);
    check('T4 destination card unchanged at 0', (await card(world.wD.id, world.item.id)) === 0);
    check('T4 document remains DRAFT',
      (await prisma.stockDocument.findUnique({ where: { id: doc.id } })).status === 'DRAFT');
  }

  // ============================================================== T5
  console.log('\n[T5] same-warehouse transfer is refused at create()');
  {
    const world = await seedWorld({ a: 10 });
    let err = null;
    try {
      await stock.create(companyId, world.branch.id, userId, {
        kind: 'TRANSFER',
        branchId: world.branch.id,
        fromBranchId: world.branch.id,
        fromWarehouseId: world.wA.id,
        toWarehouseId: world.wA.id,
        documentDate: '2051-06-01',
        lines: [{ itemId: world.item.id, quantity: '5' }],
      });
    } catch (e) {
      err = e;
    }
    check('T5 create() rejects identical source/destination warehouse',
      err instanceof BadRequestException && /two different/.test(err.message), err?.message);
    const docs = await prisma.stockDocument.count({
      where: { companyId, fromWarehouseId: world.wA.id, toWarehouseId: world.wA.id },
    });
    check('T5 no document persisted for the same-warehouse attempt', docs === 0, `docs=${docs}`);
  }

  // ============================================================== T6
  console.log('\n[T6] multiple units of measure are compared in base units');
  {
    // One carton = 12 base pieces (the ItemUnit factor frozen on the line).
    const world = await seedWorld({ a: 24, carton: true });
    // 2 cartons x 12 = 24 base pieces: exactly the source quantity, feasible.
    const okDto = {
      kind: 'TRANSFER',
      branchId: world.branch.id,
      fromBranchId: world.branch.id,
      fromWarehouseId: world.wA.id,
      toWarehouseId: world.wB.id,
      documentDate: '2051-06-01',
      lines: [{ itemId: world.item.id, quantity: '2', unitName: 'carton' }],
    };
    const okDoc = await stock.create(companyId, world.branch.id, userId, okDto);
    await stock.post(companyId, userId, okDoc.id);
    const okLine = await prisma.stockDocumentLine.findFirst({ where: { documentId: okDoc.id } });
    check('T6 2 cartons convert to 24 base pieces', Number(okLine.quantity) === 24, okLine.quantity.toString());
    check('T6 frozen snapshot records the carton factor 12', Number(okLine.unitFactor) === 12,
      String(okLine.unitFactor));
    check('T6 source emptied (0) and destination holds 24 after the UOM transfer',
      (await card(world.wA.id, world.item.id)) === 0 && (await card(world.wB.id, world.item.id)) === 24);

    // Fresh world: 2.5 cartons = 30 pieces against 20 -> rejected by the base-unit guard.
    const world2 = await seedWorld({ a: 20, carton: true });
    const badDoc = await stock.create(companyId, world2.branch.id, userId, {
      kind: 'TRANSFER',
      branchId: world2.branch.id,
      fromBranchId: world2.branch.id,
      fromWarehouseId: world2.wA.id,
      toWarehouseId: world2.wB.id,
      documentDate: '2051-06-01',
      lines: [{ itemId: world2.item.id, quantity: '2.5', unitName: 'carton' }],
    });
    let err = null;
    try {
      await stock.post(companyId, userId, badDoc.id);
    } catch (e) {
      err = e;
    }
    check('T6 2.5 cartons (30 pieces) against 20 is rejected in base units',
      err instanceof BadRequestException && /selected warehouse/.test(err.message), err?.message);
    check('T6 rejected UOM transfer leaves the source at 20',
      (await card(world2.wA.id, world2.item.id)) === 20);
    check('T6 rejected UOM document stays DRAFT',
      (await prisma.stockDocument.findUnique({ where: { id: badDoc.id } })).status === 'DRAFT');
  }

  // ============================================================== T7
  console.log('\n[T7] retry/repost cannot deduct twice');
  {
    const world = await seedWorld({ a: 10 });
    const doc = await transferDoc(world, { from: world.wA.id, to: world.wB.id, qty: 7 });
    await stock.post(companyId, userId, doc.id);
    let err = null;
    try {
      await stock.post(companyId, userId, doc.id);
    } catch (e) {
      err = e;
    }
    const moves = await docMovements(doc.id);
    check('T7 reposting a posted document is refused',
      err instanceof BadRequestException && /draft/i.test(err.message), err?.message);
    check('T7 exactly one OUT/IN pair remains (no double deduction)', moves.length === 2,
      `movements=${moves.length}`);
    check('T7 source card is 3, not -4', (await card(world.wA.id, world.item.id)) === 3);

    // A rejected draft never blocks a later, valid posting.
    const greedy = await transferDoc(world, { from: world.wA.id, to: world.wB.id, qty: 9 });
    let greedyErr = null;
    try {
      await stock.post(companyId, userId, greedy.id);
    } catch (e) {
      greedyErr = e;
    }
    check('T7 transfer of 9 against the remaining 3 is rejected',
      greedyErr instanceof BadRequestException, greedyErr?.message);
    const valid = await transferDoc(world, { from: world.wA.id, to: world.wB.id, qty: 2 });
    await stock.post(companyId, userId, valid.id);
    check('T7 a later valid transfer of 2 succeeds after the rejection',
      (await card(world.wA.id, world.item.id)) === 1 && (await card(world.wB.id, world.item.id)) === 9);
  }

  // ============================================================== T8
  console.log('\n[T8] failure mid-posting rolls the whole transfer back');
  {
    const world = await seedWorld({ a: 20 });
    const doc = await transferDoc(world, { from: world.wA.id, to: world.wB.id, qty: 5 });
    failingStock.failNextInLeg = true;
    let err = null;
    try {
      await failingStock.post(companyId, userId, doc.id);
    } catch (e) {
      err = e;
    }
    failingStock.failNextInLeg = false;
    const [cardA, cardB, moves, refreshed, balance] = await Promise.all([
      card(world.wA.id, world.item.id),
      card(world.wB.id, world.item.id),
      docMovements(doc.id),
      prisma.stockDocument.findUnique({ where: { id: doc.id } }),
      prisma.stockBalance.findUnique({
        where: { companyId_branchId_itemId: { companyId, branchId: world.branch.id, itemId: world.item.id } },
      }),
    ]);
    check('T8 the simulated failure propagates', err instanceof Error && /simulated/.test(err.message),
      err?.message);
    check('T8 no movement survives the rolled-back transfer (OUT rolled back too)', moves.length === 0,
      `movements=${moves.length}`);
    check('T8 source stays 20 and destination stays 0', cardA === 20 && cardB === 0, `${cardA}/${cardB}`);
    check('T8 branch balance unchanged at 20', Number(balance.quantity) === 20, balance.quantity.toString());
    check('T8 document is still DRAFT and can be retried later', refreshed.status === 'DRAFT', refreshed.status);
  }

  // ============================================================== T9
  console.log('\n[T9] company-wide integrity sweep');
  {
    const negativeBalances = await prisma.$queryRaw`
      select count(*)::int as n from stock_balances
       where "companyId" = ${companyId}::uuid and quantity < 0`;
    check('T9 no negative stock_balances row exists anywhere', negativeBalances[0].n === 0,
      `negative=${negativeBalances[0].n}`);

    const orphans = await prisma.$queryRaw`
      select m.id from stock_movements m
      left join stock_documents d on d.id = m."referenceId"
      where m."companyId" = ${companyId}::uuid
        and m."referenceType" in ('STOCK_TRANSFER_OUT','STOCK_TRANSFER_IN')
        and d.id is null`;
    check('T9 every transfer movement resolves to its document (no orphans)', orphans.length === 0,
      `orphans=${orphans.length}`);

    const transferJournals = await prisma.journalEntry.count({
      where: { companyId, sourceType: 'STOCK_DOCUMENT', sourceId: { in:
        (await prisma.stockDocument.findMany({ where: { companyId, kind: 'TRANSFER' }, select: { id: true } }))
          .map((d) => d.id) } },
    });
    check('T9 no transfer produced a journal entry by design', transferJournals === 0,
      `journals=${transferJournals}`);

    // Every per-warehouse card must equal its movement SUM for every item the
    // guard touched (the derived card is the authoritative warehouse figure).
    const items = await prisma.item.findMany({ where: { companyId, code: { startsWith: 'WTITEM-' } }, select: { id: true } });
    let mismatches = 0;
    for (const item of items) {
      const derived = await prisma.$queryRaw`
        select "warehouseId",
               coalesce(sum(case when direction = 'IN' then quantity else -quantity end), 0)::numeric as q
          from stock_movements
         where "companyId" = ${companyId}::uuid and "itemId" = ${item.id}::uuid
         group by "warehouseId"`;
      for (const row of derived) {
        const again = await card(row.warehouseId, item.id);
        if (Number(row.q) !== again) mismatches += 1;
      }
    }
    check('T9 derived warehouse cards are internally consistent', mismatches === 0, `mismatches=${mismatches}`);
  }

  await prisma.$disconnect();
  console.log(`\nWAREHOUSE TRANSFER GUARD: ${pass} PASS / ${fail} FAIL`);
  if (fail > 0) {
    console.log(`Failed checks: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('ALL WAREHOUSE TRANSFER SCENARIOS PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
