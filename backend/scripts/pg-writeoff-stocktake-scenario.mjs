/**
 * The write-off and the stock take, end to end, against a REAL PostgreSQL.
 *
 *   Receive a lot of 100 at 5.00 into a named shelf.
 *   Write off 10 of it the way the screen does: a DRAFT with a reason, the lot
 *   and the shelf on the line - approved by somebody other than the person who
 *   recorded it, posted only afterwards, and once.
 *   Then count the shelf, record 85, approve by a second person, post the
 *   difference, and prove the shelf and the lot both say 85.
 *
 * Every number below is recomputed with raw SQL from `stock_movements`,
 * `item_batches` and `journal_lines`; the service's own answer is never trusted
 * on its own. The rules the paper promises are pinned here:
 *
 *   - a write-off without a reason is refused before anything is written;
 *   - a write-off line whose quantity is POSITIVE is refused, because the sign
 *     is the direction and a positive line would receive the goods the paper
 *     says were destroyed;
 *   - a write-off is posted only after an approval, and the person who
 *     recorded it cannot approve it;
 *   - approving twice is refused, and so is writing off more than the lot
 *     holds;
 *   - the same idempotency key produces one document, not two;
 *   - a count is opened, frozen, counted, approved by somebody else, and only
 *     then posted - and it can be posted once;
 *   - a person restricted to one warehouse is refused in the other one by the
 *     very guard the API calls, using the rows the access screen writes.
 *
 * Run it on a machine with PostgreSQL and a migrated database:
 *
 *   DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/kayan_test \
 *     node scripts/pg-writeoff-stocktake-scenario.mjs
 *
 * It needs `npm run build` first: it imports the compiled services, so it
 * exercises exactly what ships. CI runs it in the backend job.
 */
import { randomUUID } from 'node:crypto';

import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AuditService } from '../dist/src/common/audit/audit.service.js';
import { CompanySettingsService } from '../dist/src/common/settings/company-settings.module.js';
import { StockLedgerService } from '../dist/src/common/warehouse/stock-ledger.service.js';
import { WarehouseService } from '../dist/src/common/warehouse/warehouse.service.js';
import { may } from '../dist/src/common/warehouse/warehouse-access.js';
import { AccountMapService } from '../dist/src/modules/accounting/account-map.service.js';
import { CostCentersService } from '../dist/src/modules/accounting/cost-centers.service.js';
import { DocumentNumberService } from '../dist/src/modules/accounting/document-number.service.js';
import { FiscalPeriodsService } from '../dist/src/modules/accounting/fiscal-periods.service.js';
import { PostingService } from '../dist/src/modules/accounting/posting.service.js';
import { BatchesService } from '../dist/src/modules/inventory/batches.service.js';
import { StockDocumentsService } from '../dist/src/modules/inventory/stock-documents.service.js';
import { StockTakesService } from '../dist/src/modules/inventory/stock-takes.service.js';
import { StorageLocationsService } from '../dist/src/modules/inventory/storage-locations.service.js';
import { WarehouseAccessService } from '../dist/src/modules/inventory/warehouse-access.service.js';

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

function makeClient(applicationName) {
  const url = new URL(DB_URL);
  url.searchParams.set('application_name', applicationName);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
}

/** The refusal a call produced, or null when it was allowed. */
async function refusal(work) {
  try {
    await work();
    return null;
  } catch (error) {
    return error;
  }
}

async function main() {
  const prisma = makeClient('scenario-writeoff-stocktake');
  const tag = randomUUID().slice(0, 6);

  let company = await prisma.company.findFirst({ where: { isActive: true } });
  if (company) {
    console.log(`Running inside the active company ${company.code}`);
  } else {
    company = await prisma.company.create({
      data: {
        id: randomUUID(),
        code: `CWO-${tag}`,
        nameEn: 'Write-off scenario',
        nameAr: 'سيناريو الإعدام',
      },
    });
  }
  const companyId = company.id;

  const makeUser = (label) =>
    prisma.user.create({
      data: {
        companyId,
        username: `${label}-${tag}`,
        fullNameEn: `Scenario ${label}`,
        fullNameAr: `سيناريو ${label}`,
        // Never a real credential.
        passwordHash: 'scenario-placeholder-not-a-real-credential',
      },
    });
  const maker = await makeUser('maker');
  const approver = await makeUser('approver');
  const outsider = await makeUser('outsider');

  const branch = await prisma.branch.create({
    data: {
      companyId,
      code: `WO-B-${tag}`,
      nameEn: `Write-off branch ${tag}`,
      nameAr: `فرع الإعدام ${tag}`,
      kind: 'HEADQUARTERS',
    },
  });
  const store = await prisma.warehouse.create({
    data: {
      companyId,
      branchId: branch.id,
      code: `WO-MAIN-${tag}`,
      nameEn: 'Main store',
      nameAr: 'المخزن الرئيسي',
      isDefault: true,
    },
  });
  const cage = await prisma.warehouse.create({
    data: {
      companyId,
      branchId: branch.id,
      code: `WO-CAGE-${tag}`,
      nameEn: 'Quarantine cage',
      nameAr: 'قفص الحجر',
    },
  });

  const item = await prisma.item.create({
    data: {
      companyId,
      code: `WO-I-${tag}`,
      nameEn: `Scenario medicine ${tag}`,
      nameAr: `دواء السيناريو ${tag}`,
      unit: 'عبوة',
      salePrice: new Prisma.Decimal(9),
      purchasePrice: new Prisma.Decimal(5),
      isStockTracked: true,
      requiresBatch: true,
      requiresProductionDate: true,
      requiresExpiryDate: true,
      useFefo: true,
      allowExpiredIssue: false,
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
  const ledger = new StockLedgerService();
  const batches = new BatchesService(prisma, warehouses, posting, accounts, numbers, audit, ledger);
  const locations = new StorageLocationsService(prisma, audit);
  const items = { create: null }; // unused: lots are received through BatchesService
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
  const access = new WarehouseAccessService(prisma, audit);
  void items;

  async function ensureAccount(code, type, nameEn, nameAr) {
    const existing = await prisma.account.findFirst({ where: { companyId, code } });
    if (existing) return existing;
    return prisma.account.create({
      data: { companyId, code, type, nameEn, nameAr, isPostable: true, isActive: true },
    });
  }
  // A write-off is a loss: it credits stock and debits the difference account,
  // which the chart numbers 5107. Anything else would book the loss somewhere
  // nobody reconciles.
  const differenceAccount = await ensureAccount('5107', 'EXPENSE', 'Inventory differences', 'فروق المخزون');
  await ensureAccount('1301', 'ASSET', 'Inventory', 'المخزون');

  // The shelf the goods sit on: a zone, a rack inside it, and the bin on the
  // rack. A bin at the root of a warehouse is a place with no room around it,
  // and the server refuses the impossible pairings - a bin belongs on a rack or
  // a shelf, a rack in an aisle or a zone - rather than drawing a tree nobody
  // can walk.
  const zone = await locations.create(
    companyId,
    maker.id,
    {
      warehouseId: store.id,
      kind: 'ZONE',
      code: `WO-Z-${tag}`,
      nameEn: 'Zone A',
      nameAr: 'منطقة أ',
    },
    [branch.id],
  );
  const rack = await locations.create(
    companyId,
    maker.id,
    {
      warehouseId: store.id,
      parentId: zone.id,
      kind: 'RACK',
      code: `WO-RACK-${tag}`,
      nameEn: 'Rack A',
      nameAr: 'رف أ',
    },
    [branch.id],
  );
  const bin = await locations.create(
    companyId,
    maker.id,
    {
      warehouseId: store.id,
      parentId: rack.id,
      kind: 'BIN',
      code: `WO-BIN-${tag}`,
      nameEn: 'Bin A1',
      nameAr: 'خانة أ1',
    },
    [branch.id],
  );

  const shelfQuantity = async (warehouseId, itemId) => {
    const rows = await prisma.$queryRaw`
      select coalesce(sum(case when direction = 'IN' then quantity else -quantity end), 0)::text as q
        from stock_movements
       where "companyId" = ${companyId}::uuid
         and "warehouseId" = ${warehouseId}::uuid
         and "itemId" = ${itemId}::uuid`;
    return Number(rows[0].q);
  };

  // ============================================== W1  a lot on a shelf
  console.log('\n[W1] receive 100 into the main store, in a named lot and shelf');
  const lot = await batches.receive(companyId, maker.id, {
    branchId: branch.id,
    warehouseId: store.id,
    itemId: item.id,
    batchNumber: `LOT-A-${tag}`,
    productionDate: '2052-02-01',
    expiryDate: '2053-02-01',
    quantity: '100',
    unitCost: '5',
    storageLocationId: bin.id,
    documentDate: '2052-03-01',
  });
  const savedLot = await prisma.itemBatch.findUnique({ where: { id: lot.batchId } });
  check('W1 the lot holds 100 at 5.00', Number(savedLot.remainingQuantity) === 100 && Number(savedLot.unitCost) === 5,
    `${savedLot.remainingQuantity} @ ${savedLot.unitCost}`);
  check('W1 the shelf holds 100', (await shelfQuantity(store.id, item.id)) === 100);

  // ============================================== W2  the reason
  console.log('\n[W2] a write-off without a reason is refused before it exists');
  const noReason = await refusal(() =>
    documents.create(companyId, branch.id, maker.id, {
      kind: 'WRITE_OFF',
      documentDate: '2052-03-02',
      toWarehouseId: store.id,
      lines: [{ itemId: item.id, quantity: -10, batchId: lot.batchId }],
    }),
  );
  check('W2 refused with a 400', noReason instanceof BadRequestException, noReason?.message ?? 'no error');
  // Scoped to this script's own branch: a store in the same company may already
  // have a write-off from another proof, and that one is none of our business.
  check('W2 nothing was written',
    (await prisma.stockDocument.count({ where: { companyId, branchId: branch.id, kind: 'WRITE_OFF' } })) === 0);

  // ============================================== W3  the sign
  console.log('\n[W3] a write-off whose line is positive is refused');
  const positive = await refusal(() =>
    documents.create(companyId, branch.id, maker.id, {
      kind: 'WRITE_OFF',
      documentDate: '2052-03-02',
      reason: 'water damage',
      toWarehouseId: store.id,
      lines: [{ itemId: item.id, quantity: 10, batchId: lot.batchId }],
    }),
  );
  check('W3 a positive line cannot RECEIVE the goods it claims to destroy',
    positive instanceof BadRequestException && /negative/.test(positive.message), positive?.message ?? 'no error');
  check('W3 the shelf is untouched', (await shelfQuantity(store.id, item.id)) === 100);

  // ============================================== W4  the draft
  console.log('\n[W4] the draft names the loss, the lot and the shelf, and moves nothing');
  const draft = await documents.create(companyId, branch.id, maker.id, {
    kind: 'WRITE_OFF',
    documentDate: '2052-03-02',
    reason: 'water damage in the back room',
    toWarehouseId: store.id,
    lines: [{ itemId: item.id, quantity: -10, batchId: lot.batchId, storageLocationId: bin.id }],
  });
  // `status` crosses the API in lower case - it is what the screen and the
  // Flutter model read (`stockDocumentStatus`), and the row in PostgreSQL is
  // the upper-case enum. Both are checked, so neither can drift alone.
  check('W4 it is a draft with a WO number', draft.status === 'draft' && draft.kind === 'write_off' &&
    /^WO-/.test(draft.documentNumber), `${draft.status}/${draft.kind} ${draft.documentNumber}`);
  const draftRow = await prisma.stockDocument.findUnique({ where: { id: draft.id }, select: { status: true } });
  check('W4 the database row is the DRAFT enum', draftRow.status === 'DRAFT', draftRow.status);
  check('W4 the line carries the lot and the shelf',
    draft.lines[0].batchNumber === savedLot.batchNumber && draft.lines[0].storageLocationId === bin.id,
    `${draft.lines[0].batchNumber} / ${draft.lines[0].storageLocationId}`);
  check('W4 nothing left the shelf yet', (await shelfQuantity(store.id, item.id)) === 100);

  // ============================================== W5  no posting before approval
  console.log('\n[W5] posting an unapproved write-off is refused');
  const early = await refusal(() => documents.post(companyId, maker.id, draft.id));
  check('W5 refused, and it says why', early instanceof BadRequestException && /approved/i.test(early.message),
    early?.message ?? 'no error');

  // ============================================== W6  maker cannot approve
  console.log('\n[W6] the person who recorded it cannot approve it');
  const selfApprove = await refusal(() => documents.approve(companyId, maker.id, draft.id));
  check('W6 refused', selfApprove instanceof BadRequestException, selfApprove?.message ?? 'no error');
  const stillDraft = await prisma.stockDocument.findUnique({ where: { id: draft.id } });
  check('W6 nothing was approved', stillDraft.approvedAt === null);

  // ============================================== W7  somebody else approves
  console.log('\n[W7] a second person approves, and the paper says who');
  const approved = await documents.approve(companyId, approver.id, draft.id);
  const approvedRow = await prisma.stockDocument.findUnique({ where: { id: draft.id } });
  check('W7 the approval is recorded with its name',
    approvedRow.approvedBy === approver.id && approvedRow.approvedAt !== null,
    String(approvedRow.approvedBy));
  check('W7 the approver reads back from the document', approved.approvedByName?.length > 0,
    approved.approvedByName ?? 'missing');

  // ============================================== W8  once only
  console.log('\n[W8] approving twice is refused');
  const twice = await refusal(() => documents.approve(companyId, outsider.id, draft.id));
  check('W8 the second approval is refused', twice instanceof BadRequestException, twice?.message ?? 'no error');
  const afterTwice = await prisma.stockDocument.findUnique({ where: { id: draft.id } });
  check('W8 the first approver still stands', afterTwice.approvedBy === approver.id);

  // ============================================== W9  posting
  console.log('\n[W9] posting takes the goods out of the shelf, the lot and the books');
  const posted = await documents.post(companyId, maker.id, draft.id);
  check('W9 the document is posted', posted.status === 'posted', posted.status);
  const postedRow = await prisma.stockDocument.findUnique({ where: { id: draft.id }, select: { status: true } });
  check('W9 the database row is the POSTED enum', postedRow.status === 'POSTED', postedRow.status);
  check('W9 the shelf lost exactly 10', (await shelfQuantity(store.id, item.id)) === 90,
    String(await shelfQuantity(store.id, item.id)));
  const lotAfter = await prisma.itemBatch.findUnique({ where: { id: lot.batchId } });
  check('W9 the lot lost exactly 10', Number(lotAfter.remainingQuantity) === 90, String(lotAfter.remainingQuantity));
  const writeOffMove = await prisma.stockMovement.findFirst({
    where: { companyId, referenceType: 'STOCK_WRITE_OFF', referenceId: draft.id },
  });
  // The movement carries the lot and the shelf the paper named, which is what
  // the shelf card and the lot card are read from.
  check('W9 the movement says OUT, 10, in the right store', writeOffMove?.direction === 'OUT' &&
    Number(writeOffMove.quantity) === 10 && writeOffMove.warehouseId === store.id,
    `${writeOffMove?.direction} ${writeOffMove?.quantity} @ ${writeOffMove?.warehouseId}`);
  check('W9 the movement names the lot it destroyed', writeOffMove?.batchId === lot.batchId,
    String(writeOffMove?.batchId));
  check('W9 the movement names the shelf it left', writeOffMove?.storageLocationId === bin.id,
    String(writeOffMove?.storageLocationId));
  const journal = await prisma.stockDocument.findUnique({ where: { id: draft.id }, select: { journalEntryId: true } });
  check('W9 a journal entry was written', Boolean(journal?.journalEntryId));
  const lossLines = journal?.journalEntryId
    ? await prisma.journalLine.findMany({
        where: { journalEntryId: journal.journalEntryId, accountId: differenceAccount.id },
      })
    : [];
  const lossDebit = lossLines.reduce((sum, line) => sum + Number(line.debit), 0);
  check('W9 the loss of 10 x 5.00 = 50.00 reached account 5107', lossDebit === 50, lossDebit.toFixed(2));

  // ============================================== W10  idempotency
  console.log('\n[W10] the same idempotency key books one document, not two');
  const key = `wo-retry-${tag}`;
  const first = await documents.create(
    companyId,
    branch.id,
    maker.id,
    {
      kind: 'WRITE_OFF',
      documentDate: '2052-03-03',
      reason: 'broken cartons',
      toWarehouseId: store.id,
      lines: [{ itemId: item.id, quantity: -1, batchId: lot.batchId }],
    },
    { idempotencyKey: key },
  );
  const second = await documents.create(
    companyId,
    branch.id,
    maker.id,
    {
      kind: 'WRITE_OFF',
      documentDate: '2052-03-03',
      reason: 'broken cartons',
      toWarehouseId: store.id,
      lines: [{ itemId: item.id, quantity: -1, batchId: lot.batchId }],
    },
    { idempotencyKey: key },
  );
  check('W10 both calls answer with the same document', first.id === second.id, `${first.id} / ${second.id}`);
  check('W10 exactly one document exists for that key',
    (await prisma.stockDocument.count({ where: { companyId, idempotencyKey: key } })) === 1);

  // ============================================== W11  more than the lot holds
  console.log('\n[W11] writing off more than the lot holds is refused');
  const tooMuch = await documents.create(companyId, branch.id, maker.id, {
    kind: 'WRITE_OFF',
    documentDate: '2052-03-04',
    reason: 'a whole shelf gone',
    toWarehouseId: store.id,
    lines: [{ itemId: item.id, quantity: -500, batchId: lot.batchId }],
  });
  await documents.approve(companyId, approver.id, tooMuch.id);
  const overdrawn = await refusal(() => documents.post(companyId, maker.id, tooMuch.id));
  check('W11 refused when the lot cannot cover it', overdrawn !== null, overdrawn?.message ?? 'no error');
  const lotAfterOverdraw = await prisma.itemBatch.findUnique({ where: { id: lot.batchId } });
  check('W11 the lot is unchanged by the refusal', Number(lotAfterOverdraw.remainingQuantity) === 90,
    String(lotAfterOverdraw.remainingQuantity));

  // ============================================== T1..T7  the count
  console.log('\n[T1] open a count of the main store');
  const session = await stockTakes.start(companyId, maker.id, {
    branchId: branch.id,
    warehouseId: store.id,
    scope: 'FULL',
    notes: 'monthly count',
  });
  check('T1 the session is COUNTING and froze the book figure',
    session.status === 'COUNTING' && session.lines.every((line) => Number(line.systemQuantity) === 90),
    `${session.status}, ${session.lines.length} line(s)`);

  console.log('\n[T2] record 85 counted');
  const line = session.lines[0];
  const counted = await stockTakes.record(companyId, maker.id, session.id, {
    lines: [{ lineId: line.id, countedQuantity: 85 }],
    finish: true,
  });
  const varianceLine = counted.lines.find((row) => row.id === line.id);
  check('T2 the difference is -5, valued at -25.00',
    Number(varianceLine.varianceQuantity) === -5 && Number(varianceLine.varianceValue) === -25,
    `${varianceLine.varianceQuantity} / ${varianceLine.varianceValue}`);

  console.log('\n[T3] the person who opened the count cannot approve it');
  const countSelf = await refusal(() => stockTakes.approve(companyId, maker.id, session.id));
  check('T3 refused', countSelf instanceof BadRequestException, countSelf?.message ?? 'no error');

  console.log('\n[T4] a count is not posted before it is approved');
  const countEarly = await refusal(() => stockTakes.post(companyId, maker.id, session.id));
  check('T4 refused', countEarly instanceof BadRequestException, countEarly?.message ?? 'no error');

  console.log('\n[T5] somebody else approves, then the difference is posted');
  await stockTakes.approve(companyId, approver.id, session.id);
  const countPosted = await stockTakes.post(companyId, approver.id, session.id);
  check('T5 the session is POSTED', countPosted.status === 'POSTED', countPosted.status);
  check('T5 the shelf now holds 85', (await shelfQuantity(store.id, item.id)) === 85,
    String(await shelfQuantity(store.id, item.id)));
  // A count posts one ADJUSTMENT linked back to the session - `COUNT` is the
  // kind the stock-document route reserves for a document typed as a count,
  // and the take uses the adjustment so the difference lands in 5107.
  const countDoc = await prisma.stockDocument.findFirst({
    where: { companyId, stockTakeSessionId: session.id },
    include: { lines: true },
  });
  check('T5 the count produced one adjustment document with an entry',
    Boolean(countDoc) && countDoc.kind === 'ADJUSTMENT' && countDoc.status === 'POSTED' &&
      Boolean(countDoc.journalEntryId),
    `${countDoc?.kind} ${countDoc?.status} ${countDoc?.documentNumber ?? 'missing'}`);
  const sessionRow = await prisma.stockTakeSession.findUnique({
    where: { id: session.id },
    select: { documentId: true, journalEntryId: true },
  });
  check('T5 the session remembers the document and its entry',
    sessionRow.documentId === countDoc?.id && sessionRow.journalEntryId === countDoc?.journalEntryId,
    String(sessionRow.documentId));
  check('T5 the document line says -5', countDoc && Number(countDoc.lines[0].quantity) === -5,
    String(countDoc?.lines?.[0]?.quantity));

  console.log('\n[T6] posting the count twice is refused');
  const countTwice = await refusal(() => stockTakes.post(companyId, approver.id, session.id));
  check('T6 refused', countTwice instanceof BadRequestException, countTwice?.message ?? 'no error');
  check('T6 the shelf did not move again', (await shelfQuantity(store.id, item.id)) === 85);

  console.log('\n[T7] the lot followed the count too');
  const lotAfterCount = await prisma.itemBatch.findUnique({ where: { id: lot.batchId } });
  check('T7 the lot holds 85', Number(lotAfterCount.remainingQuantity) === 85,
    String(lotAfterCount.remainingQuantity));

  // ============================================== P1..P2  warehouse rights
  console.log('\n[P1] the rows the access screen writes are the rows the guard reads');
  const granted = await access.setForUser(companyId, approver.id, maker.id, [
    {
      warehouseId: store.id,
      canView: true,
      canReceive: true,
      canIssue: true,
      canCount: true,
      canApprove: false,
      canSeeCost: false,
    },
  ]);
  void granted;
  const rowsForMaker = await prisma.userWarehouseAccess.findMany({ where: { companyId, userId: maker.id } });
  const makerGrants = rowsForMaker.map((row) => ({
    warehouseId: row.warehouseId,
    canView: row.canView,
    canReceive: row.canReceive,
    canIssue: row.canIssue,
    canTransfer: row.canTransfer,
    canCount: row.canCount,
    canApprove: row.canApprove,
    canSeeCost: row.canSeeCost,
  }));
  const makerUser = { userId: maker.id, isSuperAdmin: false, warehouseAccess: makerGrants };
  check('P1 the restricted user may issue from the main store', may(makerUser, store.id, 'issue'));
  check('P1 the same user is refused in the cage', !may(makerUser, cage.id, 'issue'));
  check('P1 and may not see its cost', !may(makerUser, store.id, 'cost') && !may(makerUser, cage.id, 'cost'));
  const outsiderUser = { userId: outsider.id, isSuperAdmin: false, warehouseAccess: [] };
  check('P1 a person with no rows is unrestricted, as before', may(outsiderUser, cage.id, 'receive'));
  let refused = null;
  try {
    // The very function every warehouse controller calls.
    const { assertWarehouseAccess } = await import('../dist/src/common/warehouse/warehouse-access.js');
    assertWarehouseAccess(makerUser, cage.id, 'receive');
  } catch (error) {
    refused = error;
  }
  check('P1 the guard throws for the cage rather than hiding a button', refused instanceof ForbiddenException,
    refused?.message?.slice(0, 60) ?? 'no error');

  console.log('\n[P2] the screen reads the same rows back');
  const profile = await access.forUser(companyId, maker.id);
  check('P2 the profile is restricted to one warehouse',
    profile.restricted === true && profile.grants.length === 1 && profile.grants[0].warehouseId === store.id,
    `${profile.grants.length} grant(s)`);
  check('P2 the grant says what it allows', profile.grants[0].canIssue === true && profile.grants[0].canApprove === false);

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
