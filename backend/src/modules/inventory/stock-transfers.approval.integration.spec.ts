import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pglitePrisma } from '../../testing/pglite-adapter';
import { ApprovalsService, ApprovalActor } from '../../common/approvals/approvals.service';
import { StockTransfersService } from './stock-transfers.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH_A = '22222222-2222-4222-8222-222222222222';
const BRANCH_B = '22222222-2222-4222-8222-222222222223';
const REQUESTER = '33333333-3333-4333-8333-333333333331';
const MANAGER = '33333333-3333-4333-8333-333333333332';
const CHIEF = '33333333-3333-4333-8333-333333333333';
const FROM = '44444444-4444-4444-8444-444444444444';
const TO = '55555555-5555-4555-8555-555555555555';
const ITEM = '66666666-6666-4666-8666-666666666666';
const UNIT = '77777777-7777-4777-8777-777777777777';
const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

async function database() {
  const db = new PGlite();
  for (const dir of readdirSync(migrationsDir, { withFileTypes: true })
    .filter((x) => x.isDirectory())
    .map((x) => x.name)
    .sort()) {
    try {
      await db.exec(readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8'));
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('already exists')) throw e;
    }
  }
  await db.exec(`
    INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES
      ('${COMPANY}','CO','Company','شركة',now());
    INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES
      ('${BRANCH_A}','${COMPANY}','A','A','أ',now()),('${BRANCH_B}','${COMPANY}','B','B','ب',now());
    INSERT INTO warehouses(id,"companyId","branchId",code,"nameEn","nameAr","isDefault","isActive","updatedAt") VALUES
      ('${FROM}','${COMPANY}','${BRANCH_A}','FROM','From','من',true,true,now()),
      ('${TO}','${COMPANY}','${BRANCH_B}','TO','To','إلى',true,true,now());
    INSERT INTO items(id,"companyId",code,"nameEn","nameAr",unit,"isStockTracked","requiresBatch","useFefo","salePrice","purchasePrice","updatedAt")
      VALUES('${ITEM}','${COMPANY}','I-1','Item','صنف','piece',true,false,true,4.25,4.25,now());
    INSERT INTO item_units(id,"itemId",unit,factor,"isActive","createdAt","updatedAt") VALUES
      ('${UNIT}','${ITEM}','piece',1,true,now(),now());
  `);
  return db;
}

jest.setTimeout(180_000);
const vmReady =
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules');

(vmReady ? describe : describe.skip)(
  'configured approval chain governing a stock transfer',
  () => {
    let db: PGlite;
    let service: StockTransfersService;
    let approvals: ApprovalsService;
    let raised: Array<Record<string, unknown>>;
    let posted: string[];

    const actor = (
      userId: string,
      permissions: string[],
      roles: string[],
      companyId: string = COMPANY,
    ): ApprovalActor => ({ userId, companyId, permissions, roles });

    // The manager who opens level 1 and the chief who closes level 2. Both
    // hold the transfer approve permission; the *roles* are what separate
    // them, which is the part a permission-only check would miss.
    const manager = () =>
      actor(MANAGER, ['inventory.transfer.approve', 'inventory.transfer.receive'], [
        'WAREHOUSE_MANAGER',
      ]);
    const chief = () =>
      actor(CHIEF, ['inventory.transfer.approve', 'inventory.transfer.receive'], [
        'GENERAL_MANAGER',
      ]);

    async function withChain(minimumAmount?: string) {
      const created = await approvals.createPolicy(
        actor(REQUESTER, ['admin.approvals.manage'], ['ADMIN']),
        {
          operation: 'STOCK_TRANSFER',
          nameEn: 'Two-level transfer approval',
          nameAr: 'اعتماد التحويل على مستويين',
          minimumAmount: minimumAmount ?? null,
          levels: [
            {
              nameEn: 'Warehouse manager',
              nameAr: 'مدير المخزن',
              permission: 'inventory.transfer.approve',
              roleCode: 'WAREHOUSE_MANAGER',
            },
            {
              nameEn: 'General manager',
              nameAr: 'المدير العام',
              permission: 'inventory.transfer.approve',
              roleCode: 'GENERAL_MANAGER',
            },
          ],
        },
      );
      return created;
    }

    beforeEach(async () => {
      db = await database();
      const prisma = pglitePrisma(db);
      raised = [];
      posted = [];
      const docsState = new Map<string, { status: string; approvedAt?: Date }>();
      const docs = {
        create: jest.fn(async () => {
          const id = randomUUID();
          docsState.set(id, { status: 'DRAFT' });
          return { id, lines: [{ itemId: ITEM, unitCost: '4.2500' }] };
        }),
        findOne: jest.fn(async (...args: string[]) => docsState.get(args[1]) ?? { status: 'DRAFT' }),
        approve: jest.fn(async (...args: string[]) => {
          const document = docsState.get(args[2])!;
          document.approvedAt = new Date();
          return document;
        }),
        post: jest.fn(async (...args: string[]) => {
          posted.push(args[2]);
          docsState.get(args[2])!.status = 'POSTED';
          return { status: 'POSTED' };
        }),
        reverse: jest.fn(async () => ({ status: 'REVERSED' })),
      };
      const notifications = {
        raise: async (input: Record<string, unknown>) => {
          raised.push(input);
          return { id: `n-${raised.length}` };
        },
        resolveEntity: async () => ({ closed: 0 }),
      };
      const audit = { record: async () => undefined };
      approvals = new ApprovalsService(prisma as never, audit as never);
      service = new StockTransfersService(
        prisma as never,
        docs as never,
        audit as never,
        notifications as never,
        approvals,
      );
    });

    afterEach(async () => db.close());

    const openTransfer = (key = 'create-001') =>
      service.create(COMPANY, REQUESTER, {
        sourceWarehouseId: FROM,
        destinationWarehouseId: TO,
        transferDate: '2026-11-23',
        reason: 'Branch replenishment',
        idempotencyKey: key,
        lines: [{ itemId: ITEM, quantity: '10' }],
      });

    it('leaves a company with no policy on the historical two-door flow', async () => {
      const transfer = await openTransfer();
      const path = await service.approvalPath(COMPANY, transfer.id);
      expect(path.source).toBe('LEGACY');
      expect(path.levels).toEqual([]);
      const reviewed = await service.submit(COMPANY, MANAGER, transfer.id, 'submit-001');
      expect(reviewed.status).toBe('REVIEWED');
      const approved = await service.approve(COMPANY, CHIEF, transfer.id, 'approve-001');
      expect(approved.status).toBe('APPROVED');
    });

    it('opens a chain instead of REVIEWED when a policy matches', async () => {
      await withChain();
      const transfer = await openTransfer();
      const submitted = await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');
      expect(submitted.status).toBe('PENDING_APPROVAL');
      const path = await service.approvalPath(COMPANY, transfer.id);
      expect(path.source).toBe('POLICY');
      expect((path.levels as Array<{ state: string }>).map((l) => l.state)).toEqual([
        'PENDING',
        'WAITING',
      ]);
    });

    it('refuses dispatch until every level has been decided', async () => {
      await withChain();
      const transfer = await openTransfer();
      await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');
      await expect(
        service.dispatch(COMPANY, REQUESTER, transfer.id, 'dispatch-early', [
          { lineId: transfer.lines[0].id, quantity: '10' },
        ]),
      ).rejects.toThrow(/Cannot dispatch a transfer in PENDING_APPROVAL/);
      expect(posted).toHaveLength(0);
    });

    it('walks two levels in order and only then approves', async () => {
      await withChain();
      const transfer = await openTransfer();
      await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');

      const afterFirst = await service.approve(
        COMPANY, MANAGER, transfer.id, 'approve-1', manager(),
      );
      expect(afterFirst.status).toBe('PENDING_APPROVAL');

      const afterSecond = await service.approve(
        COMPANY, CHIEF, transfer.id, 'approve-2', chief(),
      );
      expect(afterSecond.status).toBe('APPROVED');

      const path = await service.approvalPath(COMPANY, transfer.id);
      expect((path.levels as Array<{ state: string }>).map((l) => l.state)).toEqual([
        'APPROVED',
        'APPROVED',
      ]);
      expect(path.complete).toBe(true);
    });

    it('refuses the requester their own approval', async () => {
      await withChain();
      const transfer = await openTransfer();
      await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');
      await expect(
        service.approve(
          COMPANY,
          REQUESTER,
          transfer.id,
          'self-approve',
          actor(REQUESTER, ['*'], ['ADMIN', 'WAREHOUSE_MANAGER']),
        ),
      ).rejects.toThrow(/cannot decide their own/);
    });

    it('refuses a person who holds the permission but not the level role', async () => {
      await withChain();
      const transfer = await openTransfer();
      await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');
      await expect(
        service.approve(
          COMPANY,
          CHIEF,
          transfer.id,
          'wrong-role',
          actor(CHIEF, ['inventory.transfer.approve'], ['GENERAL_MANAGER']),
        ),
      ).rejects.toThrow(/WAREHOUSE_MANAGER/);
    });

    it('refuses the second level before the first is decided', async () => {
      await withChain();
      const transfer = await openTransfer();
      await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');
      // The chief tries to close "level 2" first. They hold the general-manager
      // role, but the chain is still at level 1.
      await expect(
        service.approve(COMPANY, CHIEF, transfer.id, 'skip', chief(), null, 2),
      ).rejects.toThrow(/level 1 is/);
    });

    it('rejects with a reason, records it, and keeps the goods where they are', async () => {
      await withChain();
      const transfer = await openTransfer();
      await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');
      const rejected = await service.reject(
        COMPANY, MANAGER, transfer.id, 'reject-001', 'Wrong destination shelf', manager(),
      );
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Wrong destination shelf');
      const path = await service.approvalPath(COMPANY, transfer.id);
      expect(path.stopped).toMatchObject({ level: 1, decision: 'REJECT', reason: 'Wrong destination shelf' });
      expect((path.levels as Array<{ state: string }>)[0].state).toBe('REJECTED');
      await expect(
        service.approve(COMPANY, CHIEF, transfer.id, 'after-reject', chief()),
      ).rejects.toThrow(/already been decided/);
      expect(posted).toHaveLength(0);
    });

    it('returns the request for amendment and lets the author resubmit', async () => {
      await withChain();
      const transfer = await openTransfer();
      await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');
      const returned = await service.returnForAmendment(
        COMPANY, MANAGER, transfer.id, 'return-001', 'Send eight, not ten', manager(),
      );
      expect(returned.status).toBe('DRAFT');
      expect(returned.returnReason).toBe('Send eight, not ten');
      // The author can open the chain again; the returned decision stays in
      // the history rather than being erased.
      const resubmitted = await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-002');
      expect(resubmitted.status).toBe('PENDING_APPROVAL');
      const history = await approvals.history(COMPANY, 'StockTransfer', transfer.id);
      expect(history.items.map((item) => item.decision)).toEqual(['RETURN']);
    });

    it('ignores the policy when the transfer is below its amount threshold', async () => {
      // 10 units x 4.25 = 42.50, below the 1000 threshold.
      await withChain('1000');
      const transfer = await openTransfer();
      const path = await service.approvalPath(COMPANY, transfer.id);
      expect(path.source).toBe('LEGACY');
      const reviewed = await service.submit(COMPANY, MANAGER, transfer.id, 'submit-001');
      expect(reviewed.status).toBe('REVIEWED');
    });

    it('applies the policy when the transfer is at or above the threshold', async () => {
      // 10 x 4.25 = 42.50, at the 42.50 threshold.
      await withChain('42.5');
      const transfer = await openTransfer();
      const path = await service.approvalPath(COMPANY, transfer.id);
      expect(path.source).toBe('POLICY');
    });

    it('keeps two companies apart', async () => {
      await withChain();
      const otherCompany = '99999999-9999-4999-8999-999999999999';
      // One undeleted company per database is a schema rule, so the second is
      // created soft-deleted: the point here is policy isolation, not tenancy.
      await db.exec(`
        INSERT INTO companies(id,code,"nameEn","nameAr","deletedAt","updatedAt")
          VALUES ('${otherCompany}','OT','Other','أخرى',now(),now());
      `);
      const created = await approvals.createPolicy(
        actor(REQUESTER, ['admin.approvals.manage'], ['ADMIN'], otherCompany),
        {
          operation: 'STOCK_TRANSFER',
          nameEn: 'Single level',
          nameAr: 'مستوى واحد',
          levels: [
            { nameEn: 'Manager', nameAr: 'مدير', permission: 'inventory.transfer.approve' },
          ],
        },
      );
      expect(created.levels).toHaveLength(1);
      const mine = await approvals.listPolicies(COMPANY);
      const theirs = await approvals.listPolicies(otherCompany);
      // Each company sees exactly its own chain and nothing of the other's.
      expect(mine.items.map((item) => item.nameEn)).toEqual(['Two-level transfer approval']);
      expect(theirs.items.map((item) => item.nameEn)).toEqual(['Single level']);
    });

    it('moves stock only after the chain completes and the goods are received', async () => {
      await withChain();
      const transfer = await openTransfer();
      await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');
      await service.approve(COMPANY, MANAGER, transfer.id, 'approve-1', manager());
      const approved = await service.approve(COMPANY, CHIEF, transfer.id, 'approve-2', chief());
      expect(approved.status).toBe('APPROVED');
      expect(posted).toHaveLength(0);

      const dispatched = await service.dispatch(COMPANY, REQUESTER, transfer.id, 'dispatch-001', [
        { lineId: transfer.lines[0].id, quantity: '10' },
      ]);
      expect(dispatched.status).toBe('DISPATCHED');
      expect(dispatched.lines[0].dispatchedQuantity.toString()).toBe('10');
      // Receiving is never optional, chain or no chain.
      expect(dispatched.lines[0].receivedQuantity.toString()).toBe('0');

      const received = await service.receive(COMPANY, CHIEF, transfer.id, 'receive-001', [
        { lineId: transfer.lines[0].id, quantity: '10' },
      ]);
      expect(received.status).toBe('RECEIVED');
      expect(received.lines[0].receivedQuantity.toString()).toBe('10');
    });

    it('tells the receiving warehouse that goods are waiting, not the sender', async () => {
      await withChain();
      const transfer = await openTransfer();
      await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');
      await service.approve(COMPANY, MANAGER, transfer.id, 'approve-1', manager());
      await service.approve(COMPANY, CHIEF, transfer.id, 'approve-2', chief());
      const before = raised.length;
      await service.dispatch(COMPANY, REQUESTER, transfer.id, 'dispatch-001', [
        { lineId: transfer.lines[0].id, quantity: '10' },
      ]);
      const receipt = raised
        .slice(before)
        .filter((event) => event.type === 'STOCK_TRANSFER_RECEIPT_REQUIRED');
      expect(receipt).toHaveLength(1);
      // Addressed to the destination shelf, so it reaches the officer who can
      // actually open the gate - the source manager already did their part.
      expect(receipt[0].warehouseId).toBe(TO);
      expect(String(receipt[0].bodyAr)).toContain('بالطريق');
      // And the document is where the alert points.
      expect(String(receipt[0].actionPath)).toContain(transfer.id);
    });

    it('raises the level alert to the level permission and closes it once decided', async () => {
      await withChain();
      const transfer = await openTransfer();
      const before = raised.length;
      await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');
      const levelAlerts = raised
        .slice(before)
        .filter((event) => event.type === 'STOCK_TRANSFER_LEVEL_PENDING');
      expect(levelAlerts).toHaveLength(1);
      // Addressed to the pending level's own permission and to the source
      // shelf, so it appears for the people who can close it and nobody else.
      expect(levelAlerts[0]).toMatchObject({
        permission: 'inventory.transfer.approve',
        warehouseId: FROM,
        entityId: transfer.id,
      });
      expect(String(levelAlerts[0].actionPath)).toContain(transfer.id);

      // Deciding level 1 moves the task to level 2 rather than leaving two.
      await service.approve(COMPANY, MANAGER, transfer.id, 'approve-1', manager());
      const path = await service.approvalPath(COMPANY, transfer.id);
      expect((path.levels as Array<{ state: string }>).map((l) => l.state)).toEqual([
        'APPROVED',
        'PENDING',
      ]);
      // Completing the chain clears the task entirely: nothing is left
      // waiting for an approver on an approved request.
      await service.approve(COMPANY, CHIEF, transfer.id, 'approve-2', chief());
      const after = await service.approvalPath(COMPANY, transfer.id);
      expect(after.complete).toBe(true);
      expect((after.levels as Array<{ state: string }>).every((l) => l.state === 'APPROVED')).toBe(true);
    });

    it('sends a returned request back to its author, not to the approvers', async () => {
      await withChain();
      const transfer = await openTransfer();
      await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');
      const before = raised.length;
      await service.returnForAmendment(COMPANY, MANAGER, transfer.id, 'return-001', 'Wrong quantity', manager());
      const alerts = raised.slice(before);
      const returned = alerts.find((event) => event.type === 'STOCK_TRANSFER_RETURNED');
      expect(returned).toBeDefined();
      expect(String(returned?.bodyAr)).toContain('Wrong quantity');
      // It is a distinct kind rather than an approval task, so it does not
      // reappear in the approver's pending list. The kind's own permission
      // (inventory.transfer.create) decides who sees it.
      expect(returned?.type).not.toBe('STOCK_TRANSFER_LEVEL_PENDING');
      expect(returned?.type).toBe('STOCK_TRANSFER_RETURNED');
      expect(returned?.entityId).toBe(transfer.id);
    });

    it('does not let a second decision reuse the same idempotency key silently', async () => {
      await withChain();
      const transfer = await openTransfer();
      await service.submit(COMPANY, REQUESTER, transfer.id, 'submit-001');
      await service.approve(COMPANY, MANAGER, transfer.id, 'same-key', manager());
      // Level 2 with a different person; the same key must not be mistaken for
      // the level-1 action it already recorded.
      const after = await service.approve(COMPANY, CHIEF, transfer.id, 'same-key', chief());
      expect(after.status).toBe('APPROVED');
      const history = await approvals.history(COMPANY, 'StockTransfer', transfer.id);
      expect(history.items.filter((item) => item.decision === 'APPROVE')).toHaveLength(2);
    });
  },
);
