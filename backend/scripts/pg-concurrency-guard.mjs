/**
 * REAL PostgreSQL concurrency test (classification D) for the warehouse
 * negative-stock guard.
 *
 * Two independent TCP connections (two PrismaClient instances, each with its
 * own PrismaPg pool) run the production StockDocumentsService.post() against
 * a REAL native PostgreSQL 18 server started by pg-embedded-server.mjs.
 * Each posting is its own interactive transaction. No database mocks and no
 * in-process mutex: the ordering comes from PostgreSQL's row lock on the
 * warehouses row taken by WarehouseService.lockForPosting (SELECT FOR UPDATE).
 *
 * Scenario per iteration: source warehouse holds 10, two DRAFT transfer
 * documents each move 7, started with a real temporal overlap. Exactly one
 * must post; the second must block on the lock, re-read the reduced
 * availability (3) and be rejected with BadRequestException before writing
 * anything.
 *
 * The only test instrumentation is a short hold after the A-side takes the
 * lock, which makes the overlap deterministic without changing any SQL or
 * mocking the database. A third raw connection samples pg_stat_activity to
 * capture the real lock-wait evidence.
 *
 * Usage: DATABASE_URL=... node scripts/pg-concurrency-guard.mjs [iterations]
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BadRequestException } from '@nestjs/common';

import { WarehouseService } from '../dist/src/common/warehouse/warehouse.service.js';
import { StockDocumentsService } from '../dist/src/modules/inventory/stock-documents.service.js';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error('DATABASE_URL is required');
const ITERATIONS = Number(process.argv[2] ?? 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const monitor = new pg.Client({ connectionString: DB_URL });

/** Same SQL shape the service will run, but labelled so pg_stat_activity shows it. */
function makeClient(applicationName) {
  const u = new URL(DB_URL);
  u.searchParams.set('application_name', applicationName);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: u.toString() }) });
}

/** Holds the row lock for a controlled window so B's blocking is observable. */
class TimedWarehouseService extends WarehouseService {
  constructor(prisma, audit, label, holdMs) {
    super(prisma, audit);
    this.label = label;
    this.holdMs = holdMs;
  }

  async lockForPosting(tx, companyId, warehouseId) {
    await super.lockForPosting(tx, companyId, warehouseId);
    if (this.label === 'A' && this.holdMs > 0) await sleep(this.holdMs);
  }
}

function makeService(prisma, warehouses) {
  return new StockDocumentsService(
    prisma,
    { next: async () => `ST-${randomUUID().slice(0, 8)}` },
    { post: async () => ({ id: randomUUID(), entryNumber: 'JE-X' }) },
    { resolve: async () => ({ inventory: 'a', inventoryDifference: 'b' }) },
    { record: async () => undefined },
    { get: async () => ({ allowNegativeStock: false }) },
    warehouses,
    { assertPostable: () => undefined },
  );
}

async function seedCompany(prisma) {
  // The schema enforces one active company per installation (partial unique
  // index Company_one_active_company_idx, migration 20261014000000), so all
  // iterations share a company and get isolated branches/warehouses/items.
  // Idempotent across reruns against the persistent cluster.
  const existing = await prisma.company.findFirst({
    where: { code: 'CCONC', deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const companyId = randomUUID();
  await prisma.company.create({
    data: { id: companyId, code: 'CCONC', nameEn: 'Concurrency Co', nameAr: 'شركة التزامن' },
  });
  return companyId;
}

async function seed(prisma, companyId, n) {
  const suffix = randomUUID().slice(0, 8);
  const branchId = randomUUID();
  const wSrc = randomUUID();
  const wDst = randomUUID();
  const itemId = randomUUID();

  await prisma.branch.create({
    data: { id: branchId, companyId, code: `B${n}-${suffix}`, nameEn: `Branch ${n}`, nameAr: `فرع ${n}` },
  });
  await prisma.warehouse.createMany({
    data: [
      { id: wSrc, companyId, branchId, code: `WS${n}-${suffix}`, nameEn: 'Source', nameAr: 'مصدر' },
      { id: wDst, companyId, branchId, code: `WD${n}-${suffix}`, nameEn: 'Destination', nameAr: 'وجهة' },
    ],
  });
  await prisma.item.create({
    data: { id: itemId, companyId, code: `MILK-${suffix}`, nameEn: 'Milk', nameAr: 'لبن', unit: 'piece' },
  });
  await prisma.stockBalance.create({
    data: { companyId, branchId, itemId, quantity: new Prisma.Decimal(10), value: new Prisma.Decimal(75) },
  });
  await prisma.stockMovement.create({
    data: {
      companyId,
      branchId,
      warehouseId: wSrc,
      itemId,
      movementDate: new Date('2026-10-01'),
      direction: 'IN',
      quantity: new Prisma.Decimal(10),
      unitCost: new Prisma.Decimal(7.5),
      totalCost: new Prisma.Decimal(75),
      referenceType: 'SEED',
    },
  });

  const docBase = {
    companyId,
    branchId,
    kind: 'TRANSFER',
    documentDate: new Date('2026-10-28'),
    fromBranchId: branchId,
    toBranchId: branchId,
    fromWarehouseId: wSrc,
    toWarehouseId: wDst,
    status: 'DRAFT',
  };
  const docA = await prisma.stockDocument.create({
    data: { ...docBase, id: randomUUID(), documentNumber: `ST-A${n}-${randomUUID().slice(0, 6)}` },
  });
  const docB = await prisma.stockDocument.create({
    data: { ...docBase, id: randomUUID(), documentNumber: `ST-B${n}-${randomUUID().slice(0, 6)}` },
  });
  for (const doc of [docA, docB]) {
    await prisma.stockDocumentLine.create({
      data: {
        id: randomUUID(),
        documentId: doc.id,
        itemId,
        lineNumber: 1,
        quantity: new Prisma.Decimal(7),
        unitCost: new Prisma.Decimal(7.5),
      },
    });
  }
  return { companyId, branchId, wSrc, wDst, itemId, docAId: docA.id, docBId: docB.id };
}

async function sampleLocks() {
  const { rows } = await monitor.query(
    `select pid, application_name, state, wait_event_type, wait_event,
            now()::text as at, left(query, 60) as query_head
       from pg_stat_activity
      where datname = current_database()
        and application_name in ('guard-tx-A', 'guard-tx-B')`,
  );
  return rows;
}

const summary = [];

async function runIteration(n, companyId, userId) {
  const prismaAdmin = makeClient(`guard-admin-${n}`);
  const prismaA = makeClient('guard-tx-A');
  const prismaB = makeClient('guard-tx-B');
  const warehouseA = new TimedWarehouseService(prismaA, {}, 'A', 900);
  const warehouseB = new TimedWarehouseService(prismaB, {}, 'B', 0);
  const serviceA = makeService(prismaA, warehouseA);
  const serviceB = makeService(prismaB, warehouseB);

  const ctx = await seed(prismaAdmin, companyId, n);
  const samples = [];
  const startedAt = Date.now();
  const sampler = setInterval(() => {
    sampleLocks()
      .then((rows) => samples.push({ t: Date.now() - startedAt, rows }))
      .catch(() => undefined);
  }, 40);

  const outcomeA = serviceA.post(ctx.companyId, userId, ctx.docAId).then(
    (v) => ({ status: 'fulfilled', value: v }),
    (e) => ({ status: 'rejected', reason: e }),
  );
  await sleep(250); // B starts while A holds the warehouses row lock
  const outcomeB = serviceB.post(ctx.companyId, userId, ctx.docBId).then(
    (v) => ({ status: 'fulfilled', value: v }),
    (e) => ({ status: 'rejected', reason: e }),
  );
  const [a, b] = await Promise.allSettled([outcomeA, outcomeB]).then((r) =>
    r.map((x) => x.value),
  );
  clearInterval(sampler);
  await sleep(60);

  // ---- independent verification straight from the real database ----------
  const pids = [...new Set(samples.flatMap((s) => s.rows.map((r) => r.pid)))];
  const appNames = [...new Set(samples.flatMap((s) => s.rows.map((r) => r.application_name)))];
  const lockWaits = samples.flatMap((s) =>
    s.rows
      .filter((r) => r.wait_event_type === 'Lock')
      .map((r) => ({ t: s.t, app: r.application_name, event: r.wait_event, pid: r.pid })),
  );
  const overlapSamples = samples.filter((s) => {
    const names = s.rows.map((r) => r.application_name);
    return names.includes('guard-tx-A') && names.includes('guard-tx-B');
  });

  const movements = await prismaAdmin.stockMovement.findMany({
    where: {
      companyId: ctx.companyId,
      itemId: ctx.itemId,
      referenceType: { in: ['STOCK_TRANSFER_OUT', 'STOCK_TRANSFER_IN'] },
    },
    orderBy: { createdAt: 'asc' },
  });
  const docs = await prismaAdmin.stockDocument.findMany({
    where: { id: { in: [ctx.docAId, ctx.docBId] } },
    select: { id: true, status: true, documentNumber: true, journalEntryId: true },
  });
  const qty = (warehouseId) =>
    prismaAdmin.$queryRaw`
      select coalesce(sum(case when direction = 'IN' then quantity else -quantity end), 0)::text as q
        from stock_movements
       where "companyId" = ${ctx.companyId}::uuid and "warehouseId" = ${warehouseId}::uuid
         and "itemId" = ${ctx.itemId}::uuid`;
  const [srcRows, dstRows, balanceRows, journalRows, orphanRows] = await Promise.all([
    qty(ctx.wSrc),
    qty(ctx.wDst),
    prismaAdmin.stockBalance.findMany({
      where: { companyId: ctx.companyId, branchId: ctx.branchId, itemId: ctx.itemId },
    }),
    // Scoped to THIS iteration's two documents: other harnesses legitimately
    // post journals in the same company and must not contaminate the check.
    prismaAdmin.journalEntry.findMany({
      where: {
        companyId: ctx.companyId,
        sourceType: 'STOCK_DOCUMENT',
        sourceId: { in: [ctx.docAId, ctx.docBId] },
      },
    }),
    prismaAdmin.$queryRaw`
      select m.id from stock_movements m
       left join stock_documents d on d.id = m."referenceId"
      where m."companyId" = ${ctx.companyId}::uuid
        and m."itemId" = ${ctx.itemId}::uuid
        and m."referenceType" in ('STOCK_TRANSFER_OUT','STOCK_TRANSFER_IN')
        and d.id is null`,
  ]);

  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  add('1. two independent backend connections observed', pids.length >= 2, `pids=${pids.join(',')} apps=${appNames.join('|')}`);
  add('2. real temporal overlap of the two transactions', overlapSamples.length > 0, `${overlapSamples.length} overlapping samples`);
  add('3. PostgreSQL lock wait captured (not an in-process mutex)', lockWaits.length > 0, lockWaits.map((w) => `${w.app}:${w.event}@${w.t}ms`).join('; ') || 'none');
  const fulfilled = [a, b].filter((o) => o.status === 'fulfilled');
  const rejected = [a, b].filter((o) => o.status === 'rejected');
  add('4. exactly one posting succeeded', fulfilled.length === 1 && rejected.length === 1, `${fulfilled.length} ok / ${rejected.length} rejected`);
  const reason = rejected[0]?.reason;
  add(
    '5. rejection is BadRequestException(400) about the selected warehouse',
    reason instanceof BadRequestException && reason.getStatus() === 400 && /selected warehouse/.test(reason.message),
    reason ? `${reason.constructor.name}: ${reason.message}` : 'no rejection',
  );
  add('6a. source warehouse ends at 3, never negative', srcRows[0].q === '3.0000', srcRows[0].q);
  add('6b. destination warehouse receives 7', dstRows[0].q === '7.0000', dstRows[0].q);
  const outMoves = movements.filter((m) => m.direction === 'OUT');
  const inMoves = movements.filter((m) => m.direction === 'IN');
  add(
    '7. exactly one OUT(7) and one IN(7) transfer movement pair',
    movements.length === 2 && outMoves.length === 1 && inMoves.length === 1 &&
      Number(outMoves[0].quantity) === 7 && Number(inMoves[0].quantity) === 7,
    `total=${movements.length} OUT=${outMoves.length} IN=${inMoves.length} qty=${outMoves[0]?.quantity?.toString()}/${inMoves[0]?.quantity?.toString()}`,
  );
  add('8. no orphan movements (every referenceId resolves to a document)', orphanRows.length === 0, `${orphanRows.length} orphans`);
  const docsUnlinked = docs.every((d) => d.journalEntryId === null);
  add('9. transfer created no journal entry by design',
    journalRows.length === 0 && docsUnlinked,
    `${journalRows.length} journals, docs linked=${docs.filter((d) => d.journalEntryId).length}`);
  const loser = docs.find((d) => d.id === (a.status === 'rejected' ? ctx.docAId : ctx.docBId));
  const winner = docs.find((d) => d.id === (a.status === 'fulfilled' ? ctx.docAId : ctx.docBId));
  add(
    '10. winner POSTED, loser still DRAFT, branch balance preserved at 10',
    winner?.status === 'POSTED' && loser?.status === 'DRAFT' &&
      balanceRows.length === 1 && Number(balanceRows[0].quantity) === 10,
    `winner=${winner?.status} loser=${loser?.status} branchQty=${balanceRows[0]?.quantity?.toString()}`,
  );

  await prismaAdmin.$disconnect();
  await prismaA.$disconnect();
  await prismaB.$disconnect();
  return { iteration: n, checks, lockWaits: lockWaits.length, pids };
}

await monitor.connect();
const setupClient = makeClient('guard-setup');
const companyId = await seedCompany(setupClient);
const userId = randomUUID();
await setupClient.$disconnect();
let allOk = true;
for (let i = 1; i <= ITERATIONS; i += 1) {
  const r = await runIteration(i, companyId, userId);
  const failed = r.checks.filter((c) => !c.ok);
  allOk = allOk && failed.length === 0;
  console.log(`\n=== iteration ${i}/${ITERATIONS} (lock-wait samples: ${r.lockWaits}, backends: ${r.pids.length}) ===`);
  for (const c of r.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
await monitor.end();

console.log(`\n${allOk ? 'ALL CONCURRENCY ITERATIONS PASSED' : 'CONCURRENCY TEST FAILURES PRESENT'} (${ITERATIONS} iterations)`);
process.exit(allOk ? 0 : 1);
