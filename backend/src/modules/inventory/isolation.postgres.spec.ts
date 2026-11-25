import { randomUUID } from 'node:crypto';

import { canReadCost } from '../../common/auth/cost-visibility';
import { PrismaService } from '../../common/prisma/prisma.service';
import { warehouseScopeOf } from '../../common/warehouse/warehouse.service';
import { StockDocumentsService } from './stock-documents.service';
import { StockService } from './stock.service';
import { WarehouseAccessService } from './warehouse-access.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';

/**
 * Company, branch and warehouse isolation against a real PostgreSQL server.
 *
 * The unit tests can only prove that a controller forwards the right filter.
 * They cannot prove that the filter actually excludes rows, because they mock
 * the database. This suite writes two branches, warehouses and an item into a
 * real database and then asks the read paths the same questions a hostile
 * client would: with a branch id, with a warehouse id, and with another
 * company's identifier.
 *
 * It is deliberately shaped around what the API must refuse, not around how it
 * is implemented, so a later refactor that keeps the behaviour keeps passing.
 */
const run = process.env.KAYAN_WAREHOUSE_ACCESS_PG === '1';
(run ? describe : describe.skip)('company, branch and warehouse isolation', () => {
  jest.setTimeout(120_000);

  const fixtureCompanyId = randomUUID();
  /** Resolved in beforeAll: either our own company or one already present. */
  let companyId: string = fixtureCompanyId;
  /** True when this suite created the company and may therefore remove it. */
  let ownsCompany = false;
  /** One stable suffix for every name this suite writes. */
  const suffix = fixtureCompanyId.slice(0, 8);
  const branchA = randomUUID();
  const branchB = randomUUID();
  const warehouseA = randomUUID();
  const warehouseB = randomUUID();
  const warehouseA2 = randomUUID();
  const itemId = randomUUID();
  const stockDocumentB = randomUUID();

  let prisma: PrismaService;
  let stock: StockService;
  let documents: StockDocumentsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    // A partial unique index allows exactly one live company per database, and
    // another suite may already have created one. This suite needs a company to
    // scope rows to, not a company of its own: a second company is created only
    // when the database has none, and an existing one is borrowed and left
    // exactly as it was found.
    const live = await prisma.company.findFirst({
      where: { deletedAt: null },
      select: { id: true, code: true },
    });
    ownsCompany = live === null;
    if (live !== null) companyId = live.id;
    if (ownsCompany) {
      await prisma.company.create({
        data: { id: companyId, code: `ISO-${suffix}`, nameEn: 'Isolation', nameAr: 'عزل' },
      });
    }
    await prisma.branch.createMany({
      data: [
        { id: branchA, companyId, code: `ISO-A-${suffix}`, nameEn: 'Branch A', nameAr: 'فرع أ' },
        { id: branchB, companyId, code: `ISO-B-${suffix}`, nameEn: 'Branch B', nameAr: 'فرع ب' },
      ],
    });
    await prisma.warehouse.createMany({
      data: [
        { id: warehouseA, companyId, branchId: branchA, code: `ISO-A1-${suffix}`, nameEn: 'A1', nameAr: 'أ1' },
        { id: warehouseA2, companyId, branchId: branchA, code: `ISO-A2-${suffix}`, nameEn: 'A2', nameAr: 'أ2' },
        { id: warehouseB, companyId, branchId: branchB, code: `ISO-B1-${suffix}`, nameEn: 'B1', nameAr: 'ب1' },
      ],
    });
    await prisma.item.create({
      data: { id: itemId, companyId, code: `ISO-ITEM-${suffix}`, nameEn: 'Widget', nameAr: 'صنف', unit: 'unit' },
    });

    // Real ledger rows, because every read path below is derived from them.
    await prisma.stockMovement.createMany({
      data: [
        {
          companyId, branchId: branchA, warehouseId: warehouseA, itemId,
          direction: 'IN', quantity: '4', unitCost: '10', totalCost: '40',
          movementDate: new Date('2026-01-10'), referenceType: 'OPENING',
        },
        {
          companyId, branchId: branchA, warehouseId: warehouseA2, itemId,
          direction: 'IN', quantity: '6', unitCost: '10', totalCost: '60',
          movementDate: new Date('2026-01-11'), referenceType: 'OPENING',
        },
        {
          companyId, branchId: branchB, warehouseId: warehouseB, itemId,
          direction: 'IN', quantity: '9', unitCost: '10', totalCost: '90',
          movementDate: new Date('2026-01-12'), referenceType: 'OPENING',
        },
      ],
    });
    await prisma.stockBalance.createMany({
      data: [
        { companyId, branchId: branchA, itemId, quantity: '10', value: '100' },
        { companyId, branchId: branchB, itemId, quantity: '9', value: '90' },
      ],
    });
    await prisma.warehouseStockBalance.createMany({
      data: [
        { companyId, branchId: branchA, warehouseId: warehouseA, itemId, quantity: '4', value: '40' },
        { companyId, branchId: branchA, warehouseId: warehouseA2, itemId, quantity: '6', value: '60' },
        { companyId, branchId: branchB, warehouseId: warehouseB, itemId, quantity: '9', value: '90' },
      ],
    });
    // A document that exists only in branch B, so its absence from branch A's
    // list is a real exclusion and not an empty table.
    await prisma.stockDocument.create({
      data: {
        id: stockDocumentB, companyId, branchId: branchB, kind: 'ADJUSTMENT',
        documentNumber: `ISO-DOC-${suffix}`, documentDate: new Date('2026-01-12'),
      },
    });

    stock = new StockService(prisma);
    documents = new StockDocumentsService(
      prisma, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never,
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    // Only the rows this suite created, by exact id. The company may be a
    // borrowed one that holds real rows, so a company-wide delete is never safe.
    const branchIds = [branchA, branchB];
    const warehouseIds = [warehouseA, warehouseA2, warehouseB];
    await prisma.stockMovement.deleteMany({ where: { companyId, itemId, branchId: { in: branchIds }, warehouseId: { in: warehouseIds } } });
    await prisma.warehouseStockBalance.deleteMany({ where: { companyId, itemId, warehouseId: { in: warehouseIds } } });
    await prisma.stockBalance.deleteMany({ where: { companyId, itemId, branchId: { in: branchIds } } });
    await prisma.stockDocument.deleteMany({ where: { companyId, id: stockDocumentB } });
    await prisma.item.deleteMany({ where: { companyId, id: itemId } });
    await prisma.userWarehouseAccess.deleteMany({ where: { companyId, warehouseId: { in: warehouseIds } } });
    await prisma.warehouse.deleteMany({ where: { companyId, id: { in: warehouseIds } } });
    await prisma.branch.deleteMany({ where: { companyId, id: { in: branchIds } } });
    if (ownsCompany) await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  // The two account shapes that matter. Both are ordinary users; the only
  // difference is which branch they belong to.
  const accountOfBranchA = { companyId, userId: randomUUID(), branchId: branchA, branchIds: [branchA] };
  // A company-wide account is built the way production builds one: no branch
  // and a company-wide role (or a super administrator). An account with no
  // branch and no such role fails closed (see branch-read-scope.ts).
  const companyWide = { companyId, userId: randomUUID(), branchId: null, branchIds: [], roles: ['GENERAL_MANAGER'] };
  const superAdmin = { companyId, userId: randomUUID(), branchId: null, branchIds: [], roles: [], isSuperAdmin: true };
  const ordinaryNoBranch = { companyId, userId: randomUUID(), branchId: null, branchIds: [], roles: ['SALES_CLERK'] };

  describe('company boundaries', () => {
    it('answers another company with nothing, not with this company rows', async () => {
      const otherCompany = randomUUID();
      expect(await stock.balances(otherCompany, {})).toEqual([]);
      expect((await documents.findAll(otherCompany, {})).items).toEqual([]);
      // The item belongs to this company, so it is "not found" in another one.
      await expect(stock.itemLedger(otherCompany, itemId)).rejects.toMatchObject({ status: 404 });
    });

    it('does not find this company item through the other company scope', async () => {
      const warehouseService = new WarehouseService(prisma, { record: async () => {} } as never);
      await expect(warehouseService.findOne(randomUUID(), warehouseA)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('branch boundaries', () => {
    it('gives a branch-bound account only its own branch balances', async () => {
      const rows = await stock.balances(companyId, { branchId: branchA });
      expect(rows.map((row) => row.branchId)).toEqual([branchA]);
      // Asking without a branch must widen to every branch this company has,
      // which includes any branch a shared database already held.
      const all = await stock.balances(companyId, {});
      expect(all.map((row) => row.branchId)).toEqual(expect.arrayContaining([branchA, branchB]));
    });

    it('keeps another branch document out of the list', async () => {
      const own = await documents.findAll(
        companyId, { branchId: branchA }, branchA, undefined,
      );
      expect(own.items.map((row) => row.id)).not.toContain(stockDocumentB);
      const foreign = await documents.findAll(
        companyId, { branchId: branchB }, null, undefined,
      );
      expect(foreign.items.map((row) => row.id)).toContain(stockDocumentB);
    });

    it('restricts an item ledger to the branches the account holds', async () => {
      const branchBound = await stock.itemLedger(
        companyId, itemId, true, undefined, warehouseScopeOf(accountOfBranchA),
      );
      expect(branchBound.movements).toHaveLength(2);
      // The fixture branches carry unique codes, because a shared database may
      // already hold branches called A or B.
      expect(branchBound.movements.every((m) => m.branchCode === `ISO-A-${suffix}`)).toBe(true);
      // The company-wide account sees the same item in both branches, so the
      // earlier assertion is isolation and not an empty ledger.
      const everywhere = await stock.itemLedger(companyId, itemId, true, undefined, warehouseScopeOf(companyWide));
      expect(everywhere.movements).toHaveLength(3);
      // An ordinary account with no branch assignment fails closed: it sees no
      // ledger rows from either branch (nothing is widened to make it pass).
      const nothing = await stock.itemLedger(companyId, itemId, true, undefined, warehouseScopeOf(ordinaryNoBranch));
      expect(nothing.movements).toHaveLength(0);
    });
  });

  describe('warehouse boundaries', () => {
    it('shows a warehouse-restricted account its own shelves, not the branch total', async () => {
      const restricted = (await stock.balances(
        companyId, { branchId: branchA }, true, [warehouseA],
      )) as Array<{ warehouseId: string; quantity: string }>;
      expect(restricted).toHaveLength(1);
      expect(restricted[0].warehouseId).toBe(warehouseA);
      expect(restricted[0].quantity).toBe('4.0000');
      // A branch total would say 10 and would include a shelf never granted.
      expect(restricted[0].quantity).not.toBe('10.0000');
      const unrestricted = await stock.balances(companyId, { branchId: branchA });
      const branchTotal = unrestricted.find(
        (row) => 'branchId' in row && row.branchId === branchA,
      );
      expect(branchTotal && 'quantity' in branchTotal ? branchTotal.quantity : null).toBe('10.0000');
    });

    it('shows an account with no granted warehouse nothing at all', async () => {
      expect(await stock.balances(companyId, { branchId: branchA }, true, [])).toEqual([]);
    });

    it('never reveals cost through the warehouse-restricted balance view', async () => {
      const restricted = (await stock.balances(
        companyId, { branchId: branchA }, false, [warehouseA],
      )) as Array<{ value: null; averageCost: null }>;
      expect(restricted[0].value).toBeNull();
      expect(restricted[0].averageCost).toBeNull();
      const withCost = (await stock.balances(
        companyId, { branchId: branchA }, true, [warehouseA],
      )) as Array<{ value: null }>;
      // Even a caller allowed cost is not shown it here: the warehouse view is
      // not a cost surface, and the valuation report remains the one place.
      expect(withCost[0].value).toBeNull();
    });

    it('keeps a foreign warehouse out of the per-warehouse ledger view', async () => {
      const ledger = await stock.itemLedger(companyId, itemId, true, [warehouseA]);
      expect(ledger.movements.map((m) => m.warehouseCode)).toEqual([`ISO-A1-${suffix}`]);
    });
  });

  describe('the last warehouse restriction cannot be removed', () => {
    it('refuses to widen a restricted user to every warehouse', async () => {
      const userId = randomUUID();
      await prisma.user.create({
        data: {
          id: userId, companyId, username: `iso-${userId.slice(0, 8)}`,
          fullNameEn: 'Restricted', fullNameAr: 'مقيد', passwordHash: 'not-a-login',
        },
      });
      await prisma.userBranch.create({ data: { userId, branchId: branchA } });
      const access = new WarehouseAccessService(prisma, { record: async () => {} } as never);
      await access.setForUser(companyId, userId, userId, [{ warehouseId: warehouseA }]);
      // An empty grant list means "every warehouse". A person who was
      // restricted must not be able to hand themselves that.
      await expect(
        access.setForUser(companyId, userId, userId, [], [branchA]),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await prisma.userWarehouseAccess.count({ where: { companyId, userId } }),
      ).toBe(1);
      await prisma.userWarehouseAccess.deleteMany({ where: { userId } });
      await prisma.userBranch.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });
  });

  describe('the redaction inputs are the same ones the routes use', () => {
    it('reads cost only for a caller who holds the permission', () => {
      const withoutCost = { permissions: ['inventory.stock.read'] };
      const withCost = { permissions: ['inventory.stock.read', 'inventory.cost.read'] };
      expect(canReadCost(withoutCost as never)).toBe(false);
      expect(canReadCost(withCost as never)).toBe(true);
    });

    it('keeps company-wide roles unrestricted and fails closed for an ordinary account with no branch', () => {
      expect(warehouseScopeOf(companyWide)).toBeNull();
      expect(warehouseScopeOf(superAdmin)).toBeNull();
      expect(warehouseScopeOf(ordinaryNoBranch)).toEqual([]);
      expect(warehouseScopeOf({ ...ordinaryNoBranch, roles: [] })).toEqual([]);
      expect(warehouseScopeOf(accountOfBranchA)).toEqual([branchA]);
    });
  });
});
