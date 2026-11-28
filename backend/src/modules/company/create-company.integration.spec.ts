import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { SetupService } from './setup.service';

const C1 = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

const dto = (code: string, admin: string) => ({
  companyCode: code, companyNameAr: 'شركة ' + code, companyNameEn: 'Company ' + code,
  adminUsername: admin, adminPassword: 'a-long-test-password-1', seedChartOfAccounts: false,
}) as never;

/// Adding a company to a running installation. The one-company rule is a trigger that the
/// multi-company switch turns off; the switch row is the only door. Real migrated PostgreSQL.
(vmReady ? describe : describe.skip)('create company (switch, guard, company-only administrator)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let service: SetupService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = async (sql: string, params: unknown[] = []) => (await prisma.$queryRawUnsafe(sql, ...params)) as Array<Record<string, any>>;
  const run = (sql: string, params: unknown[] = []) => prisma.$executeRawUnsafe(sql, ...params);

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`DELETE FROM installation_flags`);
    const audit = { record: async () => {}, recordRequired: async () => {} } as never;
    service = new SetupService(prisma as never, audit, {} as never);
    await run(`INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt") VALUES ($1::uuid,'ONE','One','واحد',now())`, [C1]);
    await run(`INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "isSuperAdmin", "updatedAt") VALUES ($1::uuid,$2::uuid,'root','Root','جذر','x',true,now())`, [ACTOR, C1]);
  });
  afterAll(async () => {
    await run(`DELETE FROM installation_flags`);
    await prisma.$disconnect();
  });

  it('is refused while the switch is off, in the service and in the database', async () => {
    await expect(service.createCompany(dto('TWO', 'boss'), { userId: ACTOR, companyId: C1 })).rejects.toMatchObject({ response: { code: 'COMPANY_CREATE_DISABLED' } });
    await expect(run(`INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt") VALUES (gen_random_uuid(),'RAW','Raw','خام',now())`)).rejects.toThrow(/Company_one_active_company_idx|duplicate key|unique/i);
    expect(await q(`SELECT 1 FROM companies`)).toHaveLength(1);
  });

  it('creates a second company with its own administrator, who is not a program administrator', async () => {
    await run(`INSERT INTO installation_flags (key, enabled) VALUES ('multi_company', true)`);
    const made = await service.createCompany(dto('TWO', 'root'), { userId: ACTOR, companyId: C1 });
    expect(made.companyCode).toBe('TWO');
    const [admin] = await q(`SELECT "companyId", "isSuperAdmin", username FROM users WHERE username = 'root' AND "companyId" = $1::uuid`, [made.companyId]);
    expect(admin).toMatchObject({ companyId: made.companyId, isSuperAdmin: false });
    // The same username lives in both companies; the first company's administrator is unchanged.
    expect((await q(`SELECT "isSuperAdmin" FROM users WHERE id = $1::uuid`, [ACTOR]))[0].isSuperAdmin).toBe(true);
    const roles = await q(`SELECT 1 FROM user_roles WHERE "userId" = (SELECT id FROM users WHERE "companyId" = $1::uuid AND username = 'root') AND "companyId" = $1::uuid`, [made.companyId]);
    expect(roles).toHaveLength(1);
    expect(await q(`SELECT 1 FROM fiscal_periods WHERE "companyId" = $1::uuid`, [made.companyId])).not.toHaveLength(0);
  });

  it('refuses a code that is already taken, whatever its case, and leaves nothing behind', async () => {
    await expect(service.createCompany(dto('two', 'other'), { userId: ACTOR, companyId: C1 })).rejects.toMatchObject({ response: { code: 'COMPANY_CODE_TAKEN' } });
    expect(await q(`SELECT 1 FROM companies`)).toHaveLength(2);
  });

  it('turning the switch off again stops the next company', async () => {
    await run(`UPDATE installation_flags SET enabled = false WHERE key = 'multi_company'`);
    await expect(service.createCompany(dto('THREE', 'x3'), { userId: ACTOR, companyId: C1 })).rejects.toMatchObject({ response: { code: 'COMPANY_CREATE_DISABLED' } });
  });
});
