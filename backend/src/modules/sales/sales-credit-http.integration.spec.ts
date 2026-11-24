import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ProblemDetailsFilter } from '../../common/filters/problem-details.filter';
import { validationExceptionFactory } from '../../common/validation/field-errors';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BranchWriteGuard } from '../../common/guards/branch-write.guard';
import { AuditService } from '../../common/audit/audit.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { BatchesService } from '../inventory/batches.service';
import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { PartiesService } from '../parties/parties.service';
import { CustomerCreditService } from './customer-credit.service';
import { SalesInvoicesController } from './sales-invoices.controller';
import { SalesInvoicesService } from './sales-invoices.service';

/// Real HTTP requests (fetch over a listening Nest server) to the real
/// SalesInvoicesController, behind the real JwtAuthGuard (real signed token,
/// real session row, permissions and branches loaded from the database on every
/// request), PermissionsGuard and BranchWriteGuard, on a real migrated
/// PostgreSQL. Not wired: MaintenanceAdmissionGuard, RateLimitGuard,
/// LicenseGuard and the aggregate interceptor. The ValidationPipe and
/// ProblemDetailsFilter are the ones main.ts installs. Needs DATABASE_URL; run alone (`jest -i`): it truncates companies.

const CO = '11111111-1111-4111-8111-111111111111';
const CO2 = '11111111-1111-4111-8111-111111111112';
const BR_A = '22222222-2222-4222-8222-222222222222';
const BR_B = '22222222-2222-4222-8222-222222222223';
const WH = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';
const CUST = '66666666-6666-4666-8666-666666666666';
const INV_A = '77777777-7777-4777-8777-000000000001';
const INV_B = '77777777-7777-4777-8777-000000000002';
const INV_C = '77777777-7777-4777-8777-000000000003';
const ACCOUNTS: Array<[string, string, string]> = [
  ['1103', 'AR', 'ASSET'], ['4101', 'Sales', 'REVENUE'], ['2103', 'VAT', 'LIABILITY'], ['1104', 'Inv', 'ASSET'], ['5101', 'COGS', 'EXPENSE'],
];
const uid = (n: number) => `88888888-8888-4888-8888-0000000000${String(n).padStart(2, '0')}`;
const PERMS = ['sales.invoices.read', 'sales.invoices.post', 'sales.credit.approve', 'parties.customers.read', 'inventory.stock.read', 'accounting.accounts.read'];

type Who = { id: string; token: string };

jest.setTimeout(120_000);
const ready =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

(ready ? describe : describe.skip)('credit approval and posting over HTTP (real guards, real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let base = '';
  const run = (sql: string) => (prisma as any).$executeRawUnsafe(sql);
  const q = (sql: string) => (prisma as any).$queryRawUnsafe(sql);
  const who: Record<string, Who> = {};

  async function makeUser(n: number, name: string, opts: { company?: string; role: string; perms: string[]; branch?: string; roleCode?: string }) {
    const company = opts.company ?? CO;
    const id = uid(n);
    const code = opts.roleCode ?? opts.role;
    const existing = await q(`SELECT id FROM roles WHERE "companyId"='${company}' AND code='${code}'`);
    let roleId: string = existing[0]?.id ?? uid(n + 40);
    await run(`INSERT INTO users (id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${id}','${company}','${name}','${name}','${name}','x',now())`);
    if (!existing[0]) {
      await run(`INSERT INTO roles (id,"companyId",code,"nameEn","nameAr","isActive","updatedAt") VALUES ('${roleId}','${company}','${code}','${opts.role}','${opts.role}',true,now())`);
      for (const p of opts.perms) await run(`INSERT INTO role_permissions ("roleId","permissionId") SELECT '${roleId}', id FROM permissions WHERE code='${p}'`);
    }
    await run(`INSERT INTO user_roles ("userId","roleId","companyId") VALUES ('${id}','${roleId}','${company}')`);
    if (opts.branch) await run(`INSERT INTO user_branches ("userId","branchId") VALUES ('${id}','${opts.branch}')`);
    const sessionHash = (n.toString(16).padStart(2, '0')).repeat(32);
    await run(`INSERT INTO refresh_tokens (id,"userId","tokenHash","expiresAt") VALUES (gen_random_uuid(),'${id}','${sessionHash}', now() + interval '1 day')`);
    const token = await jwt.signAsync({ sub: id, username: name, companyId: company, branchId: opts.branch ?? null, tokenVersion: 0, sessionHash }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '1h' });
    who[name] = { id, token };
    return roleId;
  }

  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${who[as].token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json };
  };
  const status = async (id: string) => (await q(`SELECT status::text AS s FROM sales_invoices WHERE id='${id}'`))[0].s;
  const approvals = async (id: string) => Number((await q(`SELECT count(*)::int AS n FROM sales_invoice_credit_approvals WHERE "invoiceId"='${id}'`))[0].n);

  async function draft(id: string, no: string, branch: string, total: number, createdBy: string) {
    await run(`INSERT INTO sales_invoices (id,"companyId","branchId","warehouseId","invoiceNumber","invoiceDate","customerId",status,currency,"subTotal","taxAmount","totalAmount","paidAmount","costOfGoods","documentType","createdBy","updatedAt")
      VALUES ('${id}','${CO}','${branch}','${WH}','${no}','2026-11-07','${CUST}','DRAFT','EGP',${total},0,${total},0,0,'INVOICE','${createdBy}',now())`);
    await run(`INSERT INTO sales_invoice_lines (id,"invoiceId","lineNumber","itemId",description,quantity,"unitPrice","taxRate","taxAmount","lineTotal","unitCost","costTotal") VALUES (gen_random_uuid(),'${id}',1,'${ITEM}','Milk',${total / 10},10,0,0,${total},0,0)`);
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret-for-http-credit-spec';
    @Module({
      imports: [JwtModule.register({})],
      controllers: [SalesInvoicesController],
      providers: [
        PrismaService, AuditService,
        { provide: PartiesService, useFactory: (p: PrismaService, a: AuditService) => new PartiesService(p as never, a as never), inject: [PrismaService, AuditService] },
        { provide: CustomerCreditService, useFactory: (p: PrismaService, pa: PartiesService, a: AuditService) => new CustomerCreditService(p as never, pa, a as never), inject: [PrismaService, PartiesService, AuditService] },
        {
          provide: SalesInvoicesService,
          useFactory: (p: PrismaService, a: AuditService, credit: CustomerCreditService) => {
            const ledger = new StockLedgerService();
            const batches = new BatchesService(p as never, {} as never, {} as never, {} as never, {} as never, a as never, ledger);
            const posting = new PostingService(new DocumentNumberService(), new FiscalPeriodsService(p as never, a as never), new CostCentersService(p as never, a as never));
            return new SalesInvoicesService(
              p as never, new DocumentNumberService(), posting, new AccountMapService(),
              { get: async () => ({ defaultTaxRate: new Prisma.Decimal(0), pricesIncludeTax: false }) } as never,
              new WarehouseService(p as never, a as never), {} as never, a as never, batches, ledger, credit,
            );
          },
          inject: [PrismaService, AuditService, CustomerCreditService],
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_GUARD, useClass: BranchWriteGuard },
      ],
    })
    class CreditHttpTestModule {}
    app = await NestFactory.create(CreditHttpTestModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    // The same pipe and filter main.ts installs, so bodies are what a client sees.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: validationExceptionFactory }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    base = base.replace('[::1]', '127.0.0.1');
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    await run('TRUNCATE companies CASCADE');
    const acc = ACCOUNTS.map(([code, name, type]) => `INSERT INTO accounts (id,"companyId",code,"nameEn","nameAr",type,"isPostable","isActive","updatedAt") VALUES ('99999999-9999-4999-8999-${code.padStart(12, '0')}','${CO}','${code}','${name}','${name}','${type}',true,true,now());`).join('');
    for (const sql of [
      `INSERT INTO companies (id,code,"nameEn","nameAr","updatedAt","deletedAt") VALUES ('${CO}','CO','Co','شركة',now(),NULL),('${CO2}','C2','Co2','شركة٢',now(),now())`,
      `INSERT INTO branches (id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BR_A}','${CO}','A','A','أ',now()),('${BR_B}','${CO}','B','B','ب',now())`,
      `INSERT INTO warehouses (id,"companyId","branchId",code,"nameEn","nameAr","isDefault","isActive","updatedAt") VALUES ('${WH}','${CO}','${BR_A}','W1','Main','رئيسي',true,true,now())`,
      `INSERT INTO customers (id,"companyId",code,"nameEn","nameAr","isActive","creditLimit","updatedAt") VALUES ('${CUST}','${CO}','C-1','Buyer','مشتري',true,1000,now())`,
      `INSERT INTO items (id,"companyId",code,"nameEn","nameAr",unit,"isStockTracked","requiresBatch","useFefo","allowExpiredIssue","salePrice","updatedAt") VALUES ('${ITEM}','${CO}','IT-1','Milk','حليب','piece',true,false,false,false,10,now())`,
      acc,
      `INSERT INTO stock_balances ("companyId","branchId","itemId",quantity,value,"updatedAt") VALUES ('${CO}','${BR_A}','${ITEM}',1000,5000,now())`,
      `INSERT INTO warehouse_stock_balances ("companyId","branchId","warehouseId","itemId",quantity,value,"updatedAt") VALUES ('${CO}','${BR_A}','${WH}','${ITEM}',1000,5000,now())`,
    ]) await run(sql);
    for (const p of PERMS) await run(`INSERT INTO permissions (id,code,"nameEn","nameAr",module) VALUES (gen_random_uuid(),'${p}','${p}','${p}','x') ON CONFLICT (code) DO NOTHING`);

    // creator: company-wide FINANCE_MANAGER with everything
    await makeUser(1, 'creator', { role: 'FINANCE_MANAGER', perms: PERMS });
    // approver: holds ONLY the approval permission (no posting right, no read), assigned to branch A
    const approverRole = await makeUser(2, 'approver', { role: 'CREDIT_APPROVER', perms: ['sales.credit.approve'], branch: BR_A });
    // poster: branch A, can post but not approve, no customer card
    await makeUser(3, 'poster', { role: 'SALES_POSTER', perms: ['sales.invoices.post'], branch: BR_A });
    // branch-limited finance manager of branch B, everything
    await makeUser(4, 'branchB', { role: 'FINANCE_MANAGER', roleCode: 'FINANCE_MANAGER', perms: PERMS, branch: BR_B });
    // branch-limited finance manager of branch A, everything
    await makeUser(5, 'branchA', { role: 'FINANCE_MANAGER', roleCode: 'FINANCE_MANAGER', perms: PERMS, branch: BR_A });
    // another company
    await makeUser(6, 'other', { company: CO2, role: 'FINANCE_MANAGER', perms: PERMS });
    who.approverRole = { id: approverRole, token: '' };
    await draft(INV_A, 'SI-1', BR_A, 1200, who.creator.id);
    await draft(INV_B, 'SI-2', BR_B, 1200, who.creator.id);
  });

  afterAll(async () => { await app?.close(); });

  it('post: no posting right 403; over limit 409 with figures only for the company-wide card viewer; invoice stays draft', async () => {
    const noRight = await call('approver', 'POST', `/sales/invoices/${INV_A}/post`, {});
    expect(noRight.status).toBe(403);
    const fm = await call('creator', 'POST', `/sales/invoices/${INV_A}/post`, {});
    expect(fm.status).toBe(409);
        expect(fm.json.errorCode).toBe('CUSTOMER_CREDIT_LIMIT_EXCEEDED');
    expect(fm.json.message).toContain('1200.0000'); // the filter keeps the sentence, not the numeric properties
    expect(fm.json.projectedBalance).toBeUndefined();
    const poster = await call('poster', 'POST', `/sales/invoices/${INV_A}/post`, {}); // no card permission, no aggregate role
    expect(poster.status).toBe(409);
    expect(poster.json).toMatchObject({ errorCode: 'CUSTOMER_CREDIT_LIMIT_EXCEEDED', message: 'This invoice needs credit approval before it can be posted.' });
    expect(poster.json.projectedBalance).toBeUndefined();
    expect(JSON.stringify(poster.json)).not.toMatch(/1200|1000/);
    const branchA = await call('branchA', 'POST', `/sales/invoices/${INV_A}/post`, {}); // branch-limited FM: has everything, still no figures
    expect(branchA.status).toBe(409);
    expect(branchA.json.projectedBalance).toBeUndefined();
    expect(await status(INV_A)).toBe('DRAFT');
  });

  it('approve: needs the credit permission; creator refused 403; unknown/other-company 404; other branch refused; none of these wrote an approval', async () => {
    expect((await call('poster', 'POST', `/sales/invoices/${INV_A}/credit-approval`, { reason: 'trying' })).status).toBe(403);
    const self = await call('creator', 'POST', `/sales/invoices/${INV_A}/credit-approval`, { reason: 'my own exception' });
    expect(self.status).toBe(403);
    expect(await approvals(INV_A)).toBe(0);
    expect((await call('other', 'POST', `/sales/invoices/${INV_A}/credit-approval`, { reason: 'cross company' })).status).toBe(404);
    const cross = await call('branchB', 'POST', `/sales/invoices/${INV_A}/credit-approval`, { reason: 'wrong branch' });
    expect([403, 404]).toContain(cross.status);
    expect(await approvals(INV_A)).toBe(0);
  });

  it('approve without any posting right succeeds with a minimal body, does not post, then the creator posts; the approval row stays for audit', async () => {
    const short = await call('approver', 'POST', `/sales/invoices/${INV_A}/credit-approval`, { reason: 'x' });
    expect(short.status).toBe(400);
    expect(short.json.fieldErrors.reason).toBeDefined();
    const ok = await call('approver', 'POST', `/sales/invoices/${INV_A}/credit-approval`, { reason: 'Approved by finance, large order' });
    expect(ok.status).toBe(201);
    expect(ok.json).toEqual({ invoiceId: INV_A, approved: true });
    expect(await status(INV_A)).toBe('DRAFT');
    expect((await call('approver', 'POST', `/sales/invoices/${INV_A}/post`, {})).status).toBe(403);
    const posted = await call('creator', 'POST', `/sales/invoices/${INV_A}/post`);
    expect(posted.status).toBe(201);
    expect(await status(INV_A)).toBe('POSTED');
    expect(Number((await q(`SELECT count(*)::int AS n FROM journal_entries WHERE "sourceId"='${INV_A}'`))[0].n)).toBe(1);
  });

  it('approved bodyless post reports branch-stock category and rolls back all effects, then succeeds after actual stock receipt', async () => {
    const STOCK_INV = '77777777-7777-4777-8777-000000000004';
    await draft(STOCK_INV, 'SI-STOCK', BR_A, 1200, who.creator.id);
    expect((await call('approver', 'POST', `/sales/invoices/${STOCK_INV}/credit-approval`, { reason: 'Synthetic branch stock scenario' })).status).toBe(201);
    const before = (await q(`SELECT quantity::text AS q, value::text AS v FROM stock_balances WHERE "companyId"='${CO}' AND "branchId"='${BR_A}' AND "itemId"='${ITEM}'`))[0];
    await run(`UPDATE stock_balances SET quantity=0,value=0 WHERE "companyId"='${CO}' AND "branchId"='${BR_A}' AND "itemId"='${ITEM}'`);
    const refused = await call('creator', 'POST', `/sales/invoices/${STOCK_INV}/post`);
    expect(refused.status).toBe(400);
    expect(refused.json.code).toBe('SALES_POST_BRANCH_STOCK');
    expect(refused.json.fieldErrors).toEqual({lineNumber:'1',itemCode:'IT-1',available:'0.0000',requested:'120.0000'});
    const hidden = await call('poster', 'POST', `/sales/invoices/${STOCK_INV}/post`);
    expect(hidden.json.code).toBe('SALES_POST_BRANCH_STOCK');expect(hidden.json.fieldErrors).toEqual({});
    expect(JSON.stringify(refused.json)).not.toMatch(/Milk|Buyer|1200/);
    expect(await status(STOCK_INV)).toBe('DRAFT');
    expect(Number((await q(`SELECT count(*)::int AS n FROM journal_entries WHERE "sourceId"='${STOCK_INV}'`))[0].n)).toBe(0);
    expect(Number((await q(`SELECT count(*)::int AS n FROM stock_movements WHERE "referenceId"='${STOCK_INV}'`))[0].n)).toBe(0);
    await run(`UPDATE stock_balances SET quantity=${before.q},value=${before.v} WHERE "companyId"='${CO}' AND "branchId"='${BR_A}' AND "itemId"='${ITEM}'`);
    expect((await call('creator', 'POST', `/sales/invoices/${STOCK_INV}/post`)).status).toBe(201);
    expect(await status(STOCK_INV)).toBe('POSTED');
  });

  it('approved posting reports a missing accounting account and remains a clean draft', async () => {
    const id = '77777777-7777-4777-8777-000000000005';
    await draft(id, 'SI-ACCOUNT', BR_A, 1200, who.creator.id);
    expect((await call('approver', 'POST', `/sales/invoices/${id}/credit-approval`, {reason:'Synthetic accounting fixture'})).status).toBe(201);
    await run(`UPDATE accounts SET code='SYN-HIDDEN-AR' WHERE "companyId"='${CO}' AND code='1103'`);
    try {
      const result=await call('creator','POST',`/sales/invoices/${id}/post`);
      expect(result.status).toBe(400);expect(result.json.code).toBe('SALES_POST_ACCOUNT_MISSING');
      expect(result.json.fieldErrors).toEqual({accountCode:'1103',accountKey:'accountsReceivable'});
      const hidden=await call('poster','POST',`/sales/invoices/${id}/post`);expect(hidden.json.fieldErrors).toBeUndefined();
      expect(await status(id)).toBe('DRAFT');
      expect(Number((await q(`SELECT count(*)::int AS n FROM journal_entries WHERE "sourceId"='${id}'`))[0].n)).toBe(0);
      expect(Number((await q(`SELECT count(*)::int AS n FROM stock_movements WHERE "referenceId"='${id}'`))[0].n)).toBe(0);
    } finally { await run(`UPDATE accounts SET code='1103' WHERE "companyId"='${CO}' AND code='SYN-HIDDEN-AR'`); }
  });

  it('branch-limited approver of another branch cannot post or approve a branch-B draft, the branch-B staff can reach it', async () => {
    const post = await call('branchA', 'POST', `/sales/invoices/${INV_B}/post`, {});
    expect([403, 404]).toContain(post.status);
    const approve = await call('branchA', 'POST', `/sales/invoices/${INV_B}/credit-approval`, { reason: 'wrong branch' });
    expect([403, 404]).toContain(approve.status);
    expect(await status(INV_B)).toBe('DRAFT');
    expect(await approvals(INV_B)).toBe(0);
    const own = await call('branchB', 'POST', `/sales/invoices/${INV_B}/credit-approval`, { reason: 'own branch reviewer' });
    expect(own.status).toBe(201); // branch B staff, not the creator, in scope
  });

  it('revoking the permission takes effect on the very next request with the same token', async () => {
    await draft(INV_C, 'SI-3', BR_A, 1200, who.creator.id);
    await run(`DELETE FROM role_permissions WHERE "roleId"='${who.approverRole.id}'`);
    const refused = await call('approver', 'POST', `/sales/invoices/${INV_C}/credit-approval`, { reason: 'after revocation' });
    expect(refused.status).toBe(403);
    expect(await approvals(INV_C)).toBe(0);
  });

  it('production body shape of the credit 409 (real pipe + filter): permitted viewer vs confidential; no numeric property reaches the client', async () => {
    await run(`UPDATE customers SET "creditLimit"=1000 WHERE id='${CUST}'`);
    await run(`UPDATE sales_invoices SET status='DRAFT',"deletedAt"=NULL WHERE id='${INV_B}'`);
    const raw = async (as: string) => {
      const res = await fetch(`${base}/api/v1/sales/invoices/${INV_C}/post`, { method: 'POST', headers: { authorization: `Bearer ${who[as].token}`, 'content-type': 'application/json' }, body: '{}' });
      return { status: res.status, text: await res.text() };
    };
    const permitted = await raw('creator');
    const hidden = await raw('poster');
    // eslint-disable-next-line no-console
    console.log('PERMITTED_BODY', permitted.text, 'HIDDEN_BODY', hidden.text);
    for (const r of [permitted, hidden]) {
      expect(r.status).toBe(409);
      const body = JSON.parse(r.text);
      expect(body.errorCode).toBe('CUSTOMER_CREDIT_LIMIT_EXCEEDED');
      for (const k of ['currentBalance', 'projectedBalance', 'invoiceAmount', 'creditLimit', 'customerId']) expect(body[k]).toBeUndefined();
    }
    expect(JSON.parse(hidden.text).message).not.toMatch(/\d{3,}/);
    // structured figures: only the permitted viewer, only the four whitelisted keys
    const branchLimited = await raw('branchA');
    expect(branchLimited.status).toBe(409);
    expect(JSON.parse(branchLimited.text).creditSummary).toBeUndefined();
    expect(branchLimited.text).not.toContain('1000.0000');
    expect(branchLimited.text).not.toContain('1200.0000');
    const ps = JSON.parse(permitted.text).creditSummary;
    expect(Object.keys(ps).sort()).toEqual(['creditLimit', 'currentBalance', 'invoiceAmount', 'projectedBalance']);
    expect(ps.creditLimit).toBe('1000.0000');
    expect(ps.invoiceAmount).toBe('1200.0000');
    expect(Number(ps.projectedBalance)).toBeGreaterThan(1000);
    expect(JSON.parse(hidden.text).creditSummary).toBeUndefined();
    expect(hidden.text).not.toMatch(/1000|1200/);
    // a bad body is refused by the pipe with a per-field error, never a 500
    for (const body of [{}, { reason: 123 }, { reason: 'ab' }, { reason: 'x'.repeat(501) }, { reason: 'fine reason', extra: 1 }]) {
      const r = await fetch(`${base}/api/v1/sales/invoices/${INV_C}/credit-approval`, { method: 'POST', headers: { authorization: `Bearer ${who.branchA.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json: any = await r.json();
      expect(r.status).toBe(400);
      expect(Object.keys(json.fieldErrors ?? {}).length).toBeGreaterThan(0);
    }
  });
});
