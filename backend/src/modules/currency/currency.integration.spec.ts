import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { CurrencyService } from './currency.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Currencies and hand-entered rates against a real migrated PostgreSQL.
(vmReady ? describe : describe.skip)('currencies and exchange rates (real schema)', () => {
  let prisma: any;
  let svc: CurrencyService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','cur','Cur','ع','x',now())`);
    const audit: never = { record: async () => {}, recordRequired: async () => {} } as never;
    svc = new CurrencyService(prisma as never, audit);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('adds foreign currencies, refuses the company currency and duplicates', async () => {
    await expect(svc.create(COMPANY, USER, { code: 'EGP', nameAr: 'جنيه', nameEn: 'Pound' })).rejects.toMatchObject({ response: { code: 'CURRENCY_IS_BASE' } });
    await expect(svc.create(COMPANY, USER, { code: 'US', nameAr: 'د', nameEn: 'D' })).rejects.toMatchObject({ response: { code: 'CURRENCY_CODE_BAD' } });
    const usd = await svc.create(COMPANY, USER, { code: 'usd', nameAr: 'دولار أمريكي', nameEn: 'US dollar', symbol: '$' });
    expect(usd).toMatchObject({ code: 'USD', isActive: true });
    await expect(svc.create(COMPANY, USER, { code: 'USD', nameAr: 'د', nameEn: 'D' })).rejects.toMatchObject({ response: { code: 'CURRENCY_DUPLICATE' } });
    expect((await svc.list(COMPANY)).baseCurrency).toBe('EGP');
  });

  it('rate lookup: newest on or before the date, never invented', async () => {
    await expect(svc.rateOn(COMPANY, 'USD', '2026-03-10')).rejects.toMatchObject({ response: { code: 'FX_RATE_MISSING', params: { code: 'USD', date: '2026-03-10' } } });
    await svc.setRate(COMPANY, USER, 'USD', { rateDate: '2026-03-01', rate: '48.50' });
    await svc.setRate(COMPANY, USER, 'USD', { rateDate: '2026-03-15', rate: '49.1' });
    expect((await svc.rateOn(COMPANY, 'USD', '2026-03-10')).rate).toBe('48.50000000');
    expect((await svc.rateOn(COMPANY, 'USD', '2026-03-15')).rate).toBe('49.10000000');
    expect((await svc.rateOn(COMPANY, 'USD', '2026-04-30')).rateDate).toBe('2026-03-15');
    await expect(svc.rateOn(COMPANY, 'USD', '2026-02-28')).rejects.toMatchObject({ response: { code: 'FX_RATE_MISSING' } });
    await expect(svc.rateOn(COMPANY, 'EGP', '2026-03-10')).rejects.toMatchObject({ response: { code: 'CURRENCY_IS_BASE' } });
  });

  it('a second rate for the same day replaces the first; bad input is refused', async () => {
    await svc.setRate(COMPANY, USER, 'USD', { rateDate: '2026-03-15', rate: '49.25' });
    const list = await svc.listRates(COMPANY, 'USD');
    expect(list.items.map((r) => `${r.rateDate}=${r.rate}`)).toEqual(['2026-03-15=49.25000000', '2026-03-01=48.50000000']);
    await expect(svc.setRate(COMPANY, USER, 'USD', { rateDate: '2026-02-30', rate: '1' })).rejects.toMatchObject({ response: { code: 'CURRENCY_RATE_DATE_BAD' } });
    await expect(svc.setRate(COMPANY, USER, 'USD', { rateDate: '2999-01-01', rate: '1' })).rejects.toMatchObject({ response: { code: 'CURRENCY_RATE_DATE_FUTURE' } });
    await expect(svc.setRate(COMPANY, USER, 'USD', { rateDate: '2026-03-20', rate: '0' })).rejects.toMatchObject({ response: { code: 'CURRENCY_RATE_BAD' } });
    await expect(svc.setRate(COMPANY, USER, 'EUR', { rateDate: '2026-03-20', rate: '1' })).rejects.toMatchObject({ response: { code: 'CURRENCY_NOT_FOUND' } });
  });

  it('a switched-off currency takes no new rate', async () => {
    await svc.update(COMPANY, USER, 'USD', { isActive: false });
    await expect(svc.setRate(COMPANY, USER, 'USD', { rateDate: '2026-03-21', rate: '50' })).rejects.toMatchObject({ response: { code: 'CURRENCY_INACTIVE' } });
    await svc.update(COMPANY, USER, 'USD', { isActive: true });
    const usd = (await svc.list(COMPANY)).items.find((c) => c.code === 'USD');
    expect(usd).toMatchObject({ latestRateDate: '2026-03-15', latestRate: '49.25000000' });
  });
});
