import { Body, Controller, Param, Patch, Post, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ProblemDetailsFilter } from '../filters/problem-details.filter';
import { validationExceptionFactory } from './field-errors';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CompanySettingsService } from '../settings/company-settings.module';
import { PartiesService } from '../../modules/parties/parties.service';
import { CreateCustomerDto, UpdateCustomerDto } from '../../modules/parties/dto/party.dto';
import { FixedAssetsService } from '../../modules/fixed-assets/fixed-assets.service';
import { CreateFixedAssetDto } from '../../modules/fixed-assets/dto/fixed-asset.dto';

/// Real HTTP through the ValidationPipe and ProblemDetailsFilter main.ts installs,
/// to the real PartiesService and CompanySettingsService on a real migrated
/// PostgreSQL. No auth guards: this spec is about the error body a form receives.
/// Needs DATABASE_URL; run alone (`jest -i`): it truncates companies.
const CO = '11111111-1111-4111-8111-111111111111';
const USER = '88888888-8888-4888-8888-000000000001';

@Controller('t')
class TestController {
  constructor(private readonly settings: CompanySettingsService, private readonly parties: PartiesService, private readonly assets: FixedAssetsService) {}
  @Patch('settings') s(@Body() body: Record<string, unknown>) { return this.settings.update(CO, USER, body); }
  @Post('customers') c(@Body() body: CreateCustomerDto) { return this.parties.create(CO, USER, 'customer', body); }
  @Post('assets') a(@Body() body: CreateFixedAssetDto) { return this.assets.create(CO, 'branch-not-needed-before-refusal', USER, body); }
  @Patch('customers/:id') u(@Param('id') id: string, @Body() body: UpdateCustomerDto) { return this.parties.update(CO, USER, 'customer', id, body); }
}

jest.setTimeout(120_000);
const ready =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

(ready ? describe : describe.skip)('field errors over HTTP (real pipe + filter, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base = '';
  const run = (sql: string) => (prisma as any).$executeRawUnsafe(sql);
  const q = (sql: string) => (prisma as any).$queryRawUnsafe(sql);
  const call = async (method: string, path: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* */ }
    return { status: res.status, json };
  };
  const limitOf = async (id: string) => String((await q(`SELECT "creditLimit"::text AS v FROM customers WHERE id='${id}'`))[0].v);

  beforeAll(async () => {
    @Module({
      controllers: [TestController],
      providers: [
        PrismaService, AuditService,
        { provide: CompanySettingsService, useFactory: (p: PrismaService, a: AuditService) => new CompanySettingsService(p as never, a as never), inject: [PrismaService, AuditService] },
        { provide: FixedAssetsService, useFactory: (p: PrismaService, a: AuditService) => new FixedAssetsService(p as never, {} as never, {} as never, {} as never, a as never, {} as never), inject: [PrismaService, AuditService] },
        { provide: PartiesService, useFactory: (p: PrismaService, a: AuditService) => new PartiesService(p as never, a as never), inject: [PrismaService, AuditService] },
      ],
    })
    class M {}
    app = await NestFactory.create(M, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: validationExceptionFactory }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    prisma = app.get(PrismaService);
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies (id,code,"nameEn","nameAr","updatedAt") VALUES ('${CO}','CO','Co','شركة',now())`);
    await run(`INSERT INTO users (id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${CO}','u','u','u','x',now())`);
  });
  afterAll(async () => { await app?.close(); });

  it.each([
    ['maxDiscountPercent', 101], ['maxDiscountPercent', -1], ['maxDiscountPercent', 'NaN'], ['maxDiscountPercent', 'abc'],
    ['managerName', 'x'.repeat(161)], ['salesManagerName', 'x'.repeat(161)], ['salesManagerPhone', 'x'.repeat(161)], ['managerName', 5],
  ])('settings %s=%p is refused with that field named', async (field, value) => {
    const r = await call('PATCH', '/t/settings', { [field]: value });
    expect(r.status).toBe(400);
    expect(Object.keys(r.json.fieldErrors)).toEqual([field]);
    expect(r.json.errorCode).toBe('VALIDATION_FAILED');
  });

  it('settings: valid values still save, and an empty text clears the field', async () => {
    const ok = await call('PATCH', '/t/settings', { maxDiscountPercent: 100, managerName: 'أحمد', salesManagerPhone: 'x'.repeat(160) });
    expect(ok.status).toBe(200);
    expect(ok.json.managerName).toBe('أحمد');
    const zero = await call('PATCH', '/t/settings', { maxDiscountPercent: 0, managerName: '' });
    expect(zero.status).toBe(200);
    expect(zero.json.managerName).toBeNull();
  });

  it('parties creditLimit: negative, NaN, Infinity and non-number name the field and save nothing', async () => {
    const ok = await call('POST', '/t/customers', { code: 'C-1', nameEn: 'A', creditLimit: '500' });
    expect(ok.status).toBe(201);
    const id = ok.json.id;
    for (const bad of ['-1', 'NaN', 'Infinity', '-Infinity', 'abc']) {
      for (const [m, p, b] of [['POST', '/t/customers', { code: `X-${bad}`, nameEn: 'B', creditLimit: bad }], ['PATCH', `/t/customers/${id}`, { creditLimit: bad }]] as const) {
        const r = await call(m, p, b);
        expect({ bad, m, status: r.status }).toEqual({ bad, m, status: 400 });
        expect(Object.keys(r.json.fieldErrors)).toEqual(['creditLimit']);
      }
    }
    expect(await limitOf(id)).toMatch(/^500(\.0+)?$/);
    expect((await call('PATCH', `/t/customers/${id}`, { creditLimit: '0' })).status).toBe(200);
    expect(await limitOf(id)).toMatch(/^0(\.0+)?$/);
  });

  it('parties: empty code, both names empty, and a bad payment term name their fields', async () => {
    const code = await call('POST', '/t/customers', { code: '', nameEn: 'A' });
    expect(code.status).toBe(400);
    expect(Object.keys(code.json.fieldErrors)).toEqual(['code']);
    const names = await call('POST', '/t/customers', { code: 'N-1' });
    expect(names.status).toBe(400);
    expect(Object.keys(names.json.fieldErrors).sort()).toEqual(['nameAr', 'nameEn']);
    const term = await call('POST', '/t/customers', { code: 'N-2', nameEn: 'A', paymentTermDays: 99999 });
    expect(term.status).toBe(400);
    expect(Object.keys(term.json.fieldErrors)).toEqual(['paymentTermDays']);
    expect((await call('POST', '/t/customers', { code: 'N-3', nameAr: 'عميل', paymentTermDays: 30 })).status).toBe(201);
  });

  const ZERO = '00000000-0000-4000-8000-000000000000';
  const asset = (over: Record<string, unknown>) => ({
    nameEn: 'Truck', nameAr: 'شاحنة', purchaseDate: '2026-01-01', inServiceDate: '2026-01-01',
    cost: '1000', salvageValue: '0', usefulLifeMonths: 12,
    assetAccountId: ZERO, accumulatedAccountId: '00000000-0000-4000-8000-000000000001', expenseAccountId: '00000000-0000-4000-8000-000000000002',
    ...over,
  });
  it.each([
    [{ cost: '0' }, 'cost'], [{ cost: 'abc' }, 'cost'], [{ cost: 'Infinity' }, 'cost'],
    [{ salvageValue: '-1' }, 'salvageValue'], [{ salvageValue: '1000' }, 'salvageValue'], [{ salvageValue: 'x' }, 'salvageValue'],
    [{}, 'assetAccountId'],
  ])('fixed asset create %j names %s', async (over, field) => {
    const r = await call('POST', '/t/assets', asset(over));
    expect(r.status).toBe(400);
    expect(Object.keys(r.json.fieldErrors)).toEqual([field]);
    expect(r.json.errorCode).toBe('VALIDATION_FAILED');
  });
});
