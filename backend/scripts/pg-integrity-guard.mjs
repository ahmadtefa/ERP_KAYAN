/**
 * REAL PostgreSQL integrity guard (classification B) for the accounting and
 * inventory invariants around stock documents.
 *
 * Accepted flow  : source and destination quantities, stock value and the
 *                   OUT/IN movement pair are checked; internal transfers are
 *                   asserted to create NO journal entry (the same company's
 *                   inventory only changes location - the production design
 *                   says no value is created or destroyed).
 * Rejected flow  : a transfer beyond availability must change nothing - no
 *                   movement, no balance change, no journal, no status change.
 * Adjustment flow: a value-changing adjustment must post exactly one balanced
 *                   journal entry, and the duplicate-source guard must refuse
 *                   a second posting of the same document.
 * Company-wide   : every posted entry balances, no posted entry sits in a
 *                   closed period, and each source document has at most one
 *                   non-reversal entry.
 *
 * All services are the production classes on a REAL PostgreSQL 18 server.
 *
 * Usage: DATABASE_URL=... node scripts/pg-integrity-guard.mjs
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
import { BankReconciliationService } from '../dist/src/modules/cash/bank-reconciliation.service.js';

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
const num = (v) => Number(v);
const dec = (v) => new Prisma.Decimal(v);

function makeClient(applicationName) {
  const u = new URL(DB_URL);
  u.searchParams.set('application_name', applicationName);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: u.toString() }) });
}

async function main() {
  const prisma = makeClient('guard-integ');
  const company = await prisma.company.findFirst({ where: { isActive: true } });
  if (!company) throw new Error('No active company in kayan_test');
  const companyId = company.id;
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      companyId,
      username: `integ-guard-${suffix}`,
      fullNameEn: 'Integrity guard',
      fullNameAr: 'حارس السلامة',
      passwordHash: 'guard-placeholder-not-a-real-credential',
    },
  });
  const userId = user.id;
  console.log(`Company ${company.code}, run suffix ${suffix}`);

  // Real production service graph.
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

  // ------------------------------------------------------------- seed world
  const branch = await prisma.branch.create({
    data: { companyId, code: `IG-${suffix}`, nameEn: `IG ${suffix}`, nameAr: `فرع ${suffix}`, kind: 'HEADQUARTERS' },
  });
  const branchDst = await prisma.branch.create({
    data: { companyId, code: `IGD-${suffix}`, nameEn: `IG destination ${suffix}`, nameAr: `فرع وجهة ${suffix}`, kind: 'BRANCH' },
  });
  const wSrc = await prisma.warehouse.create({
    data: { companyId, branchId: branch.id, code: `IGS-${suffix}`, nameEn: 'IG source', nameAr: 'مصدر' },
  });
  const wLocal = await prisma.warehouse.create({
    data: { companyId, branchId: branch.id, code: `IGL-${suffix}`, nameEn: 'IG local', nameAr: 'مخزن محلي' },
  });
  const wDst = await prisma.warehouse.create({
    data: { companyId, branchId: branchDst.id, code: `IGD-${suffix}`, nameEn: 'IG dest', nameAr: 'وجهة' },
  });
  const item = await prisma.item.create({
    data: { companyId, code: `IGITEM-${suffix}`, nameEn: 'IG item', nameAr: 'صنف', unit: 'piece' },
  });
  // Exact AccountMap codes: 1104 inventory, 5107 inventory difference.
  for (const [code, name, type] of [
    ['1104', 'IG inventory', 'ASSET'],
    ['5107', 'IG inventory difference', 'EXPENSE'],
  ]) {
    await prisma.account.create({
      data: { companyId, code, nameEn: name, nameAr: name, type, isPostable: true, isActive: true },
    }).catch((e) => {
      if (e.code !== 'P2002') throw e; // codes may already exist from another harness run
    });
  }
  await prisma.fiscalPeriod.create({
    data: {
      companyId,
      code: `IG2051-${suffix}`,
      nameEn: `IG 2051`,
      nameAr: 'سنة 2051',
      startDate: new Date('2051-01-01T00:00:00.000Z'),
      endDate: new Date('2051-12-31T00:00:00.000Z'),
      status: 'OPEN',
    },
  });
  await prisma.stockBalance.create({
    data: { companyId, branchId: branch.id, itemId: item.id, quantity: dec(10), value: dec(75) },
  });
  await prisma.stockMovement.create({
    data: {
      companyId, branchId: branch.id, warehouseId: wSrc.id, itemId: item.id,
      movementDate: new Date('2051-01-05T00:00:00.000Z'), direction: 'IN',
      quantity: dec(10), unitCost: dec(7.5), totalCost: dec(75), referenceType: 'SEED',
    },
  });

  async function makeDocument(kind, line, extra = {}) {
    const doc = await prisma.stockDocument.create({
      data: {
        companyId,
        branchId: branch.id,
        kind,
        documentNumber: `IG-${kind.slice(0, 3)}-${randomUUID().slice(0, 8)}`,
        documentDate: new Date('2051-06-01T00:00:00.000Z'),
        status: 'DRAFT',
        ...extra,
      },
    });
    await prisma.stockDocumentLine.create({
      data: { id: randomUUID(), documentId: doc.id, itemId: item.id, lineNumber: 1, ...line },
    });
    return doc;
  }

  const jeCount = () =>
    prisma.journalEntry.count({ where: { companyId, entryNumber: { startsWith: 'JV' } } });
  const movementsOf = (docId) =>
    prisma.stockMovement.findMany({ where: { companyId, referenceId: docId }, orderBy: { direction: 'asc' } });

  // ================================================ I1 rejected transfer
  console.log('\n[I1] transfer beyond availability changes nothing');
  const rejected = await makeDocument(
    'TRANSFER',
    { quantity: dec(15), unitCost: dec(7.5) },
    { fromBranchId: branch.id, toBranchId: branch.id, fromWarehouseId: wSrc.id, toWarehouseId: wLocal.id },
  );
  const before = {
    movements: await prisma.stockMovement.count({ where: { companyId, itemId: item.id } }),
    sourceBalance: await prisma.stockBalance.findUnique({
      where: { companyId_branchId_itemId: { companyId, branchId: branch.id, itemId: item.id } },
    }),
    journals: await jeCount(),
  };
  let rejectErr = null;
  try {
    await stock.post(companyId, userId, rejected.id);
  } catch (e) {
    rejectErr = e;
  }
  check('I1 over-quantity transfer rejected (BadRequest)',
    rejectErr instanceof BadRequestException && /Not enough stock/.test(rejectErr.message),
    rejectErr?.message);
  const afterReject = {
    movements: await prisma.stockMovement.count({ where: { companyId, itemId: item.id } }),
    sourceBalance: await prisma.stockBalance.findUnique({
      where: { companyId_branchId_itemId: { companyId, branchId: branch.id, itemId: item.id } },
    }),
    journals: await jeCount(),
  };
  check('I1 no stock movement written', afterReject.movements === before.movements,
    `before=${before.movements} after=${afterReject.movements}`);
  check('I1 source balance untouched (qty 10, value 75)',
    num(afterReject.sourceBalance.quantity) === 10 && num(afterReject.sourceBalance.value) === 75);
  check('I1 no journal entry created', afterReject.journals === before.journals);
  const rejectedDoc = await prisma.stockDocument.findUnique({ where: { id: rejected.id } });
  check('I1 document stays DRAFT with no journal link',
    rejectedDoc.status === 'DRAFT' && rejectedDoc.journalEntryId === null, rejectedDoc.status);
  check('I1 rejected document produced no movements at all',
    (await movementsOf(rejected.id)).length === 0);

  // ================================================ I2 accepted transfer
  console.log('\n[I2] accepted transfer conserves quantity and value and writes no journal');
  const accepted = await makeDocument(
    'TRANSFER',
    { quantity: dec(4), unitCost: dec(7.5) },
    // Cross-branch: document.branchId is the target branch by production design.
    { branchId: branchDst.id, fromBranchId: branch.id, toBranchId: branchDst.id, fromWarehouseId: wSrc.id, toWarehouseId: wDst.id },
  );
  const journalsBeforeAccepted = await jeCount();
  await stock.post(companyId, userId, accepted.id);
  const acceptedMoves = await movementsOf(accepted.id);
  check('I2 exactly one OUT and one IN movement, referencing the document',
    acceptedMoves.length === 2 &&
    acceptedMoves.some((m) => m.direction === 'OUT' && m.referenceType === 'STOCK_TRANSFER_OUT') &&
    acceptedMoves.some((m) => m.direction === 'IN' && m.referenceType === 'STOCK_TRANSFER_IN'));
  const out = acceptedMoves.find((m) => m.direction === 'OUT');
  const inn = acceptedMoves.find((m) => m.direction === 'IN');
  check('I2 both legs carry the same quantity (4) and carrying cost (30)',
    num(out.quantity) === 4 && num(inn.quantity) === 4 &&
    num(out.totalCost) === 30 && num(inn.totalCost) === 30);
  const balances = await prisma.stockBalance.findMany({ where: { companyId, itemId: item.id } });
  const totalQty = balances.reduce((s, b) => s + num(b.quantity), 0);
  const totalValue = balances.reduce((s, b) => s + num(b.value), 0);
  check('I2 company-wide quantity conserved at 10 and value at 75',
    totalQty === 10 && totalValue === 75, `qty=${totalQty} value=${totalValue}`);
  // stock_balances is branch-granular (no warehouse column): one row per branch.
  const srcAfter = await prisma.stockBalance.findUnique({
    where: { companyId_branchId_itemId: { companyId, branchId: branch.id, itemId: item.id } },
  });
  const dstAfter = await prisma.stockBalance.findUnique({
    where: { companyId_branchId_itemId: { companyId, branchId: branchDst.id, itemId: item.id } },
  });
  check('I2 source branch reduced to 6 units / 45 value',
    num(srcAfter.quantity) === 6 && num(srcAfter.value) === 45,
    `qty=${srcAfter.quantity} value=${srcAfter.value}`);
  check('I2 destination branch now holds the transferred 4 units / 30 value',
    dstAfter && num(dstAfter.quantity) === 4 && num(dstAfter.value) === 30,
    dstAfter ? `qty=${dstAfter.quantity} value=${dstAfter.value}` : 'no destination balance');
  const acceptedDoc = await prisma.stockDocument.findUnique({ where: { id: accepted.id } });
  check('I2 document POSTED and carries NO journal entry (internal transfer design)',
    acceptedDoc.status === 'POSTED' && acceptedDoc.journalEntryId === null);
  check('I2 no journal entry appeared in the ledger',
    (await jeCount()) === journalsBeforeAccepted);

  // ================================================ I3 double-post guard
  console.log('\n[I3] a posted document cannot be posted twice');
  let doublePostErr = null;
  try {
    await stock.post(companyId, userId, accepted.id);
  } catch (e) {
    doublePostErr = e;
  }
  check('I3 second post rejected',
    doublePostErr instanceof BadRequestException && /Only a draft/.test(doublePostErr.message),
    doublePostErr?.message);
  check('I3 still exactly one movement pair', (await movementsOf(accepted.id)).length === 2);

  // ================================================ I4 adjustment journals
  console.log('\n[I4] value-changing adjustment posts one balanced journal entry');
  const adjustment = await makeDocument('ADJUSTMENT', { quantity: dec(2), unitCost: dec(8) }, {
    toWarehouseId: wLocal.id,
  });
  await stock.post(companyId, userId, adjustment.id);
  const adjDoc = await prisma.stockDocument.findUnique({ where: { id: adjustment.id } });
  check('I4 adjustment linked to a journal entry', adjDoc.journalEntryId !== null);
  const adjEntry = await prisma.journalEntry.findUnique({
    where: { id: adjDoc.journalEntryId },
    include: { lines: true },
  });
  check('I4 entry is POSTED, sourced from this document, balanced (16 = 16)',
    adjEntry.status === 'POSTED' && adjEntry.sourceType === 'STOCK_DOCUMENT' &&
    adjEntry.sourceId === adjustment.id &&
    num(adjEntry.totalDebit) === 16 && num(adjEntry.totalCredit) === 16 &&
    adjEntry.lines.reduce((s, l) => s + num(l.debit), 0) ===
    adjEntry.lines.reduce((s, l) => s + num(l.credit), 0));
  let secondAdjustErr = null;
  try {
    await stock.post(companyId, userId, adjustment.id);
  } catch (e) {
    secondAdjustErr = e;
  }
  check('I4 duplicate adjustment posting refused by the draft-status claim',
    secondAdjustErr instanceof BadRequestException);
  const sameSource = await prisma.journalEntry.count({
    where: { companyId, sourceType: 'STOCK_DOCUMENT', sourceId: adjustment.id, reversalOfId: null },
  });
  check('I4 exactly one non-reversal entry for the source document', sameSource === 1, `count=${sameSource}`);

  // ================================================ A1-A4 company-wide
  console.log('\n[A] company-wide accounting invariants');
  const unbalanced = await prisma.$queryRaw`
    SELECT count(*)::int n FROM journal_entries
     WHERE "companyId" = ${companyId}::uuid AND status IN ('POSTED','REVERSED')
       AND "totalDebit" <> "totalCredit"`;
  check('A1 every posted/reversed journal entry balances', num(unbalanced[0].n) === 0);
  // Entries that pre-date a closure are legitimate history. The rule is that
  // nothing may be INSERTED as POSTED after the period closed (enforced live by
  // the kayan_require_open_fiscal_period trigger), so compare creation time.
  const closedViolations = await prisma.$queryRaw`
    SELECT count(*)::int n FROM journal_entries e
      JOIN fiscal_periods p ON p."companyId" = e."companyId"
       AND e."entryDate" BETWEEN p."startDate" AND p."endDate"
     WHERE e."companyId" = ${companyId}::uuid AND e.status = 'POSTED' AND p.status = 'CLOSED'
       AND p."closedAt" IS NOT NULL AND e."createdAt" > p."closedAt"
       AND e."sourceType" IS DISTINCT FROM 'YEAR_END_CLOSE'`;
  check('A2 no ordinary POSTED entry inserted into a period after it was closed',
    num(closedViolations[0].n) === 0, `violations=${closedViolations[0].n}`);
  const duplicates = await prisma.$queryRaw`
    SELECT count(*)::int n FROM (
      SELECT "sourceType", "sourceId" FROM journal_entries
       WHERE "companyId" = ${companyId}::uuid AND "sourceType" IS NOT NULL
         AND "reversalOfId" IS NULL AND status IN ('POSTED','REVERSED')
       GROUP BY "sourceType", "sourceId" HAVING count(*) > 1
    ) d`;
  check('A3 no source document has two non-reversal entries', num(duplicates[0].n) === 0,
    `duplicates=${duplicates[0].n}`);

  // Rejected reconciliation must leave no trace either.
  const recBefore = await prisma.bankReconciliation.count({ where: { companyId } });
  const br = new BankReconciliationService(prisma, audit);
  let brErr = null;
  try {
    await br.create(companyId, userId, {
      cashAccountId: randomUUID(),
      statementDate: '2051-07-31',
      periodFrom: '2051-07-01',
      periodTo: '2051-07-31',
      statementBalance: '100',
    });
  } catch (e) {
    brErr = e;
  }
  check('A4 rejected reconciliation writes no row',
    brErr instanceof BadRequestException &&
    (await prisma.bankReconciliation.count({ where: { companyId } })) === recBefore);

  await prisma.$disconnect();

  console.log(`\nINTEGRITY GUARD: ${pass} PASS / ${fail} FAIL`);
  if (fail > 0) {
    console.log('Failed checks:', failures.join('; '));
    process.exit(1);
  }
  console.log('ALL INTEGRITY CHECKS PASSED');
}

main().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
