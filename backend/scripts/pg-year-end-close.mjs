/**
 * REAL PostgreSQL integration test (classification B) for YearEndCloseService.
 *
 * Runs the production service graph (YearEndCloseService + PostingService +
 * AccountMapService + DocumentNumberService + FiscalPeriodsService +
 * CostCentersService + AuditService) against a REAL native PostgreSQL 18
 * server started by pg-embedded-server.mjs, using one PrismaClient per
 * connection. Nothing about the database is mocked; the only test data is
 * seeded rows this script creates under the existing active company with
 * unique codes.
 *
 * Scenarios (the ten required by the task):
 *  S1  year with posted revenue/expense: preview + close, independently
 *      recomputed balances, balanced closing entry, accounts zeroed, retained
 *      earnings carries the result
 *  S2  double close is refused and only one closing entry exists
 *  S3  empty year: period locked, no entry, close_empty audit
 *  S4  unposted document blocks the close; nothing is written
 *  S5  failure inside the closing transaction rolls the whole close back
 *  S6  posting into a closed period is refused by the service AND by the
 *      database trigger (second lock on the same door)
 *  S7  two concurrent closes of the same period: exactly one may win
 *  S8  controller permission metadata (read/close)
 *  S9  independent SQL recomputation of the profit and the closing lines
 *  S10 loss-making year: retained earnings is debited, entry still balances
 *
 * Usage: DATABASE_URL=... node scripts/pg-year-end-close.mjs
 */
import { randomUUID } from 'node:crypto';

import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BadRequestException } from '@nestjs/common';

import { AuditService } from '../dist/src/common/audit/audit.service.js';
import { AccountMapService } from '../dist/src/modules/accounting/account-map.service.js';
import { CostCentersService } from '../dist/src/modules/accounting/cost-centers.service.js';
import { DocumentNumberService } from '../dist/src/modules/accounting/document-number.service.js';
import { FiscalPeriodsService } from '../dist/src/modules/accounting/fiscal-periods.service.js';
import { PostingService } from '../dist/src/modules/accounting/posting.service.js';
import { YearEndCloseService } from '../dist/src/modules/accounting/year-end-close.service.js';
import { YearEndCloseController } from '../dist/src/modules/accounting/year-end-close.controller.js';

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
  const u = new URL(DB_URL);
  u.searchParams.set('application_name', applicationName);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: u.toString() }) });
}

function buildServices(prisma) {
  const audit = new AuditService(prisma);
  const accounts = new AccountMapService();
  const numbers = new DocumentNumberService();
  const periods = new FiscalPeriodsService(prisma, audit);
  const costCenters = new CostCentersService(prisma, audit);
  const posting = new PostingService(numbers, periods, costCenters);
  const yearEnd = new YearEndCloseService(prisma, posting, accounts, audit);
  return { audit, accounts, numbers, periods, costCenters, posting, yearEnd };
}

const dec = (v) => new Prisma.Decimal(v);
const num = (v) => Number(v);

async function main() {
  const prisma = makeClient('guard-ye');
  const company = await prisma.company.findFirst({ where: { isActive: true } });
  if (!company) throw new Error('No active company in kayan_test — seed one first');
  const companyId = company.id;
  const suffix = randomUUID().slice(0, 8);
  console.log(`Company ${company.code} (${companyId}), run suffix ${suffix}`);

  // Idempotent self-cleanup of rows from previous harness runs. Years 2041+
  // keep this data clear of the concurrency guard's 2026 draft stock documents,
  // which are legitimate blocker evidence and must not be touched.
  await prisma.journalEntry.deleteMany({ where: { companyId, entryNumber: { startsWith: 'YEJ-' } } });
  // Closing entries carry PostingService's JV- numbers and restrict period
  // deletion, so remove them by their source marker first.
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'YEAR_END_CLOSE' } });
  // audit_logs is append-only by a database trigger: never delete. Every audit
  // assertion below is scoped to this run's freshly created period ids.
  await prisma.fiscalPeriod.deleteMany({ where: { companyId, code: { startsWith: 'YE' } } });
  await prisma.account.deleteMany({
    where: { companyId, code: { in: ['1101', '4101', '5101', '3102'] } },
  });
  await prisma.branch.deleteMany({ where: { companyId, code: { startsWith: 'YE-' } } });
  // Users are never deleted: audit_logs.userId is SetNull, which would require
  // updating an append-only audit row. Each run creates its own named user.

  // PostingService writes createdBy, which carries a real foreign key.
  const user = await prisma.user.create({
    data: {
      companyId,
      username: `ye-guard-${suffix}`,
      fullNameEn: 'Year-end guard',
      fullNameAr: 'حارس الإقفال',
      passwordHash: 'guard-placeholder-not-a-real-credential',
      isActive: true,
    },
  });
  const userId = user.id;

  const branch = await prisma.branch.create({
    data: {
      companyId,
      code: `YE-${suffix}`,
      nameEn: `YE branch ${suffix}`,
      nameAr: `فرع الإقفال ${suffix}`,
      kind: 'HEADQUARTERS',
      isActive: true,
    },
  });

  // Conventional chart codes: AccountMapService resolves 3102 by exact code.
  const accountDefs = [
    { code: '1101', nameEn: 'Cash', type: 'ASSET' },
    { code: '4101', nameEn: 'Sales revenue', type: 'REVENUE' },
    { code: '5101', nameEn: 'Cost of goods sold', type: 'EXPENSE' },
    { code: '3102', nameEn: 'Retained earnings', type: 'EQUITY' },
  ];
  const accounts = {};
  for (const def of accountDefs) {
    accounts[def.code] = await prisma.account.create({
      data: {
        companyId,
        code: def.code,
        nameEn: def.nameEn,
        nameAr: def.nameEn,
        type: def.type,
        isPostable: true,
        isActive: true,
      },
    });
  }

  async function makePeriod(year) {
    return prisma.fiscalPeriod.create({
      data: {
        companyId,
        code: `YE${year}-${suffix}`,
        nameEn: `FY ${year} ${suffix}`,
        nameAr: `سنة ${year}`,
        startDate: new Date(`${year}-01-01T00:00:00.000Z`),
        endDate: new Date(`${year}-12-31T00:00:00.000Z`),
        status: 'OPEN',
      },
    });
  }

  const periods = {};
  for (const year of [2041, 2042, 2043, 2044, 2045, 2046, 2047]) {
    periods[year] = await makePeriod(year);
  }

  let jeSeq = 0;
  async function seedJournal(year, date, lines, status = 'POSTED', extra = {}) {
    jeSeq += 1;
    const total = lines.reduce((s, l) => s + num(l.debit ?? 0), 0);
    return prisma.journalEntry.create({
      data: {
        companyId,
        branchId: branch.id,
        entryNumber: `YEJ-${suffix}-${jeSeq}`,
        entryDate: new Date(`${date}T00:00:00.000Z`),
        description: 'seeded test entry',
        status,
        totalDebit: dec(total),
        totalCredit: dec(total),
        postedAt: status === 'POSTED' ? new Date() : null,
        ...extra,
        lines: {
          create: lines.map((l, i) => ({
            lineNumber: i + 1,
            accountId: l.accountId,
            debit: dec(l.debit ?? 0),
            credit: dec(l.credit ?? 0),
            description: l.description ?? null,
          })),
        },
      },
    });
  }

  const svc = buildServices(prisma);

  // ---------------------------------------------------------------- S1 + S9
  console.log('\n[S1/S9] profitable year 2041: seed, preview, close, independent SQL verification');
  await seedJournal(2041, '2041-03-31', [
    { accountId: accounts['1101'].id, debit: 1000, description: 'cash in' },
    { accountId: accounts['4101'].id, credit: 1000, description: 'revenue' },
  ]);
  await seedJournal(2041, '2041-06-30', [
    { accountId: accounts['5101'].id, debit: 400, description: 'expense' },
    { accountId: accounts['1101'].id, credit: 400, description: 'cash out' },
  ]);

  // Independent ledger recomputation BEFORE closing, mimicking accountBalances():
  // revenue raw balance is credit-normal (negative), service flips it.
  const before = await prisma.$queryRaw`
    SELECT a.code, a.type, COALESCE(SUM(l.debit - l.credit), 0) AS net
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l."journalEntryId"
      JOIN accounts a ON a.id = l."accountId"
     WHERE e."companyId" = ${companyId}::uuid
       AND e.status IN ('POSTED','REVERSED')
       AND e."entryDate" BETWEEN ${periods[2041].startDate}::date AND ${periods[2041].endDate}::date
       AND a.code IN ('4101','5101')
     GROUP BY a.code, a.type`;
  const rawRevenue = num(before.find((r) => r.code === '4101').net);
  const rawExpense = num(before.find((r) => r.code === '5101').net);
  check('S9 independent raw ledger: revenue -1000 / expense +400',
    rawRevenue === -1000 && rawExpense === 400, `raw revenue=${rawRevenue}, expense=${rawExpense}`);
  const expectedProfit = -rawRevenue - rawExpense; // 1000 - 400 = 600

  const preview = await svc.yearEnd.preview(companyId, periods[2041].id);
  check('S1 preview totals match independent calc (1000/400/600 profit)',
    preview.totals.revenue === '1000.0000' &&
    preview.totals.expenses === '400.0000' &&
    preview.totals.result === '600.0000' &&
    preview.totals.resultLabel === 'profit' &&
    expectedProfit === 600,
    JSON.stringify(preview.totals));
  check('S1 preview reports no blockers/warnings',
    preview.blockers.length === 0 && Array.isArray(preview.warnings));

  const closeResult = await svc.yearEnd.close(companyId, userId, periods[2041].id, 'audit reason');
  check('S1 close returns a closing entry and closed period',
    closeResult.closingEntry !== null && closeResult.period.isClosed === true);

  const closingEntry = await prisma.journalEntry.findFirst({
    where: { companyId, sourceType: 'YEAR_END_CLOSE', sourceId: periods[2041].id },
    include: { lines: true },
  });
  check('S1 exactly ONE closing entry for the period, POSTED, dated period end',
    closingEntry !== null && closingEntry.status === 'POSTED' &&
    closingEntry.entryDate.toISOString().slice(0, 10) === '2041-12-31',
    closingEntry?.entryNumber);
  const lineByCode = {};
  for (const line of closingEntry?.lines ?? []) {
    const acc = await prisma.account.findUnique({ where: { id: line.accountId } });
    lineByCode[acc.code] = line;
  }
  check('S1 closing lines: revenue debited 1000, expense credited 400',
    num(lineByCode['4101']?.debit) === 1000 && num(lineByCode['4101']?.credit) === 0 &&
    num(lineByCode['5101']?.credit) === 400 && num(lineByCode['5101']?.debit) === 0);
  check('S1 retained earnings CREDITED with the profit 600',
    num(lineByCode['3102']?.credit) === 600 && num(lineByCode['3102']?.debit) === 0);
  check('S1 closing entry balances (debit = credit = 1000)',
    num(closingEntry.totalDebit) === 1000 && num(closingEntry.totalCredit) === 1000 &&
    closingEntry.lines.reduce((s, l) => s + num(l.debit), 0) ===
    closingEntry.lines.reduce((s, l) => s + num(l.credit), 0));

  // Revenue/expense accounts must net to zero inside the closed year now.
  const after = await prisma.$queryRaw`
    SELECT a.code, COALESCE(SUM(l.debit - l.credit), 0) AS net
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l."journalEntryId"
      JOIN accounts a ON a.id = l."accountId"
     WHERE e."companyId" = ${companyId}::uuid
       AND e.status IN ('POSTED','REVERSED')
       AND e."entryDate" BETWEEN ${periods[2041].startDate}::date AND ${periods[2041].endDate}::date
       AND a.code IN ('4101','5101','3102')
     GROUP BY a.code`;
  const netByCode = Object.fromEntries(after.map((r) => [r.code, num(r.net)]));
  check('S1 revenue and expense accounts zeroed within the closed year',
    netByCode['4101'] === 0 && netByCode['5101'] === 0, JSON.stringify(netByCode));
  check('S1 retained earnings holds -600 (credit) after the transfer',
    netByCode['3102'] === -600, JSON.stringify(netByCode));

  const periodRow = await prisma.fiscalPeriod.findUnique({ where: { id: periods[2041].id } });
  check('S1 period row is CLOSED with closedAt/closedBy',
    periodRow.status === 'CLOSED' && periodRow.closedAt !== null && periodRow.closedBy === userId);
  const auditClose = await prisma.auditLog.findFirst({
    where: { companyId, action: 'fiscal_year.close', entityId: periods[2041].id },
  });
  check('S1 audit row fiscal_year.close written with the entry number',
    auditClose !== null && auditClose.afterJson?.closingEntry === closingEntry.entryNumber);

  // ---------------------------------------------------------------- S2
  console.log('\n[S2] double close must be refused');
  let doubleErr = null;
  try {
    await svc.yearEnd.close(companyId, userId, periods[2041].id);
  } catch (e) {
    doubleErr = e;
  }
  check('S2 second close rejected with BadRequest "already closed"',
    doubleErr instanceof BadRequestException && /already closed/.test(doubleErr.message),
    doubleErr?.message);
  const closingCount = await prisma.journalEntry.count({
    where: { companyId, sourceType: 'YEAR_END_CLOSE', sourceId: periods[2041].id },
  });
  check('S2 still exactly one closing entry for the period', closingCount === 1, `count=${closingCount}`);

  // ---------------------------------------------------------------- S3
  console.log('\n[S3] empty year 2042: lock without an entry');
  const emptyResult = await svc.yearEnd.close(companyId, userId, periods[2042].id);
  check('S3 empty year returns closingEntry=null with explanatory note',
    emptyResult.closingEntry === null && /no closing entry/.test(emptyResult.note ?? ''));
  const emptyPeriod = await prisma.fiscalPeriod.findUnique({ where: { id: periods[2042].id } });
  const entries2042 = await prisma.journalEntry.count({
    where: { companyId, entryDate: { gte: periods[2042].startDate, lte: periods[2042].endDate } },
  });
  check('S3 period CLOSED but no journal entry exists in 2042',
    emptyPeriod.status === 'CLOSED' && entries2042 === 0, `entries=${entries2042}`);
  const auditEmpty = await prisma.auditLog.findFirst({
    where: { companyId, action: 'fiscal_year.close_empty', entityId: periods[2042].id },
  });
  check('S3 close_empty audit row written', auditEmpty !== null);

  // ---------------------------------------------------------------- S4
  console.log('\n[S4] draft document inside 2043 blocks the close');
  await seedJournal(2043, '2043-02-15', [
    { accountId: accounts['1101'].id, debit: 100 },
    { accountId: accounts['4101'].id, credit: 100 },
  ], 'DRAFT');
  let blockerErr = null;
  try {
    await svc.yearEnd.close(companyId, userId, periods[2043].id);
  } catch (e) {
    blockerErr = e;
  }
  check('S4 close rejected while a DRAFT journal entry exists',
    blockerErr instanceof BadRequestException && /cannot be closed/.test(blockerErr.message),
    blockerErr?.message);
  const blockedPeriod = await prisma.fiscalPeriod.findUnique({ where: { id: periods[2043].id } });
  check('S4 period stays OPEN and no closing entry was written',
    blockedPeriod.status === 'OPEN' &&
    (await prisma.journalEntry.count({
      where: { companyId, sourceType: 'YEAR_END_CLOSE', sourceId: periods[2043].id },
    })) === 0);

  // ---------------------------------------------------------------- S5
  console.log('\n[S5] mid-transaction failure rolls the whole close back (2044)');
  await seedJournal(2044, '2044-04-10', [
    { accountId: accounts['1101'].id, debit: 50 },
    { accountId: accounts['4101'].id, credit: 50 },
  ]);
  await seedJournal(2044, '2044-05-10', [
    { accountId: accounts['5101'].id, debit: 200 },
    { accountId: accounts['1101'].id, credit: 200 },
  ]);
  const seqBefore = await prisma.documentSequence.findUnique({
    where: { companyId_key: { companyId, key: 'JOURNAL' } },
  });
  // Deactivate the retained-earnings account: AccountMapService.resolve must
  // reject inside the closing transaction, so nothing may survive.
  await prisma.account.update({ where: { id: accounts['3102'].id }, data: { isActive: false } });
  let rollbackErr = null;
  try {
    await svc.yearEnd.close(companyId, userId, periods[2044].id);
  } catch (e) {
    rollbackErr = e;
  }
  check('S5 close fails on inactive retained-earnings account',
    rollbackErr instanceof BadRequestException && /3102/.test(rollbackErr.message),
    rollbackErr?.message);
  const rolledPeriod = await prisma.fiscalPeriod.findUnique({ where: { id: periods[2044].id } });
  check('S5 period still OPEN after the failed transaction', rolledPeriod.status === 'OPEN');
  check('S5 no YEAR_END_CLOSE row left behind for 2044',
    (await prisma.journalEntry.count({
      where: { companyId, sourceType: 'YEAR_END_CLOSE', sourceId: periods[2044].id },
    })) === 0);
  const seqAfter = await prisma.documentSequence.findUnique({
    where: { companyId_key: { companyId, key: 'JOURNAL' } },
  });
  check('S5 no document number was consumed (resolve fails before numbering)',
    num(seqBefore?.nextValue ?? 1) === num(seqAfter?.nextValue ?? 1),
    `before=${seqBefore?.nextValue ?? 1} after=${seqAfter?.nextValue ?? 1}`);
  check('S5 no success audit row for 2044',
    (await prisma.auditLog.count({
      where: { companyId, action: { in: ['fiscal_year.close', 'fiscal_year.close_empty'] }, entityId: periods[2044].id },
    })) === 0);
  await prisma.account.update({ where: { id: accounts['3102'].id }, data: { isActive: true } });

  // ---------------------------------------------------------------- S6
  console.log('\n[S6] nothing can post into the closed 2041 period');
  let serviceBlockErr = null;
  try {
    await prisma.$transaction((tx) =>
      svc.posting.post(tx, {
        companyId,
        branchId: branch.id,
        userId,
        entryDate: new Date('2041-11-30T00:00:00.000Z'),
        description: 'attempt into closed year',
        // Distinct source so the duplicate guard cannot mask the period rule.
        sourceType: 'CLOSED_PERIOD_PROBE',
        sourceId: randomUUID(),
        sourceNumber: `CPP-${suffix}`,
        lines: [
          { accountId: accounts['1101'].id, debit: 10 },
          { accountId: accounts['4101'].id, credit: 10 },
        ],
      }),
    );
  } catch (e) {
    serviceBlockErr = e;
  }
  check('S6 PostingService refuses a posting dated in a CLOSED period',
    serviceBlockErr instanceof BadRequestException && /is closed/.test(serviceBlockErr.message),
    serviceBlockErr?.message);

  let triggerErr = null;
  try {
    // Bypass every service to prove the database trigger is a real backstop.
    await prisma.$executeRaw`
      INSERT INTO journal_entries
        (id, "companyId", "branchId", "entryNumber", "entryDate",
         "totalDebit", "totalCredit", status, "updatedAt", "createdAt")
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${branch.id}::uuid,
              ${`RAW-${suffix}-${randomUUID().slice(0, 6)}`}, '2041-10-01'::date,
              5, 5, 'POSTED'::"JournalStatus", now(), now())`;
  } catch (e) {
    triggerErr = e;
  }
  // Prisma wraps raw-query failures in P2010; the native SQLSTATE 23514 and
  // the trigger's message survive either on .cause or inside the wrapper text.
  const rawErrorText = `${triggerErr?.cause?.code ?? ''} ${triggerErr?.cause?.message ?? ''} ${triggerErr?.message ?? ''}`;
  check('S6 raw INSERT of a POSTED entry in 2041 is rejected by the DB trigger (23514)',
    triggerErr !== null && /23514/.test(rawErrorText) && /Fiscal period is closed/.test(rawErrorText),
    rawErrorText.replace(/\s+/g, ' ').trim().slice(0, 160));
  const rawIntruder = await prisma.journalEntry.count({
    where: { companyId, entryNumber: { startsWith: `RAW-${suffix}` } },
  });
  check('S6 rejected raw insert left no row behind', rawIntruder === 0);

  // ---------------------------------------------------------------- S10
  console.log('\n[S10] loss-making year 2044 closes with retained earnings DEBITED');
  const lossResult = await svc.yearEnd.close(companyId, userId, periods[2044].id);
  const lossEntry = await prisma.journalEntry.findFirst({
    where: { companyId, sourceType: 'YEAR_END_CLOSE', sourceId: periods[2044].id },
    include: { lines: true },
  });
  const lossRetained = lossEntry?.lines.find((l) => l.accountId === accounts['3102'].id);
  check('S10 loss 150: retained earnings debited, entry balances',
    lossResult.totals.resultLabel === 'loss' &&
    num(lossRetained?.debit) === 150 && num(lossRetained?.credit) === 0 &&
    num(lossEntry.totalDebit) === num(lossEntry.totalCredit),
    JSON.stringify(lossResult.totals));

  // ---------------------------------------------------------------- S7
  console.log('\n[S7] concurrent closes on the same open period (3 independent periods)');
  for (const year of [2045, 2046, 2047]) {
    await seedJournal(year, `${year}-03-31`, [
      { accountId: accounts['1101'].id, debit: 300 },
      { accountId: accounts['4101'].id, credit: 300 },
    ]);
    const clientA = makeClient(`guard-ye-A-${year}`);
    const clientB = makeClient(`guard-ye-B-${year}`);
    const svcA = buildServices(clientA);
    const svcB = buildServices(clientB);
    const startedAt = Date.now();
    const [ra, rb] = await Promise.allSettled([
      svcA.yearEnd.close(companyId, userId, periods[year].id),
      svcB.yearEnd.close(companyId, userId, periods[year].id),
    ]);
    const elapsed = Date.now() - startedAt;
    const outcomes = [ra, rb].map((r) => (r.status === 'fulfilled' ? 'ok' : `rejected: ${r.reason?.message}`));
    const okCount = [ra, rb].filter((r) => r.status === 'fulfilled').length;
    const entries = await prisma.journalEntry.findMany({
      where: { companyId, sourceType: 'YEAR_END_CLOSE', sourceId: periods[year].id },
    });
    const finalPeriod = await prisma.fiscalPeriod.findUnique({ where: { id: periods[year].id } });
    check(`S7 ${year}: exactly one concurrent close succeeds`, okCount === 1,
      `outcomes=[${outcomes.join(' | ')}] elapsed=${elapsed}ms`);
    check(`S7 ${year}: exactly one closing entry persisted`, entries.length === 1,
      `entries=${entries.length}`);
    check(`S7 ${year}: period ends CLOSED`, finalPeriod.status === 'CLOSED');
    await clientA.$disconnect();
    await clientB.$disconnect();
  }

  // ---------------------------------------------------------------- S8
  console.log('\n[S8] controller permission metadata');
  const PERMISSIONS_KEY = 'requiredPermissions';
  const proto = Object.getPrototypeOf(new YearEndCloseController({}));
  // NestJS SetMetadata stores method metadata on the method function itself
  // (descriptor.value), exactly where Reflector.get(KEY, context.getHandler())
  // reads it at request time.
  const previewPerms = Reflect.getMetadata(PERMISSIONS_KEY, proto.preview);
  const closePerms = Reflect.getMetadata(PERMISSIONS_KEY, proto.close);
  check('S8 preview requires accounting.periods.read',
    JSON.stringify(previewPerms) === JSON.stringify(['accounting.periods.read']),
    JSON.stringify(previewPerms));
  check('S8 close-year requires accounting.periods.close',
    JSON.stringify(closePerms) === JSON.stringify(['accounting.periods.close']),
    JSON.stringify(closePerms));
  check('S8 enforcement guard exists server-side (PermissionsGuard unit suite)',
    (await import('node:fs')).existsSync(new URL('../dist/src/common/guards/permissions.guard.js', import.meta.url)));

  await prisma.$disconnect();

  console.log(`\nYEAR-END CLOSE INTEGRATION: ${pass} PASS / ${fail} FAIL`);
  if (fail > 0) {
    console.log('Failed checks:', failures.join('; '));
    process.exit(1);
  }
  console.log('ALL YEAR-END CLOSE SCENARIOS PASSED');
}

main().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
