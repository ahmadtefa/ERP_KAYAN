import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { HrService } from './hr.service';
import { PayrollService } from './payroll.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const BOSS = '33333333-3333-4333-8333-333333333334';
const A = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Payroll runs, maker-checker approval, ledger posting, payment, reversal and loans against a real migrated PostgreSQL.
(vmReady ? describe : describe.skip)('payroll and HR part 2 (real schema)', () => {
  let prisma: any;
  let hr: HrService;
  let svc: PayrollService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const query = (sql: string) => prisma.$queryRawUnsafe(sql);
  let emp: any;
  let loanId = '';
  let run1 = '';

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','pr','Pr','ع','x',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${BOSS}','${COMPANY}','boss','Boss','م','x',now())`);
    await run(`INSERT INTO accounts(id,"companyId",code,"nameEn","nameAr",type,"isPostable","isActive","updatedAt") VALUES
      ('${A(1)}','${COMPANY}','5401','Salaries','الرواتب','EXPENSE',true,true,now()),
      ('${A(2)}','${COMPANY}','5402','Employer insurance','تأمينات صاحب العمل','EXPENSE',true,true,now()),
      ('${A(3)}','${COMPANY}','2201','Insurance payable','تأمينات مستحقة','LIABILITY',true,true,now()),
      ('${A(4)}','${COMPANY}','2202','Tax payable','ضريبة مستحقة','LIABILITY',true,true,now()),
      ('${A(5)}','${COMPANY}','1201','Employee loans','سلف العاملين','ASSET',true,true,now()),
      ('${A(6)}','${COMPANY}','2203','Salaries payable','رواتب مستحقة','LIABILITY',true,true,now()),
      ('${A(7)}','${COMPANY}','2204','Deductions payable','استقطاعات مستحقة','LIABILITY',true,true,now()),
      ('${A(8)}','${COMPANY}','1101','Cash','الصندوق','ASSET',true,true,now())`);
    const audit: never = { record: async () => {}, recordRequired: async () => {} } as never;
    const posting = new PostingService(new DocumentNumberService(), new FiscalPeriodsService(prisma as never, audit as never), new CostCentersService(prisma as never, audit as never));
    hr = new HrService(prisma as never, audit);
    svc = new PayrollService(prisma as never, audit, posting);
    emp = await hr.createEmployee(COMPANY, USER, { code: 'E1', nameAr: 'أحمد', hireDate: '2026-01-01' });
    await hr.setSalary(COMPANY, USER, emp.id, { effectiveFrom: '2026-01-01', basic: '3000' });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('refuses a run while the parameters are missing or unconfirmed, and leaves nothing behind', async () => {
    await expect(svc.createRun(COMPANY, USER, null, '2026-03')).rejects.toMatchObject({ response: { code: 'PAYROLL_SETTINGS_UNVERIFIED' } });
    const s = await hr.createSettings(COMPANY, USER, { effectiveFrom: '2026-01-01', siEmployeeRate: '11', siEmployerRate: '18.75', siCeiling: '10000', personalExemption: '0', overtimeFactor: '1', monthDivisor: 30, taxBrackets: [{ from: '0', ratePercent: '10' }] });
    await expect(svc.createRun(COMPANY, USER, null, '2026-03')).rejects.toMatchObject({ response: { code: 'PAYROLL_SETTINGS_UNVERIFIED' } });
    await hr.confirmSettings(COMPANY, USER, s.id);
    await expect(svc.createRun(COMPANY, USER, null, '2026-03')).rejects.toMatchObject({ response: { code: 'PAYROLL_ATTENDANCE_MISSING' } });
    expect(await query('SELECT id FROM payroll_runs')).toHaveLength(0);
  });

  it('payroll accounts must be active, postable and of the right type', async () => {
    const all = { salariesExpenseId: A(1), employerSiExpenseId: A(2), siPayableId: A(3), taxPayableId: A(4), loansReceivableId: A(5), salariesPayableId: A(6), deductionsPayableId: A(7) };
    await expect(svc.setAccounts(COMPANY, USER, { ...all, siPayableId: A(1) })).rejects.toMatchObject({ response: { code: 'PAYROLL_ACCOUNT_INVALID' } });
    await expect(svc.setAccounts(COMPANY, USER, { ...all, taxPayableId: undefined })).rejects.toMatchObject({ response: { code: 'PAYROLL_ACCOUNT_REQUIRED' } });
    expect(await svc.getAccounts(COMPANY)).toEqual({ configured: false });
    expect(await svc.setAccounts(COMPANY, USER, all)).toMatchObject({ configured: true });
  });

  it('a loan posts to the ledger and the run takes the instalment', async () => {
    await expect(svc.createLoan(COMPANY, USER, BRANCH, { employeeId: emp.id, loanDate: '2026-03-01', amount: '1200', instalments: 0, firstDeductionMonth: '2026-03', fundingAccountId: A(8) })).rejects.toMatchObject({ response: { code: 'PAYROLL_LOAN_INSTALMENTS' } });
    await expect(svc.createLoan(COMPANY, USER, BRANCH, { employeeId: emp.id, loanDate: '2026-03-01', amount: '1200', instalments: 6, firstDeductionMonth: '2026-03', fundingAccountId: A(3) })).rejects.toMatchObject({ response: { code: 'PAYROLL_FUNDING_INVALID' } });
    const loan = await svc.createLoan(COMPANY, USER, BRANCH, { employeeId: emp.id, loanDate: '2026-03-01', amount: '1200', instalments: 6, firstDeductionMonth: '2026-03', fundingAccountId: A(8) });
    loanId = loan.id;
    expect(loan).toMatchObject({ remainingBalance: '1200.0000', status: 'OPEN' });
    await hr.saveAttendance(COMPANY, USER, '2026-03', [{ employeeId: emp.id, workingDays: '31', absenceDays: '0' }]);
    const r = await svc.createRun(COMPANY, USER, null, '2026-03');
    run1 = r.id;
    expect(r).toMatchObject({ status: 'CALCULATED', totalGross: '3000.0000', totalNet: '2170.0000' });
    expect(r.lines[0]).toMatchObject({ employeeSI: '330.0000', employerSI: '562.5000', tax: '300.0000', loanInstalment: '200.0000', net: '2170.0000' });
    await expect(svc.createRun(COMPANY, USER, null, '2026-03')).rejects.toMatchObject({ response: { code: 'PAYROLL_MONTH_EXISTS' } });
  });

  it('the preparer cannot approve; a second person can; posting balances and reduces the loan', async () => {
    await expect(svc.approve(COMPANY, USER, run1)).rejects.toMatchObject({ response: { code: 'PAYROLL_APPROVER_IS_PREPARER' } });
    await expect(svc.post(COMPANY, USER, run1)).rejects.toMatchObject({ response: { code: 'PAYROLL_RUN_STATE' } });
    expect((await svc.approve(COMPANY, BOSS, run1)).status).toBe('APPROVED');
    await expect(svc.recalculate(COMPANY, USER, run1)).rejects.toMatchObject({ response: { code: 'PAYROLL_RUN_LOCKED' } });
    const posted = await svc.post(COMPANY, BOSS, run1);
    expect(posted.status).toBe('POSTED');
    const [t] = await query(`SELECT sum(debit)::text AS d, sum(credit)::text AS c FROM journal_lines WHERE "journalEntryId" = '${posted.journalEntryId}'`);
    expect(t.d).toBe('3562.5000');
    expect(t.c).toBe('3562.5000');
    const [loan] = await query(`SELECT "remainingBalance"::text AS r FROM hr_employee_loans WHERE id = '${loanId}'`);
    expect(loan.r).toBe('1000.0000');
  });

  it('a posted unpaid run can be reversed, which restores the loan; then it can be approved and posted again', async () => {
    const rev = await svc.reverse(COMPANY, BOSS, run1);
    expect(rev).toMatchObject({ status: 'CALCULATED', journalEntryId: null });
    const [loan] = await query(`SELECT "remainingBalance"::text AS r, status FROM hr_employee_loans WHERE id = '${loanId}'`);
    expect(loan.r).toBe('1200.0000');
    await svc.approve(COMPANY, BOSS, run1);
    expect((await svc.post(COMPANY, BOSS, run1)).status).toBe('POSTED');
  });

  it('payment needs a posted run and a cash or bank account; a paid run cannot be reversed', async () => {
    await expect(svc.pay(COMPANY, BOSS, run1, A(3))).rejects.toMatchObject({ response: { code: 'PAYROLL_FUNDING_INVALID' } });
    const paid = await svc.pay(COMPANY, BOSS, run1, A(8));
    expect(paid.status).toBe('PAID');
    expect(paid.paymentJournalEntryId).not.toBeNull();
    await expect(svc.pay(COMPANY, BOSS, run1, A(8))).rejects.toMatchObject({ response: { code: 'PAYROLL_RUN_STATE' } });
    await expect(svc.reverse(COMPANY, BOSS, run1)).rejects.toMatchObject({ response: { code: 'PAYROLL_RUN_PAID' } });
    const [pay] = await query(`SELECT sum(debit)::text AS d FROM journal_lines WHERE "journalEntryId" = '${paid.paymentJournalEntryId}' AND "accountId" = '${A(6)}'`);
    expect(pay.d).toBe('2170.0000');
  });

  it('the loan balance and list reflect the posted run', async () => {
    const [l] = await query(`SELECT "remainingBalance"::text AS r FROM hr_employee_loans WHERE id = '${loanId}'`);
    expect(l.r).toBe('1000.0000');
    expect((await svc.listLoans(COMPANY)).items[0]).toMatchObject({ code: 'E1', remainingBalance: '1000.0000', status: 'OPEN' });
  });

  it('the summary report gives company totals for posted runs only, never per employee', async () => {
    const [{ month }] = await query(`SELECT month FROM payroll_runs WHERE id = '${run1}'`);
    const r = await svc.summaryReport(COMPANY, month, month);
    expect(r.months).toHaveLength(1);
    expect(r.months[0]).toMatchObject({ month, status: 'PAID', net: '2170.00' });
    expect(r.months[0]).not.toHaveProperty('lines');
    await expect(svc.summaryReport(COMPANY, '2026-05', '2026-01')).rejects.toMatchObject({ response: { code: 'HR_MONTH_BAD' } });
    await expect(svc.summaryReport(COMPANY, 'x', 'y')).rejects.toMatchObject({ response: { code: 'HR_MONTH_BAD' } });
  });
});
