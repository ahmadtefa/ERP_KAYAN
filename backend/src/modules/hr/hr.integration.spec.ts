import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { HrService } from './hr.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Employee file, salary versions, attendance and payroll settings against a real migrated PostgreSQL.
(vmReady ? describe : describe.skip)('payroll and HR part 1 (real schema)', () => {
  let prisma: any;
  let svc: HrService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  let emp: any;
  let emp2: any;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','hr','Hr','ع','x',now())`);
    const audit: never = { record: async () => {}, recordRequired: async () => {} } as never;
    svc = new HrService(prisma as never, audit);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('creates employees, refuses duplicate codes and bad ids, masks personal data', async () => {
    await expect(svc.createEmployee(COMPANY, USER, { code: 'E1', nameAr: 'أحمد', hireDate: '2026-01-01', nationalId: '123' })).rejects.toMatchObject({ response: { code: 'HR_NATIONAL_ID_BAD' } });
    emp = await svc.createEmployee(COMPANY, USER, { code: 'E1', nameAr: 'أحمد', hireDate: '2026-01-01', nationalId: '29001011234567', bankAccount: 'EG123456789', branchId: BRANCH });
    emp2 = await svc.createEmployee(COMPANY, USER, { code: 'E2', nameAr: 'سلمى', hireDate: '2026-02-01' });
    await expect(svc.createEmployee(COMPANY, USER, { code: 'e1', nameAr: 'x', hireDate: '2026-01-01' })).rejects.toMatchObject({ response: { code: 'HR_EMPLOYEE_CODE_DUPLICATE' } });
    await expect(svc.createEmployee(COMPANY, USER, { code: 'E3', nameAr: 'x', hireDate: '2026-01-01', branchId: '99999999-9999-4999-8999-999999999999' })).rejects.toMatchObject({ response: { code: 'HR_BRANCH_NOT_FOUND' } });
    const hidden = await svc.getEmployee(COMPANY, emp.id, false);
    expect(hidden).toMatchObject({ nationalId: '**********4567', personalDataHidden: true });
    expect(hidden.bankAccount).toBe('*******6789');
    expect((await svc.getEmployee(COMPANY, emp.id, true)).nationalId).toBe('29001011234567');
    expect((await svc.listEmployees(COMPANY, {}, false)).items.map((e) => e.code)).toEqual(['E1', 'E2']);
  });

  it('an employee who left needs a leaving date after the hire date and drops out of the active list', async () => {
    await expect(svc.updateEmployee(COMPANY, USER, emp2.id, { status: 'LEFT' })).rejects.toMatchObject({ response: { code: 'HR_LEAVE_DATE_REQUIRED' } });
    await expect(svc.updateEmployee(COMPANY, USER, emp2.id, { status: 'LEFT', leaveDate: '2026-01-15' })).rejects.toMatchObject({ response: { code: 'HR_LEAVE_BEFORE_HIRE' } });
    await svc.updateEmployee(COMPANY, USER, emp2.id, { status: 'LEFT', leaveDate: '2026-03-31' });
    expect((await svc.listEmployees(COMPANY, {}, false)).items.map((e) => e.code)).toEqual(['E1']);
    expect((await svc.listEmployees(COMPANY, { status: 'ALL' }, false)).items).toHaveLength(2);
    await svc.updateEmployee(COMPANY, USER, emp2.id, { status: 'ACTIVE' });
    expect((await svc.getEmployee(COMPANY, emp2.id, true)).leaveDate).toBeNull();
  });

  it('salary changes are new dated versions and old ones stay', async () => {
    await svc.setSalary(COMPANY, USER, emp.id, { effectiveFrom: '2026-01-01', basic: '5000', items: [{ kind: 'ALLOWANCE', nameAr: 'بدل انتقال', amount: '300', subjectToTax: false }] });
    await svc.setSalary(COMPANY, USER, emp.id, { effectiveFrom: '2026-07-01', basic: '5500', items: [{ kind: 'DEDUCTION', nameAr: 'اشتراك نقابة', amount: '50' }] });
    await expect(svc.setSalary(COMPANY, USER, emp.id, { effectiveFrom: '2026-07-01', basic: '6000' })).rejects.toMatchObject({ response: { code: 'HR_SALARY_DATE_EXISTS' } });
    await expect(svc.setSalary(COMPANY, USER, emp.id, { effectiveFrom: '2026-08-01', basic: '6000', items: [{ kind: 'BONUS', nameAr: 'x', amount: '1' }] })).rejects.toMatchObject({ response: { code: 'HR_ITEM_KIND_BAD' } });
    const hist = await svc.salaryHistory(COMPANY, emp.id);
    expect(hist.items.map((h) => `${h.effectiveFrom}=${h.basic}`)).toEqual(['2026-07-01=5500.0000', '2026-01-01=5000.0000']);
    expect(hist.items[1].lines[0]).toMatchObject({ kind: 'ALLOWANCE', amount: '300.0000', subjectToSI: true, subjectToTax: false });
    // the refused August save left nothing behind
    expect(hist.items).toHaveLength(2);
  });

  it('attendance is saved per month, overwritten on a second save, and checked against the month length', async () => {
    await expect(svc.saveAttendance(COMPANY, USER, '2026-02', [{ employeeId: emp.id, workingDays: '29', absenceDays: '0' }])).rejects.toMatchObject({ response: { code: 'HR_ATTENDANCE_DAYS_INVALID', params: { days: '28' } } });
    await expect(svc.saveAttendance(COMPANY, USER, '2026-02', [{ employeeId: emp.id, workingDays: '20', absenceDays: '2' }, { employeeId: emp.id, workingDays: '20' }])).rejects.toMatchObject({ response: { code: 'HR_ATTENDANCE_DUPLICATE' } });
    await svc.saveAttendance(COMPANY, USER, '2026-02', [{ employeeId: emp.id, workingDays: '20', absenceDays: '2', overtimeHours: '5.5', penaltyAmount: '100' }]);
    await svc.saveAttendance(COMPANY, USER, '2026-02', [{ employeeId: emp.id, workingDays: '21', absenceDays: '1' }]);
    const att = await svc.getAttendance(COMPANY, '2026-02');
    const row = att.items.find((r) => r.employeeId === emp.id)!;
    expect(row).toMatchObject({ entered: true, workingDays: '21.00', absenceDays: '1.00', overtimeHours: '0.00' });
    expect(att.items.find((r) => r.employeeId === emp2.id)).toMatchObject({ entered: false });
    expect(att.daysInMonth).toBe(28);
  });

  it('payroll settings are typed, versioned and confirmed once; brackets must chain', async () => {
    const base = { effectiveFrom: '2026-01-01', siEmployeeRate: '11', siEmployerRate: '18.75', siCeiling: '10000', personalExemption: '20000', overtimeFactor: '1.35', monthDivisor: 30 };
    await expect(svc.createSettings(COMPANY, USER, { ...base, taxBrackets: [{ from: '5', to: '10', ratePercent: '1' }] })).rejects.toMatchObject({ response: { code: 'HR_BRACKETS_BAD' } });
    await expect(svc.createSettings(COMPANY, USER, { ...base, siEmployeeRate: '120' })).rejects.toMatchObject({ response: { code: 'HR_RATE_BAD' } });
    await expect(svc.createSettings(COMPANY, USER, { ...base, monthDivisor: 40 })).rejects.toMatchObject({ response: { code: 'HR_DIVISOR_BAD' } });
    const s = await svc.createSettings(COMPANY, USER, { ...base, taxBrackets: [{ from: '0', to: '1000', ratePercent: '0' }, { from: '1000', ratePercent: '10' }] });
    expect(s).toMatchObject({ confirmed: false, siCeiling: '10000.0000' });
    await expect(svc.createSettings(COMPANY, USER, { ...base, taxBrackets: [] })).rejects.toMatchObject({ response: { code: 'HR_SETTINGS_DATE_EXISTS' } });
    expect((await svc.confirmSettings(COMPANY, USER, s.id)).confirmed).toBe(true);
    await expect(svc.confirmSettings(COMPANY, USER, s.id)).rejects.toMatchObject({ response: { code: 'HR_SETTINGS_ALREADY_CONFIRMED' } });
  });
});
