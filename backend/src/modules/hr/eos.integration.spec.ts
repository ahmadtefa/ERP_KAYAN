import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { HrService } from './hr.service';
import { EosService } from './eos.service';
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

/// End-of-service provision: accrual from a posted payroll run, balances, payouts and reversals
/// against a real migrated PostgreSQL. The accrual percent is typed here by the test, as a company would.
(vmReady ? describe : describe.skip)('end-of-service provision (real schema)', () => {
  let prisma: any;
  let hr: HrService;
  let payroll: PayrollService;
  let eos: EosService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const query = (sql: string) => prisma.$queryRawUnsafe(sql);
  let emp: any;
  let accrualId = '';

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','pr','Pr','ع','x',now()), ('${BOSS}','${COMPANY}','boss','Boss','م','x',now())`);
    await run(`INSERT INTO accounts(id,"companyId",code,"nameEn","nameAr",type,"isPostable","isActive","updatedAt") VALUES
      ('${A(1)}','${COMPANY}','5401','Salaries','الرواتب','EXPENSE',true,true,now()),
      ('${A(2)}','${COMPANY}','5402','Employer insurance','تأمينات صاحب العمل','EXPENSE',true,true,now()),
      ('${A(3)}','${COMPANY}','2201','Insurance payable','تأمينات مستحقة','LIABILITY',true,true,now()),
      ('${A(4)}','${COMPANY}','2202','Tax payable','ضريبة مستحقة','LIABILITY',true,true,now()),
      ('${A(5)}','${COMPANY}','1201','Employee loans','سلف العاملين','ASSET',true,true,now()),
      ('${A(6)}','${COMPANY}','2203','Salaries payable','رواتب مستحقة','LIABILITY',true,true,now()),
      ('${A(7)}','${COMPANY}','2204','Deductions payable','استقطاعات مستحقة','LIABILITY',true,true,now()),
      ('${A(8)}','${COMPANY}','1101','Cash','الصندوق','ASSET',true,true,now()),
      ('${A(9)}','${COMPANY}','5403','End of service expense','مصروف نهاية الخدمة','EXPENSE',true,true,now()),
      ('b0000000-0000-4000-8000-000000000001','${COMPANY}','2205','End of service provision','مخصص نهاية الخدمة','LIABILITY',true,true,now())`);
    const audit: never = { record: async () => {}, recordRequired: async () => {} } as never;
    const posting = new PostingService(new DocumentNumberService(), new FiscalPeriodsService(prisma as never, audit as never), new CostCentersService(prisma as never, audit as never));
    hr = new HrService(prisma as never, audit);
    payroll = new PayrollService(prisma as never, audit, posting);
    eos = new EosService(prisma as never, audit, posting);
    emp = await hr.createEmployee(COMPANY, USER, { code: 'E1', nameAr: 'أحمد', hireDate: '2026-01-01' });
    await hr.setSalary(COMPANY, USER, emp.id, { effectiveFrom: '2026-01-01', basic: '3000' });
    const s = await hr.createSettings(COMPANY, USER, { effectiveFrom: '2026-01-01', siEmployeeRate: '11', siEmployerRate: '18.75', siCeiling: '10000', personalExemption: '0', overtimeFactor: '1', monthDivisor: 30, taxBrackets: [{ from: '0', ratePercent: '10' }] });
    await hr.confirmSettings(COMPANY, USER, s.id);
    await payroll.setAccounts(COMPANY, USER, { salariesExpenseId: A(1), employerSiExpenseId: A(2), siPayableId: A(3), taxPayableId: A(4), loansReceivableId: A(5), salariesPayableId: A(6), deductionsPayableId: A(7) });
    await hr.saveAttendance(COMPANY, USER, '2026-03', [{ employeeId: emp.id, workingDays: '31', absenceDays: '0' }]);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('needs settings and a posted payroll run before anything is accrued', async () => {
    await expect(eos.accrue(COMPANY, USER, '2026-03')).rejects.toMatchObject({ response: { code: 'EOS_SETTINGS_MISSING' } });
    await expect(eos.setSettings(COMPANY, USER, { accrualPercent: '0', expenseAccountId: A(9), provisionAccountId: 'b0000000-0000-4000-8000-000000000001' })).rejects.toMatchObject({ response: { code: 'EOS_PERCENT_BAD' } });
    await expect(eos.setSettings(COMPANY, USER, { accrualPercent: '5', expenseAccountId: A(3), provisionAccountId: 'b0000000-0000-4000-8000-000000000001' })).rejects.toMatchObject({ response: { code: 'EOS_ACCOUNT_INVALID' } });
    expect(await eos.getSettings(COMPANY)).toEqual({ configured: false });
    expect(await eos.setSettings(COMPANY, USER, { accrualPercent: '5', expenseAccountId: A(9), provisionAccountId: 'b0000000-0000-4000-8000-000000000001' })).toMatchObject({ configured: true, accrualPercent: '5.0000' });
    await expect(eos.accrue(COMPANY, USER, '2026-03')).rejects.toMatchObject({ response: { code: 'EOS_RUN_NOT_POSTED' } });
    const r = await payroll.createRun(COMPANY, USER, null, '2026-03');
    await payroll.approve(COMPANY, BOSS, r.id);
    await payroll.post(COMPANY, BOSS, r.id);
    await expect(eos.accrue(COMPANY, USER, 'bad')).rejects.toMatchObject({ response: { code: 'HR_MONTH_BAD' } });
  });

  it('accrues the typed percent of basic pay once per month in a balanced entry', async () => {
    const a: any = await eos.accrue(COMPANY, USER, '2026-03');
    accrualId = a.id;
    expect(a).toMatchObject({ month: '2026-03', total: '150.0000', accrualPercent: '5.0000', status: 'POSTED' });
    const [t] = await query(`SELECT sum(debit)::text AS d, sum(credit)::text AS c FROM journal_lines WHERE "journalEntryId" = '${a.journalEntryId}'`);
    expect(t.d).toBe('150.0000');
    expect(t.c).toBe('150.0000');
    await expect(eos.accrue(COMPANY, USER, '2026-03')).rejects.toMatchObject({ response: { code: 'EOS_ALREADY_ACCRUED' } });
    expect(await eos.balances(COMPANY)).toMatchObject({ totalBalance: '150.0000', items: [{ code: 'E1', accrued: '150.0000', paid: '0.0000', balance: '150.0000' }] });
  });

  it('a payout uses the provision first and expenses only the excess', async () => {
    await expect(eos.settle(COMPANY, USER, { employeeId: emp.id, amount: '0', payoutDate: '2026-04-01', fundingAccountId: A(8) })).rejects.toMatchObject({ response: { code: 'HR_AMOUNT_BAD' } });
    await expect(eos.settle(COMPANY, USER, { employeeId: emp.id, amount: '100', payoutDate: '2026-04-01', fundingAccountId: A(3) })).rejects.toMatchObject({ response: { code: 'EOS_ACCOUNT_INVALID' } });
    const small: any = await eos.settle(COMPANY, USER, { employeeId: emp.id, amount: '100', payoutDate: '2026-04-01', fundingAccountId: A(8) });
    expect(small).toMatchObject({ amount: '100.0000', fromProvision: '100.0000', extraExpense: '0.0000' });
    const big: any = await eos.settle(COMPANY, USER, { employeeId: emp.id, amount: '80', payoutDate: '2026-04-02', fundingAccountId: A(8) });
    expect(big).toMatchObject({ fromProvision: '50.0000', extraExpense: '30.0000' });
    expect((await eos.balances(COMPANY)).items[0]).toMatchObject({ accrued: '150.0000', paid: '150.0000', balance: '0.0000' });
    const [cash] = await query(`SELECT sum(credit)::text AS c FROM journal_lines WHERE "accountId" = '${A(8)}'`);
    expect(cash.c).toBe('180.0000');
  });

  it('an accrual already paid out of cannot be reversed; reversing the payouts frees it', async () => {
    await expect(eos.reverseAccrual(COMPANY, USER, accrualId)).rejects.toMatchObject({ response: { code: 'EOS_ACCRUAL_USED' } });
    const payouts = await query(`SELECT id FROM hr_eos_payouts ORDER BY "createdAt"`);
    for (const p of payouts) await eos.reversePayout(COMPANY, USER, p.id);
    await expect(eos.reversePayout(COMPANY, USER, payouts[0].id)).rejects.toMatchObject({ response: { code: 'EOS_PAYOUT_STATE' } });
    expect((await eos.balances(COMPANY)).items[0].balance).toBe('150.0000');
    expect(await eos.reverseAccrual(COMPANY, USER, accrualId)).toMatchObject({ status: 'REVERSED' });
    expect((await eos.balances(COMPANY)).items).toHaveLength(0);
    expect(await eos.accrue(COMPANY, USER, '2026-03')).toMatchObject({ status: 'POSTED', total: '150.0000' });
  });
});
