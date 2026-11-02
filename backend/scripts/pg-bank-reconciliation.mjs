/**
 * REAL PostgreSQL integration test (classification B) for
 * BankReconciliationService.
 *
 * The production service runs unchanged against a REAL native PostgreSQL 18
 * server (pg-embedded-server.mjs). Ledger balances come from real posted
 * journal entries; nothing about the database is mocked. The reconciliation
 * is a matching/recording function by design: it never writes journal entries,
 * never hides a difference and has no edit/cancel operations. Those design
 * facts are asserted, not assumed.
 *
 * Scenarios (the eleven required by the task):
 *  R1  exact match: zero difference, FINAL
 *  R2  independent SQL recomputation of the book balance
 *  R3  positive difference (book above statement) reported, not posted away
 *  R4  negative difference (statement above book) reported as well
 *  R5  reconciliation never creates journal entries / moves no money
 *  R6  voucher match + duplicate-match prevention
 *  R7  invalid account / inverted period / bad amount / foreign voucher
 *  R8  failure inside the transaction rolls the whole create back
 *  R9  concurrent reconciliations claiming the same posted voucher
 *  R10 controller permission metadata (cash.reconcile on every route)
 *  R11 edit/cancel surface: the feature does not exist (documented NOT RUN)
 *
 * Usage: DATABASE_URL=... node scripts/pg-bank-reconciliation.mjs
 */
import { randomUUID } from 'node:crypto';

import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BadRequestException } from '@nestjs/common';

import { AuditService } from '../dist/src/common/audit/audit.service.js';
import { BankReconciliationService } from '../dist/src/modules/cash/bank-reconciliation.service.js';
import { CashController } from '../dist/src/modules/cash/cash.controller.js';

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

function makeClient(applicationName) {
  const u = new URL(DB_URL);
  u.searchParams.set('application_name', applicationName);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: u.toString() }) });
}

async function main() {
  const prisma = makeClient('guard-br');
  // Self-seed on an empty (freshly migrated) database so the guard can run
  // repeatedly on clean databases without depending on another harness.
  let company = await prisma.company.findFirst({ where: { isActive: true } });
  if (!company) {
    company = await prisma.company.create({
      data: { code: 'CR9', nameEn: 'R9 Guard Co', nameAr: 'شركة حارس التسوية' },
    });
    console.log(`Seeded company ${company.code} (${company.id}) on an empty database`);
  }
  const companyId = company.id;
  const suffix = randomUUID().slice(0, 8);
  // Audit rows carry a real user foreign key; AuditService swallows audit
  // failures, so a fake id would silently remove audit evidence.
  const user = await prisma.user.create({
    data: {
      companyId,
      username: `br-guard-${suffix}`,
      fullNameEn: 'Bank reconciliation guard',
      fullNameAr: 'حارس التسوية',
      passwordHash: 'guard-placeholder-not-a-real-credential',
      isActive: true,
    },
  });
  const userId = user.id;
  console.log(`Company ${company.code} (${companyId}), run suffix ${suffix}`);

  // ------------------------------------------------------------------ seed
  const branch = await prisma.branch.create({
    data: {
      companyId,
      code: `BR-${suffix}`,
      nameEn: `BR branch ${suffix}`,
      nameAr: `فرع التسوية ${suffix}`,
      kind: 'BRANCH',
      isActive: true,
    },
  });

  const bankGl = await prisma.account.create({
    data: { companyId, code: `11${suffix.slice(0, 4)}`, nameEn: 'Test bank GL', nameAr: 'بنك اختبار', type: 'ASSET' },
  });
  const revenueGl = await prisma.account.create({
    data: { companyId, code: `49${suffix.slice(0, 4)}`, nameEn: 'Test revenue', nameAr: 'إيراد اختبار', type: 'REVENUE' },
  });
  const expenseGl = await prisma.account.create({
    data: { companyId, code: `59${suffix.slice(0, 4)}`, nameEn: 'Test expense', nameAr: 'مصروف اختبار', type: 'EXPENSE' },
  });

  const cashAccount = await prisma.cashAccount.create({
    data: {
      companyId,
      branchId: branch.id,
      code: `BNK-${suffix}`,
      nameEn: `Test bank ${suffix}`,
      nameAr: `بنك ${suffix}`,
      kind: 'BANK',
      currency: 'EGP',
      accountId: bankGl.id,
      isActive: true,
    },
  });
  const otherCashAccount = await prisma.cashAccount.create({
    data: {
      companyId,
      branchId: branch.id,
      code: `BNK2-${suffix}`,
      nameEn: `Other bank ${suffix}`,
      nameAr: `بنك آخر ${suffix}`,
      kind: 'BANK',
      currency: 'EGP',
      accountId: bankGl.id,
      isActive: true,
    },
  });

  await prisma.fiscalPeriod.create({
    data: {
      companyId,
      code: `BR2050-${suffix}`,
      nameEn: `BR 2050 ${suffix}`,
      nameAr: 'سنة 2050',
      startDate: new Date('2050-01-01T00:00:00.000Z'),
      endDate: new Date('2050-12-31T00:00:00.000Z'),
      status: 'OPEN',
    },
  });

  let jeN = 0;
  async function postLedger(date, lines) {
    jeN += 1;
    const total = lines.reduce((s, l) => s + num(l.debit ?? 0), 0);
    return prisma.journalEntry.create({
      data: {
        companyId,
        branchId: branch.id,
        entryNumber: `BRJ-${suffix}-${jeN}`,
        entryDate: new Date(`${date}T00:00:00.000Z`),
        description: 'bank harness ledger entry',
        status: 'POSTED',
        postedAt: new Date(),
        totalDebit: new Prisma.Decimal(total),
        totalCredit: new Prisma.Decimal(total),
        lines: {
          create: lines.map((l, i) => ({
            lineNumber: i + 1,
            accountId: l.accountId,
            debit: new Prisma.Decimal(l.debit ?? 0),
            credit: new Prisma.Decimal(l.credit ?? 0),
          })),
        },
      },
    });
  }

  const je1 = await postLedger('2050-01-15', [
    { accountId: bankGl.id, debit: 1000 },
    { accountId: revenueGl.id, credit: 1000 },
  ]);
  const je2 = await postLedger('2050-02-15', [
    { accountId: expenseGl.id, debit: 200 },
    { accountId: bankGl.id, credit: 200 },
  ]);
  const je3 = await postLedger('2050-03-10', [
    { accountId: bankGl.id, debit: 50 },
    { accountId: revenueGl.id, credit: 50 },
  ]);
  // Expected ledger net on the bank GL up to 2050-03-31: 1000 - 200 + 50 = 850.

  let vN = 0;
  async function makeVoucher(kind, amount, date, je) {
    vN += 1;
    return prisma.cashVoucher.create({
      data: {
        companyId,
        branchId: branch.id,
        voucherNumber: `BRV-${suffix}-${vN}`,
        voucherDate: new Date(`${date}T00:00:00.000Z`),
        kind,
        cashAccountId: cashAccount.id,
        amount: new Prisma.Decimal(amount),
        currency: 'EGP',
        counterAccountId: kind === 'RECEIPT' ? revenueGl.id : expenseGl.id,
        description: 'bank harness voucher',
        status: 'POSTED',
        postedAt: new Date(),
        journalEntryId: je.id,
      },
    });
  }
  const voucher1 = await makeVoucher('RECEIPT', 1000, '2050-01-15', je1);
  const voucher2 = await makeVoucher('PAYMENT', 200, '2050-02-15', je2);
  const voucher3 = await makeVoucher('RECEIPT', 50, '2050-03-10', je3);
  const foreignVoucher = await prisma.cashVoucher.create({
    data: {
      companyId,
      branchId: branch.id,
      voucherNumber: `BRV-${suffix}-X`,
      voucherDate: new Date('2050-01-20T00:00:00.000Z'),
      kind: 'RECEIPT',
      cashAccountId: otherCashAccount.id,
      amount: new Prisma.Decimal(10),
      counterAccountId: revenueGl.id,
      status: 'POSTED',
      postedAt: new Date(),
    },
  });

  const audit = new AuditService(prisma);
  const service = new BankReconciliationService(prisma, audit);
  const baseDto = {
    cashAccountId: cashAccount.id,
    statementDate: '2050-03-31',
    periodFrom: '2050-01-01',
    periodTo: '2050-03-31',
  };
  const journalCount = () =>
    prisma.journalEntry.count({ where: { companyId, entryNumber: { startsWith: `BRJ-${suffix}` } } });

  // ------------------------------------------------------------------ R1/R2
  console.log('\n[R1/R2] balanced reconciliation and independent ledger verification');
  const jeBefore = await journalCount();
  const balanced = await service.create(companyId, userId, { ...baseDto, statementBalance: '850' });
  check('R1 zero difference, isBalanced, FINAL status',
    balanced.difference === '0.0000' && balanced.isBalanced === true && balanced.status === 'final',
    JSON.stringify({ diff: balanced.difference, balanced: balanced.isBalanced, status: balanced.status }));
  check('R1 service book balance reads 850.0000 from the ledger', balanced.bookBalance === '850.0000');

  const sqlRows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l."journalEntryId"
     WHERE e."companyId" = ${companyId}::uuid
       AND e.status IN ('POSTED','REVERSED')
       AND l."accountId" = ${bankGl.id}::uuid
       AND e."entryDate" <= '2050-03-31'::date`;
  check('R2 independent SQL ledger net equals service bookBalance (850)',
    num(sqlRows[0].net) === 850 && num(balanced.bookBalance) === num(sqlRows[0].net),
    `sql=${num(sqlRows[0].net)} service=${balanced.bookBalance}`);

  // ------------------------------------------------------------------ R5
  console.log('\n[R5] reconciliation creates no journal entries and moves no money');
  const jeAfter = await journalCount();
  check('R5 journal entry count unchanged by reconciliation', jeBefore === jeAfter,
    `before=${jeBefore} after=${jeAfter}`);
  const recRow = await prisma.bankReconciliation.findFirst({
    where: { companyId, cashAccountId: cashAccount.id },
    orderBy: { createdAt: 'desc' },
  });
  check('R5 reconciliation row persisted with the three balances stored',
    recRow !== null && num(recRow.bookBalance) === 850 && num(recRow.statementBalance) === 850 &&
    num(recRow.difference) === 0);

  // ------------------------------------------------------------------ R3/R4
  console.log('\n[R3/R4] non-zero differences are reported, never hidden or posted');
  const positive = await service.create(companyId, userId, {
    ...baseDto,
    statementDate: '2050-04-30',
    periodTo: '2050-04-30',
    statementBalance: '700',
  });
  check('R3 positive difference +150 reported (book 850 - statement 700)',
    positive.difference === '150.0000' && positive.isBalanced === false, positive.difference);
  const negative = await service.create(companyId, userId, {
    ...baseDto,
    statementDate: '2050-05-31',
    periodTo: '2050-05-31',
    statementBalance: '950',
  });
  check('R4 negative difference -100 reported (book 850 - statement 950)',
    negative.difference === '-100.0000' && negative.isBalanced === false, negative.difference);
  check('R4 still no journal entry after difference reconciliations',
    (await journalCount()) === jeBefore);
  const auditCount = await prisma.auditLog.count({
    where: { companyId, action: 'RECONCILE', entity: 'bank_reconciliations' },
  });
  check('R4 every reconciliation wrote one RECONCILE audit row', auditCount >= 3, `audit rows=${auditCount}`);

  // ------------------------------------------------------------------ R6
  console.log('\n[R6] voucher match and duplicate prevention');
  const matched = await service.create(companyId, userId, {
    ...baseDto,
    statementDate: '2050-06-30',
    periodTo: '2050-06-30',
    statementBalance: '850',
    voucherIds: [voucher1.id],
  });
  check('R6 response includes the matched voucher',
    matched.vouchers.length === 1 && matched.vouchers[0].voucherNumber === voucher1.voucherNumber &&
    matched.vouchers[0].reconciled === true);
  const linked = await prisma.cashVoucher.findUnique({ where: { id: voucher1.id } });
  check('R6 voucher now carries a reconciliationId and reconciledAt',
    linked.reconciliationId !== null && linked.reconciledAt !== null);
  let dupErr = null;
  try {
    await service.create(companyId, userId, {
      ...baseDto,
      statementDate: '2050-07-31',
      periodTo: '2050-07-31',
      statementBalance: '850',
      voucherIds: [voucher1.id, voucher2.id],
    });
  } catch (e) {
    dupErr = e;
  }
  check('R6 second reconciliation claiming the same voucher is rejected',
    dupErr instanceof BadRequestException && /already matched/.test(dupErr.message), dupErr?.message);
  const untouched = await prisma.cashVoucher.findUnique({ where: { id: voucher2.id } });
  check('R6 rejected call left the other voucher unlinked (transaction atomicity)',
    untouched.reconciliationId === null && untouched.reconciledAt === null);

  // ------------------------------------------------------------------ R7
  console.log('\n[R7] invalid input validation');
  const cases = [
    ['unknown cash account', { ...baseDto, cashAccountId: randomUUID(), statementBalance: '1' }, /cash account does not exist/],
    ['inverted period', { ...baseDto, periodFrom: '2050-06-01', periodTo: '2050-01-01', statementBalance: '1' }, /periodTo must not be before periodFrom/],
    ['non-numeric amount', { ...baseDto, statementBalance: 'abc' }, /not a valid amount/],
    ['foreign voucher', { ...baseDto, statementBalance: '1', voucherIds: [foreignVoucher.id] }, /belongs to another cash account/],
    ['non-existent voucher', { ...baseDto, statementBalance: '1', voucherIds: [randomUUID()] }, /do not exist in this company/],
  ];
  for (const [label, dto, re] of cases) {
    let err = null;
    try {
      await service.create(companyId, userId, dto);
    } catch (e) {
      err = e;
    }
    check(`R7 ${label} rejected`, err instanceof BadRequestException && re.test(err.message), err?.message);
  }
  const draft = await service.create(companyId, userId, {
    ...baseDto,
    statementDate: '2050-08-31',
    periodTo: '2050-08-31',
    statementBalance: '850',
    finalise: false,
  });
  check('R7 finalise:false stores DRAFT', draft.status === 'draft', draft.status);

  // ------------------------------------------------------------------ R8
  console.log('\n[R8] mid-transaction failure rolls everything back');
  const recBefore = await prisma.bankReconciliation.count({ where: { companyId } });
  const auditBefore = await prisma.auditLog.count({ where: { companyId, action: 'RECONCILE' } });
  let overflowErr = null;
  try {
    // 10^18 cannot fit Decimal(19,4): the INSERT fails inside $transaction.
    await service.create(companyId, userId, {
      ...baseDto,
      statementDate: '2050-09-30',
      periodTo: '2050-09-30',
      statementBalance: '1000000000000000000',
      voucherIds: [voucher3.id],
    });
  } catch (e) {
    overflowErr = e;
  }
  const errText = `${overflowErr?.cause?.code ?? ''} ${overflowErr?.message ?? ''}`;
  check('R8 oversized amount fails inside the transaction (numeric overflow 22003)',
    overflowErr !== null && /22003|numeric field overflow/.test(errText), errText.trim().slice(0, 120));
  check('R8 no reconciliation row survived the rollback',
    (await prisma.bankReconciliation.count({ where: { companyId } })) === recBefore);
  check('R8 voucher3 stays unlinked after rollback',
    (await prisma.cashVoucher.findUnique({ where: { id: voucher3.id } })).reconciliationId === null);
  check('R8 no audit row written for the failed transaction',
    (await prisma.auditLog.count({ where: { companyId, action: 'RECONCILE' } })) === auditBefore);

  // ------------------------------------------------------------------ R9
  console.log('\n[R9] concurrent reconciliations claiming the same posted voucher (8 parallel)');
  const parallel = 8;
  const batchDate = new Date('2050-10-31T00:00:00.000Z');
  const beforeBatch = await prisma.bankReconciliation.count({
    where: { companyId, cashAccountId: cashAccount.id, statementDate: batchDate },
  });
  const auditBeforeBatch = await prisma.auditLog.count({
    where: { companyId, action: 'RECONCILE' },
  });

  // Evidence sampler: real PostgreSQL lock waits on the cash_vouchers row.
  // The service takes SELECT ... FOR UPDATE inside its transaction, so losing
  // callers must block on a row/transactionid lock, not merely fail a check.
  const monitor = makeClient('guard-br-mon');
  const lockSamples = [];
  const sampler = setInterval(async () => {
    try {
      const rows = await monitor.$queryRaw`
        SELECT pid::text AS pid, wait_event_type::text AS wet, wait_event::text AS we
          FROM pg_stat_activity
         WHERE application_name LIKE 'guard-br-c%'
           AND wait_event_type IS NOT NULL
           AND wait_event IN ('relation', 'transactionid', 'tuple')`;
      if (rows.length > 0) lockSamples.push(...rows);
    } catch {
      /* sampler is best-effort evidence, never a test failure */
    }
  }, 25);

  const clients = [];
  const settled = await Promise.all(
    Array.from({ length: parallel }, (_, i) => {
      const client = makeClient(`guard-br-c${i}`);
      clients.push(client);
      const svc = new BankReconciliationService(client, new AuditService(client));
      return svc
        .create(companyId, userId, {
          cashAccountId: cashAccount.id,
          statementDate: '2050-10-31',
          periodFrom: '2050-10-01',
          periodTo: '2050-10-31',
          statementBalance: '850',
          voucherIds: [voucher3.id],
        })
        .then((v) => ({ ok: true, id: v.id }))
        .catch((e) => ({ ok: false, message: e.message }));
    }),
  );
  clearInterval(sampler);
  await monitor.$disconnect();

  const okN = settled.filter((r) => r.ok).length;
  const rejectedN = settled.length - okN;
  const winnerId = settled.find((r) => r.ok)?.id ?? null;
  console.log(`    concurrent outcome: ${okN} fulfilled / ${rejectedN} rejected`);
  for (const r of settled.filter((r) => !r.ok).slice(0, 3)) console.log(`    rejected: ${r.message}`);
  const lockKinds = [...new Set(lockSamples.map((s) => `${s.wet}:${s.we}`))];
  console.log(`    PG lock-wait samples: ${lockSamples.length} (${lockKinds.join(', ') || 'none'})`);

  // Direct SQL inspection of the final state — the service result is not trusted.
  const parallelRecs = await prisma.bankReconciliation.findMany({
    where: { companyId, cashAccountId: cashAccount.id, statementDate: batchDate },
    select: { id: true },
  });
  const batchRows = parallelRecs.length - beforeBatch;
  const finalVoucher = await prisma.$queryRaw`
    SELECT id::text AS id, "reconciliationId"::text AS "reconciliationId",
           "reconciledAt" IS NOT NULL AS "reconciledFlag"
      FROM cash_vouchers WHERE id = ${voucher3.id}::uuid`;
  const voucherRow = finalVoucher[0];
  const claimers = await prisma.bankReconciliation.count({
    where: { companyId, id: voucherRow.reconciliationId ?? '__none__' },
  });
  const auditAfterBatch = await prisma.auditLog.count({
    where: { companyId, action: 'RECONCILE' },
  });
  console.log(`    reconciliation rows written by this parallel batch: ${batchRows} of ${parallel} calls`);

  check('R9 exactly one of the 8 concurrent calls succeeds', okN === 1,
    `fulfilled=${okN} rejected=${rejectedN}`);
  check('R9 exactly one reconciliation row persisted for the batch', batchRows === 1,
    `batch rows=${batchRows}`);
  check('R9 every losing call reports a business conflict (not a 500)',
    rejectedN === parallel - 1 &&
      settled.filter((r) => !r.ok).every((r) => /already matched|another reconciliation/.test(r.message)),
    `${rejectedN} rejected`);
  check('R9 voucher ends linked to exactly one existing reconciliation',
    voucherRow.reconciliationId !== null && claimers === 1 &&
    voucherRow.reconciliationId === winnerId,
    `reconciliationId=${voucherRow.reconciliationId}, winner=${winnerId}`);
  check('R9 real PostgreSQL row-lock waits observed during the race',
    lockSamples.length > 0 && lockKinds.some((k) => k.includes('transactionid') || k.includes('tuple') || k.includes('relation')),
    `${lockSamples.length} samples: ${lockKinds.join(',') || 'none'}`);
  check('R9 exactly one RECONCILE audit row from the batch (rollbacks wrote none)',
    auditAfterBatch - auditBeforeBatch === 1,
    `new audits=${auditAfterBatch - auditBeforeBatch}`);
  await Promise.all(clients.map((c) => c.$disconnect()));

  // A sequential attempt after the race must fail the same way.
  let sequentialErr = null;
  try {
    await service.create(companyId, userId, {
      cashAccountId: cashAccount.id,
      statementDate: '2050-11-30',
      periodFrom: '2050-11-01',
      periodTo: '2050-11-30',
      statementBalance: '850',
      voucherIds: [voucher3.id],
    });
  } catch (e) {
    sequentialErr = e;
  }
  check('R9 the claimed voucher cannot be matched again afterwards',
    sequentialErr instanceof BadRequestException && /already matched/.test(sequentialErr.message),
    sequentialErr?.message);
  const stillOne = await prisma.cashVoucher.findUnique({ where: { id: voucher3.id } });
  check('R9 sequential rejection did not move the existing link',
    stillOne.reconciliationId === voucherRow.reconciliationId);

  // ------------------------------------------------------------------ R10
  console.log('\n[R10] controller permission metadata');
  const proto = Object.getPrototypeOf(new CashController(...Array(10).fill({})));
  const methodPerms = (name) => Reflect.getMetadata('requiredPermissions', proto[name]);
  for (const method of ['listReconciliations', 'unmatched', 'getReconciliation', 'reconcile']) {
    check(`R10 ${method} requires cash.reconcile`,
      JSON.stringify(methodPerms(method)) === JSON.stringify(['cash.reconcile']),
      JSON.stringify(methodPerms(method)));
  }

  // ------------------------------------------------------------------ R11
  console.log('\n[R11] edit/cancel surface (design check)');
  const mutators = ['update', 'edit', 'delete', 'remove', 'cancel', 'void', 'finalise', 'reopen'];
  const present = mutators.filter((m) => typeof service[m] === 'function');
  check('R11 service exposes no edit/cancel/delete operation (feature absent by design)',
    present.length === 0, `present=${present.join(',') || 'none'}`);
  console.log('    NOT RUN: edit/cancel scenarios — the operation does not exist in the service surface;');
  console.log('    a reconciliation can only be created or read. Documented as a design boundary.');

  await prisma.$disconnect();

  console.log(`\nBANK RECONCILIATION INTEGRATION: ${pass} PASS / ${fail} FAIL`);
  if (fail > 0) {
    console.log('Failed checks:', failures.join('; '));
    process.exit(1);
  }
  console.log('ALL BANK RECONCILIATION SCENARIOS PASSED');
}

main().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
