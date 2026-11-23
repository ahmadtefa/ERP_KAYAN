/// The approval engine against a real PostgreSQL server.
///
/// PGlite proves the SQL runs; this proves the behaviour that needs a second
/// connection to matter: two users deciding the same level at the same
/// moment, and a real foreign-key graph underneath the chain.
///
/// Runs only when `KAYAN_APPROVALS_PG=1` and a DATABASE_URL is present, the
/// same convention the other real-database specs in this repository use.
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService, ApprovalActor } from './approvals.service';

const enabled = process.env.KAYAN_APPROVALS_PG === '1' && Boolean(process.env.DATABASE_URL);

// The client is generated engine-less and runs on a driver adapter, so it is
// constructed the same way the application constructs it — but only when the
// suite is actually going to run. Constructing it at import time would make
// a skipped suite demand a database, which is exactly what skipping avoids.
let prisma: PrismaService;

const audit = { record: async () => undefined } as never;

jest.setTimeout(120_000);

(enabled ? describe : describe.skip)('approval engine on real PostgreSQL', () => {
  let approvals: ApprovalsService;
  let companyId: string;
  let otherCompanyId: string;
  /// A real seeded user, because `createdBy` and `actorId` are foreign keys to
  /// `users` and a made-up UUID is rightly refused by the database.
  let adminId: string;
  /// A second real user, so decisions and requester ids are genuine foreign
  /// keys rather than invented strings the database would reject.
  let secondId: string;
  /// A third real account, so the simultaneous-decision test has two genuine
  /// people who are both neither the requester nor each other.
  let thirdId: string;
  const suffix = randomUUID().slice(0, 8);

  const actor = (
    userId: string,
    permissions: string[],
    roles: string[],
    company = companyId,
  ): ApprovalActor => ({ userId, companyId: company, permissions, roles });

  beforeAll(async () => {
    prisma = new PrismaService();
    approvals = new ApprovalsService(prisma as never, audit);
    // Borrow the installation's single live company, then add a soft-deleted
    // one for the isolation check. Creating a second live company would
    // violate the one-active-company index, which is a schema guarantee.
    const live = await prisma.company.findFirst({ where: { deletedAt: null }, select: { id: true } });
    if (!live) throw new Error('No live company in this database; run prisma/seed.ts first');
    companyId = live.id;
    const admin = await prisma.user.findFirst({
      where: { companyId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) throw new Error('No user in the live company; run prisma/seed.ts first');
    adminId = admin.id;
    // A genuine second account, so a decision is made by somebody other than
    // the requester and the foreign key on `actorId` is satisfied by a real
    // user. Created here rather than assumed, because a fresh database has
    // exactly one person in it.
    const second = await prisma.user.create({
      data: {
        companyId,
        username: `approval-probe-${suffix}`,
        fullNameEn: 'Approval probe',
        fullNameAr: 'فحص الموافقات',
        passwordHash: 'not-a-real-hash-these-tests-never-sign-in',
      },
      select: { id: true },
    });
    secondId = second.id;
    const third = await prisma.user.create({
      data: {
        companyId,
        username: `approval-probe-b-${suffix}`,
        fullNameEn: 'Approval probe B',
        fullNameAr: 'فحص الموافقات ب',
        passwordHash: 'not-a-real-hash-these-tests-never-sign-in',
      },
      select: { id: true },
    });
    thirdId = third.id;
    const other = await prisma.company.create({
      data: {
        code: `APR-${suffix}`,
        nameEn: 'Approval probe company',
        nameAr: 'شركة فحص الموافقات',
        deletedAt: new Date(),
      },
      select: { id: true },
    });
    otherCompanyId = other.id;
  });

  afterEach(async () => {
    await prisma.approvalPolicy.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  });

  afterAll(async () => {
    await prisma.approvalPolicy.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [secondId, thirdId] } } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: otherCompanyId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  const twoLevel = () =>
    approvals.createPolicy(actor(adminId, ['admin.approvals.manage'], ['ADMIN']), {
      operation: 'STOCK_TRANSFER',
      nameEn: `Two levels ${suffix}`,
      nameAr: `مستويان ${suffix}`,
      levels: [
        { nameEn: 'Warehouse manager', nameAr: 'مدير المخزن', permission: 'inventory.transfer.approve', roleCode: 'WAREHOUSE_MANAGER' },
        { nameEn: 'General manager', nameAr: 'المدير العام', permission: 'inventory.transfer.approve', roleCode: 'GENERAL_MANAGER' },
      ],
    });

  it('writes and reads a policy with its levels, in order', async () => {
    const created = await twoLevel();
    expect(created.levels.map((level) => level.level)).toEqual([1, 2]);
    const listed = await approvals.listPolicies(companyId);
    const mine = listed.items.find((item) => item.id === created.id)!;
    expect(mine.levels.map((level) => level.roleCode)).toEqual(['WAREHOUSE_MANAGER', 'GENERAL_MANAGER']);
  });

  it('declares the permissions the controller guards on', async () => {
    const rows = await prisma.permission.findMany({
      where: { code: { in: ['admin.approvals.read', 'admin.approvals.manage'] } },
      select: { code: true },
    });
    expect(rows.map((row) => row.code).sort()).toEqual([
      'admin.approvals.manage',
      'admin.approvals.read',
    ]);
  });

  it('refuses a policy naming an operation nothing enforces', async () => {
    await expect(
      approvals.createPolicy(actor(adminId, ['admin.approvals.manage'], ['ADMIN']), {
        operation: 'NOT_A_REAL_OPERATION',
        nameEn: 'Nope',
        nameAr: 'لا',
        levels: [{ nameEn: 'x', nameAr: 'س', permission: 'inventory.transfer.approve' }],
      }),
    ).rejects.toThrow(/Operation must be one of/);
  });

  it('renumbers levels so the chain can never have a gap', async () => {
    const created = await approvals.createPolicy(
      actor(adminId, ['admin.approvals.manage'], ['ADMIN']),
      {
        operation: 'STOCK_TRANSFER',
        nameEn: `Gap ${suffix}`,
        nameAr: `فجوة ${suffix}`,
        levels: [
          { level: 5, nameEn: 'first', nameAr: 'أول', permission: 'inventory.transfer.approve' },
          { level: 9, nameEn: 'second', nameAr: 'ثان', permission: 'inventory.transfer.approve' },
        ],
      },
    );
    expect(created.levels.map((level) => level.level)).toEqual([1, 2]);
  });

  it('records a decision once the level permission and role are both held', async () => {
    const policy = await twoLevel();
    const entityId = randomUUID();
    const chain = await approvals.chainFor(companyId, 'STOCK_TRANSFER', {
      branchIds: [],
      sourceWarehouseId: null,
      destinationWarehouseId: null,
      amount: '10',
      quantity: '10',
    });
    expect(chain.policyId).toBe(policy.id);
    const result = await approvals.decide(
      actor(secondId, ['inventory.transfer.approve'], ['WAREHOUSE_MANAGER']),
      {
        entityType: 'StockTransfer',
        entityId,
        chain,
        requesterId: adminId,
        decision: 'APPROVE',
      },
    );
    expect(result.state.pendingLevel).toBe(2);
    expect(result.state.isComplete).toBe(false);
    await prisma.approvalDecision.deleteMany({ where: { entityId } });
  });

  it('refuses the requester with a database round-trip in the way', async () => {
    await twoLevel();
    const chain = await approvals.chainFor(companyId, 'STOCK_TRANSFER', {
      branchIds: [], sourceWarehouseId: null, destinationWarehouseId: null, amount: '10', quantity: '10',
    });
    await expect(
      approvals.decide(actor(adminId, ['*'], ['ADMIN', 'WAREHOUSE_MANAGER']), {
        entityType: 'StockTransfer',
        entityId: randomUUID(),
        chain,
        requesterId: adminId,
        decision: 'APPROVE',
      }),
    ).rejects.toThrow(/cannot decide their own/);
  });

  it('lets only one of two simultaneous deciders close the same level', async () => {
    await twoLevel();
    const entityId = randomUUID();
    const chain = await approvals.chainFor(companyId, 'STOCK_TRANSFER', {
      branchIds: [], sourceWarehouseId: null, destinationWarehouseId: null, amount: '10', quantity: '10',
    });
    const decide = (userId: string) =>
      approvals.decide(actor(userId, ['inventory.transfer.approve'], ['WAREHOUSE_MANAGER']), {
        entityType: 'StockTransfer',
        entityId,
        chain,
        requesterId: adminId,
        decision: 'APPROVE',
      });
    // Two different real people, both holding the level's role, deciding the
    // same level at the same moment. Exactly one approval may land: the
    // unique index, not the read-then-write in the service, is what makes
    // that true under real contention.
    const outcomes = await Promise.allSettled([decide(secondId), decide(thirdId)]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const recorded = await prisma.approvalDecision.count({
      where: { entityId, level: 1, decision: 'APPROVE' },
    });
    expect(recorded).toBe(1);
    await prisma.approvalDecision.deleteMany({ where: { entityId } });
  });

  it('keeps policies of two companies apart', async () => {
    await twoLevel();
    await approvals.createPolicy(actor(adminId, ['admin.approvals.manage'], ['ADMIN'], otherCompanyId), {
      operation: 'STOCK_TRANSFER',
      nameEn: `Other ${suffix}`,
      nameAr: `أخرى ${suffix}`,
      levels: [{ nameEn: 'Only', nameAr: 'فقط', permission: 'inventory.transfer.approve' }],
    });
    const mine = await approvals.listPolicies(companyId);
    const theirs = await approvals.listPolicies(otherCompanyId);
    expect(mine.items.every((item) => item.nameEn.includes(suffix))).toBe(true);
    expect(theirs.items.map((item) => item.nameEn)).toEqual([`Other ${suffix}`]);
    expect(mine.items.find((item) => item.nameEn === `Other ${suffix}`)).toBeUndefined();
  });

  it('replaces the levels wholesale when a policy is edited', async () => {
    const created = await twoLevel();
    const updated = await approvals.updatePolicy(
      actor(adminId, ['admin.approvals.manage'], ['ADMIN']),
      created.id,
      {
        operation: 'STOCK_TRANSFER',
        nameEn: created.nameEn,
        nameAr: created.nameAr,
        levels: [
          { nameEn: 'Only level', nameAr: 'مستوى واحد', permission: 'inventory.transfer.approve' },
        ],
      },
    );
    expect(updated.levels).toHaveLength(1);
    expect(updated.levels[0].level).toBe(1);
  });

  it('keeps the decision history when the policy is deleted', async () => {
    const policy = await twoLevel();
    const entityId = randomUUID();
    const chain = await approvals.chainFor(companyId, 'STOCK_TRANSFER', {
      branchIds: [], sourceWarehouseId: null, destinationWarehouseId: null, amount: '10', quantity: '10',
    });
    await approvals.decide(actor(secondId, ['inventory.transfer.approve'], ['WAREHOUSE_MANAGER']), {
      entityType: 'StockTransfer', entityId, chain, requesterId: adminId, decision: 'APPROVE',
    });
    await approvals.deletePolicy(actor(adminId, ['admin.approvals.manage'], ['ADMIN']), policy.id);
    const history = await approvals.history(companyId, 'StockTransfer', entityId);
    expect(history.items).toHaveLength(1);
    expect(history.items[0].decision).toBe('APPROVE');
    // The policy link is nulled rather than cascading the audit away.
    expect(history.items[0].policy).toBeNull();
    await prisma.approvalDecision.deleteMany({ where: { entityId } });
  });
});
