import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ApprovalsService, ApprovalActor } from '../../common/approvals/approvals.service';
import { StockTransfersService } from './stock-transfers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SalesOrdersService } from '../sales/sales-orders.service';
import { StockTakesService } from './stock-takes.service';
import { StockDocumentsService } from './stock-documents.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH_A = '22222222-2222-4222-8222-222222222222';
const BRANCH_B = '22222222-2222-4222-8222-222222222223';
const REQUESTER = '33333333-3333-4333-8333-333333333331';
const MANAGER = '33333333-3333-4333-8333-333333333332';
const CHIEF = '33333333-3333-4333-8333-333333333333';
const COLLEAGUE = '33333333-3333-4333-8333-333333333334';
const FROM = '44444444-4444-4444-8444-444444444444';
const TO = '55555555-5555-4555-8555-555555555555';
const ITEM = '66666666-6666-4666-8666-666666666666';
const UNIT = '77777777-7777-4777-8777-777777777777';

async function database() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  await prisma.$executeRawUnsafe('TRUNCATE companies CASCADE');
  for (const stmt of [
    `INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`,
    `INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH_A}','${COMPANY}','A','A','أ',now()),('${BRANCH_B}','${COMPANY}','B','B','ب',now())`,
    `INSERT INTO warehouses(id,"companyId","branchId",code,"nameEn","nameAr","isDefault","isActive","updatedAt") VALUES ('${FROM}','${COMPANY}','${BRANCH_A}','FROM','From','من',true,true,now()),('${TO}','${COMPANY}','${BRANCH_B}','TO','To','إلى',true,true,now())`,
    `INSERT INTO items(id,"companyId",code,"nameEn","nameAr",unit,"isStockTracked","requiresBatch","useFefo","salePrice","purchasePrice","updatedAt") VALUES('${ITEM}','${COMPANY}','I-1','Item','صنف','piece',true,false,true,4.25,4.25,now())`,
    `INSERT INTO item_units(id,"itemId",unit,factor,"isActive","createdAt","updatedAt") VALUES ('${UNIT}','${ITEM}','piece',1,true,now(),now())`,
  ]) await prisma.$executeRawUnsafe(stmt);
  return prisma;
}

jest.setTimeout(180_000);
// Needs a PostgreSQL with every migration applied (DATABASE_URL), like the
// other database-backed specs; it is skipped when none is configured.
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') ||
    (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// The whole approval cycle through the real services on a real schema: who is
/// told, who stops being told, who hears the outcome, and who must NOT see it.
(vmReady ? describe : describe.skip)('notification and approval cycle (real services)', () => {
  let prisma: any;
  let service: StockTransfersService;
  let approvals: ApprovalsService;
  let notif: NotificationsService;

  const actor = (userId: string, permissions: string[], roles: string[]): ApprovalActor => ({ userId, companyId: COMPANY, permissions, roles });
  const nu = (userId: string, permissions: string[], roles: string[], extra: Record<string, unknown> = {}) =>
    ({ userId, companyId: COMPANY, permissions, roles, branchIds: [BRANCH_A, BRANCH_B], isSuperAdmin: false, ...extra } as never);
  const sees = async (u: any) => {
    const r: any = await notif.list(u, { status: 'OPEN' });
    return r.items.map((i: any) => i.type).sort();
  };
  const users = () => ({
    requester: nu(REQUESTER, ['inventory.transfer.create'], ['STOREKEEPER']),
    colleague: nu(COLLEAGUE, ['inventory.transfer.create'], ['STOREKEEPER']),
    whMgr: nu(MANAGER, ['inventory.transfer.approve', 'inventory.transfer.review', 'inventory.transfer.dispatch'], ['WAREHOUSE_MANAGER']),
    gm: nu(CHIEF, ['inventory.transfer.approve'], ['GENERAL_MANAGER']),
    admin: nu('99999999-0000-4000-8000-000000000001', [], ['ADMIN'], { isSuperAdmin: true }),
  });

  beforeEach(async () => {
    prisma = await database();
    const docsState = new Map<string, any>();
    const docs = {
      create: jest.fn(async () => { const id = randomUUID(); docsState.set(id, { status: 'DRAFT' }); return { id, lines: [{ itemId: ITEM, unitCost: '4.2500' }] }; }),
      findOne: jest.fn(async (...a: string[]) => docsState.get(a[1]) ?? { status: 'DRAFT' }),
      approve: jest.fn(async (...a: string[]) => { const d = docsState.get(a[2]); d.approvedAt = new Date(); return d; }),
      post: jest.fn(async (...a: string[]) => { docsState.get(a[2]).status = 'POSTED'; return { status: 'POSTED' }; }),
      reverse: jest.fn(async () => ({ status: 'REVERSED' })),
    };
    const audit = { record: async () => undefined };
    notif = new NotificationsService(prisma as never);
    approvals = new ApprovalsService(prisma as never, audit as never);
    service = new StockTransfersService(prisma as never, docs as never, audit as never, notif as never, approvals);
  });
  afterEach(async () => { await prisma.$disconnect(); });

  const open = (k = 'c1') => service.create(COMPANY, REQUESTER, { sourceWarehouseId: FROM, destinationWarehouseId: TO, transferDate: '2026-11-23', reason: 'r', idempotencyKey: k, lines: [{ itemId: ITEM, quantity: '10' }] });
  const twoLevels = (p1: string, p2: string) => approvals.createPolicy(actor(REQUESTER, ['admin.approvals.manage'], ['ADMIN']), { operation: 'STOCK_TRANSFER', nameEn: 'x', nameAr: 'x', levels: [
    { nameEn: 'L1', nameAr: 'م', permission: p1, roleCode: 'WAREHOUSE_MANAGER' },
    { nameEn: 'L2', nameAr: 'ع', permission: p2, roleCode: 'GENERAL_MANAGER' }] } as never);

  it('legacy flow: approvers are told, the requester hears approval and only the requester', async () => {
    const t = await open();
    let u = users();
    expect(await sees(u.whMgr)).toContain('STOCK_TRANSFER_REVIEW_REQUIRED');
    await service.submit(COMPANY, MANAGER, t.id, 's1');
    expect(await sees(u.whMgr)).toEqual(['STOCK_TRANSFER_APPROVAL_REQUIRED']);
    await service.approve(COMPANY, CHIEF, t.id, 'a1', actor(CHIEF, ['inventory.transfer.approve'], ['GENERAL_MANAGER']));
    expect(await sees(u.gm)).not.toContain('STOCK_TRANSFER_APPROVAL_REQUIRED');
    expect(await sees(u.requester)).toEqual(['DOCUMENT_APPROVED']);
    expect(await sees(u.colleague)).toEqual([]);
    // A super admin sees the workflow's tasks, never somebody else's personal notice.
    expect(await sees(u.admin)).not.toContain('DOCUMENT_APPROVED');
  });

  it('chain with different permissions: level 2 approver is told, level 1 is not after deciding', async () => {
    await twoLevels('inventory.transfer.approve', 'inventory.transfer.approve.final');
    const U = { ...users(), gm: nu(CHIEF, ['inventory.transfer.approve.final'], ['GENERAL_MANAGER']) };
    const t = await open();
    expect(await sees(U.whMgr)).toContain('STOCK_TRANSFER_REVIEW_REQUIRED');
    await service.submit(COMPANY, REQUESTER, t.id, 's1');
    expect(await sees(U.whMgr)).toEqual(['STOCK_TRANSFER_LEVEL_PENDING']);
    expect(await sees(U.gm)).toEqual([]);
    await service.approve(COMPANY, MANAGER, t.id, 'a1', actor(MANAGER, ['inventory.transfer.approve'], ['WAREHOUSE_MANAGER']));
    expect(await sees(U.gm)).toEqual(['STOCK_TRANSFER_LEVEL_PENDING']);
    expect(await sees(U.whMgr)).toEqual([]);
    await service.approve(COMPANY, CHIEF, t.id, 'a2', actor(CHIEF, ['inventory.transfer.approve.final'], ['GENERAL_MANAGER']));
    expect(await sees(U.gm)).not.toContain('STOCK_TRANSFER_LEVEL_PENDING');
    expect(await sees(U.requester)).toEqual(['DOCUMENT_APPROVED']);
  });

  it('same permission, different roles: the level audience is the role', async () => {
    await twoLevels('inventory.transfer.approve', 'inventory.transfer.approve');
    const U = users();
    const t = await open();
    await service.submit(COMPANY, REQUESTER, t.id, 's1');
    expect(await sees(U.whMgr)).toEqual(['STOCK_TRANSFER_LEVEL_PENDING']);
    expect(await sees(U.gm)).toEqual([]);
    await service.approve(COMPANY, MANAGER, t.id, 'a1', actor(MANAGER, ['inventory.transfer.approve'], ['WAREHOUSE_MANAGER']));
    expect(await sees(U.whMgr)).toEqual([]);
    expect(await sees(U.gm)).toEqual(['STOCK_TRANSFER_LEVEL_PENDING']);
  });

  it('return for amendment leaves no stale approver task and tells only the requester', async () => {
    await twoLevels('inventory.transfer.approve', 'inventory.transfer.approve');
    const U = users();
    const t = await open();
    await service.submit(COMPANY, REQUESTER, t.id, 's1');
    await service.returnForAmendment(COMPANY, MANAGER, t.id, 'r1', 'fix qty', actor(MANAGER, ['inventory.transfer.approve'], ['WAREHOUSE_MANAGER']));
    expect(await sees(U.whMgr)).toEqual([]);
    expect(await sees(U.gm)).toEqual([]);
    expect(await sees(U.requester)).toEqual(['STOCK_TRANSFER_RETURNED']);
    expect(await sees(U.colleague)).toEqual([]);
    await service.submit(COMPANY, REQUESTER, t.id, 's2');
    expect(await sees(U.requester)).toEqual([]);
    expect(await sees(U.whMgr)).toEqual(['STOCK_TRANSFER_LEVEL_PENDING']);
    // The resubmitted request starts again at level 1 and can be approved to the end.
    await service.approve(COMPANY, MANAGER, t.id, 'a3', actor(MANAGER, ['inventory.transfer.approve'], ['WAREHOUSE_MANAGER']));
    expect(await sees(U.gm)).toEqual(['STOCK_TRANSFER_LEVEL_PENDING']);
    await service.approve(COMPANY, CHIEF, t.id, 'a4', actor(CHIEF, ['inventory.transfer.approve'], ['GENERAL_MANAGER']));
    expect(await sees(U.requester)).toEqual(['DOCUMENT_APPROVED']);
  });

  it('rejection closes approver tasks and tells the requester with the reason', async () => {
    await twoLevels('inventory.transfer.approve', 'inventory.transfer.approve');
    const U = users();
    const t = await open();
    await service.submit(COMPANY, REQUESTER, t.id, 's1');
    await service.reject(COMPANY, MANAGER, t.id, 'rj', 'no budget', actor(MANAGER, ['inventory.transfer.approve'], ['WAREHOUSE_MANAGER']));
    expect(await sees(U.whMgr)).toEqual([]);
    expect(await sees(U.gm)).toEqual([]);
    const mine: any = await notif.list(U.requester, { status: 'OPEN' });
    expect(mine.items.map((i: any) => i.type)).toEqual(['DOCUMENT_REJECTED']);
    expect(JSON.stringify(mine.items[0])).toContain('no budget');
    expect(await sees(U.colleague)).toEqual([]);
  });

  it('orders: the right approver is told, approval clears it at once and tells the author', async () => {
    const CUST = '88888888-8888-4888-8888-888888888881';
    const SO = '99999999-9999-4999-8999-999999999991';
    await prisma.$executeRawUnsafe(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${CUST}','${COMPANY}','C1','Cust','عميل',now())`);
    await prisma.$executeRawUnsafe(`INSERT INTO sales_orders(id,"companyId","branchId","customerId","orderNumber","orderDate","createdBy") VALUES ('${SO}','${COMPANY}','${BRANCH_A}','${CUST}','SO-1',current_date,'${REQUESTER}')`);
    const U: any = {
      salesMgr: nu(MANAGER, ['sales.orders.approve', 'sales.orders.read'], ['SALES_MANAGER']),
      storekeeper: nu(CHIEF, ['inventory.stock.approve', 'inventory.stock.read'], ['STOREKEEPER']),
      author: nu(REQUESTER, ['sales.orders.read'], ['SALES']),
    };
    await notif.scanBusiness(COMPANY);
    expect(await sees(U.salesMgr)).toEqual(['SALES_ORDER_PENDING_APPROVAL']);
    expect(await sees(U.storekeeper)).toEqual([]);
    const orders = new SalesOrdersService(prisma as never, {} as never, { get: async () => ({ segregationOfDuties: false }) } as never, undefined as never, undefined as never, { recordRequired: async () => undefined } as never, notif);
    await orders.approve(COMPANY, MANAGER, SO);
    expect(await sees(U.salesMgr)).toEqual([]);
    expect(await sees(U.author)).toEqual(['DOCUMENT_APPROVED']);
  });

  it('stock count, write-off and voucher scans run against the real schema and reach the right approvers', async () => {
    const STK = '99999999-9999-4999-8999-999999999993';
    await prisma.$executeRawUnsafe(`INSERT INTO stock_take_sessions(id,"companyId","branchId","warehouseId",code,status,"updatedAt") VALUES ('${STK}','${COMPANY}','${BRANCH_A}','${FROM}','ST-1','REVIEW',now())`).catch(async () =>
      prisma.$executeRawUnsafe(`INSERT INTO stock_take_sessions(id,"companyId","branchId","warehouseId",code,status) VALUES ('${STK}','${COMPANY}','${BRANCH_A}','${FROM}','ST-1','REVIEW')`));
    const U: any = {
      countApprover: nu(MANAGER, ['inventory.stocktake.approve'], ['WAREHOUSE_MANAGER']),
      other: nu(CHIEF, ['inventory.stock.read'], ['STOREKEEPER']),
    };
    await notif.scanBusiness(COMPANY);
    expect(await sees(U.countApprover)).toEqual(['STOCKTAKE_PENDING_APPROVAL']);
    expect(await sees(U.other)).toEqual([]);
    // Approval clears the task at once and tells the person who opened the count.
    await prisma.$executeRawUnsafe(`UPDATE stock_take_sessions SET "createdBy"='${REQUESTER}' WHERE id='${STK}'`);
    const takes = new StockTakesService(prisma as never, undefined as never, undefined as never, undefined as never, undefined as never, { record: async () => undefined } as never, notif);
    await takes.approve(COMPANY, MANAGER, STK);
    expect(await sees(U.countApprover)).toEqual([]);
    expect(await sees(nu(REQUESTER, [], ['STOREKEEPER']))).toEqual(['DOCUMENT_APPROVED']);
    expect(await sees(U.other)).toEqual([]);
  });

  it('write-off and reviewed voucher alerts reach their own approvers; approving a write-off clears it and tells its author', async () => {
    const WO = '99999999-9999-4999-8999-999999999995';
    const VO = '99999999-9999-4999-8999-999999999996';
    const ins = (id: string, kind: string, no: string, extra: string, extraVal: string) =>
      prisma.$executeRawUnsafe(`INSERT INTO stock_documents(id,"companyId","branchId",kind,"documentNumber","documentDate","updatedAt","createdBy"${extra}) VALUES ('${id}','${COMPANY}','${BRANCH_A}','${kind}','${no}',current_date,now(),'${REQUESTER}'${extraVal})`);
    await ins(WO, 'WRITE_OFF', 'WO-1', '', '');
    await ins(VO, 'ADJUSTMENT', 'SV-1', ',"voucherKind","reviewedAt","counterpartyName"', ",'ISSUE',now(),'x'");
    const U: any = {
      writeOffApprover: nu(MANAGER, ['inventory.writeoff.approve'], ['WAREHOUSE_MANAGER']),
      voucherApprover: nu(CHIEF, ['inventory.stock.approve'], ['WAREHOUSE_MANAGER']),
      author: nu(REQUESTER, [], ['STOREKEEPER']),
    };
    await notif.scanBusiness(COMPANY);
    expect(await sees(U.writeOffApprover)).toEqual(['WRITEOFF_PENDING_APPROVAL']);
    expect(await sees(U.voucherApprover)).toEqual(['STOCK_VOUCHER_PENDING_APPROVAL']);
    const docs = new StockDocumentsService(prisma as never, undefined as never, undefined as never, undefined as never, { record: async () => undefined } as never, undefined as never, undefined as never, undefined as never, undefined as never, notif);
    await docs.approve(COMPANY, MANAGER, WO, true).catch((e: Error) => {
      if (!/findOne|undefined|Cannot read/.test(String(e.stack))) throw e;
    });
    expect(await sees(U.writeOffApprover)).toEqual([]);
    expect(await sees(U.author)).toEqual(['DOCUMENT_APPROVED']);
    expect(await sees(U.voucherApprover)).toEqual(['STOCK_VOUCHER_PENDING_APPROVAL']);
  });
});
