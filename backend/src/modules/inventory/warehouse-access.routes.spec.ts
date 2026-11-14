import { ForbiddenException } from '@nestjs/common';

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { WarehouseGrant } from '../../common/warehouse/warehouse-access';
import { BatchesController } from './batches.controller';
import { StockDocumentsController } from './stock-documents.controller';
import { StockTakesController } from './stock-takes.controller';

/// The per-user warehouse grants have to be enforced where the work happens,
/// not only on the two screens that read them.
///
/// An administrator can tick "may count this shelf" and leave "may receive
/// into this shelf" clear. The service below is a stand-in that records what it
/// was asked to do: every check in this file is about whether the call reached
/// it at all, because a hidden button is not access control - a direct request
/// to the API must be refused the same way.
const COMPANY = '11111111-1111-4111-8111-111111111111';
const STORE_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STORE_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ITEM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BRANCH = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/// A person trusted with store A only, and what that trust allows there.
const GRANTS: WarehouseGrant[] = [
  {
    warehouseId: STORE_A,
    canView: true,
    canReceive: true,
    canIssue: true,
    canTransfer: false,
    canCount: true,
    canApprove: false,
    canSeeCost: false,
  },
];

const user = (grants: WarehouseGrant[] | null | undefined = GRANTS): AuthUser =>
  ({
    userId: '99999999-9999-4999-8999-999999999999',
    username: 'storekeeper',
    companyId: COMPANY,
    branchId: BRANCH,
    isSuperAdmin: false,
    permissions: [],
    warehouseAccess: grants,
  }) as unknown as AuthUser;

function batchesService() {
  const calls: string[] = [];
  const service = {
    receive: jest.fn(async () => (calls.push('receive'), { ok: true })),
    issue: jest.fn(async () => (calls.push('issue'), { ok: true })),
    writeOff: jest.fn(async () => (calls.push('writeOff'), { ok: true })),
    transfer: jest.fn(async () => (calls.push('transfer'), { ok: true })),
  };
  return { service, calls };
}

describe('warehouse grants are enforced on the warehouse routes', () => {
  describe('receiving, issuing and writing off a lot', () => {
    it('receives into the store the person is trusted with', async () => {
      const { service, calls } = batchesService();
      const controller = new BatchesController(service as never, { scanStock: jest.fn() } as never);
      await controller.receive(user(), { warehouseId: STORE_A, itemId: ITEM } as never);
      expect(calls).toEqual(['receive']);
    });

    it('refuses a receipt into a store they are not trusted with', () => {
      const { service, calls } = batchesService();
      const controller = new BatchesController(service as never, { scanStock: jest.fn() } as never);
      expect(() =>
        controller.receive(user(), { warehouseId: STORE_B, itemId: ITEM } as never),
      ).toThrow(ForbiddenException);
      expect(calls).toEqual([]);
    });

    it('refuses an issue out of a store they are not trusted with', () => {
      const { service, calls } = batchesService();
      const controller = new BatchesController(service as never, { scanStock: jest.fn() } as never);
      expect(() =>
        controller.issue(user(), { warehouseId: STORE_B, itemId: ITEM } as never),
      ).toThrow(ForbiddenException);
      expect(calls).toEqual([]);
    });

    it('refuses writing a lot off a store they are not trusted with', () => {
      const { service, calls } = batchesService();
      const controller = new BatchesController(service as never, { scanStock: jest.fn() } as never);
      expect(() =>
        controller.writeOff(user(), { warehouseId: STORE_B, itemId: ITEM } as never),
      ).toThrow(ForbiddenException);
      expect(calls).toEqual([]);
    });

    it('lets a person with no grants at all work everywhere, as before', async () => {
      const { service, calls } = batchesService();
      const controller = new BatchesController(service as never, { scanStock: jest.fn() } as never);
      await controller.receive(user(null), { warehouseId: STORE_B, itemId: ITEM } as never);
      expect(calls).toEqual(['receive']);
    });
  });

  describe('a transfer needs both shelves', () => {
    it('refuses a transfer out of a shelf they may not transfer from', () => {
      const { service, calls } = batchesService();
      const controller = new BatchesController(service as never, { scanStock: jest.fn() } as never);
      expect(() =>
        controller.transfer(user(), {
          fromWarehouseId: STORE_A,
          toWarehouseId: STORE_B,
          itemId: ITEM,
        } as never),
      ).toThrow(ForbiddenException);
      expect(calls).toEqual([]);
    });

    it('refuses a transfer that would arrive at a shelf they cannot see', () => {
      const { service, calls } = batchesService();
      const controller = new BatchesController(service as never, { scanStock: jest.fn() } as never);
      const canMove = user([
        { ...GRANTS[0], canTransfer: true },
        { ...GRANTS[0], warehouseId: STORE_B, canView: false, canReceive: true },
      ]);
      expect(() =>
        controller.transfer(canMove, {
          fromWarehouseId: STORE_A,
          toWarehouseId: STORE_B,
          itemId: ITEM,
        } as never),
      ).toThrow(ForbiddenException);
      expect(calls).toEqual([]);
    });

    it('allows the transfer when both shelves are granted', async () => {
      const { service, calls } = batchesService();
      const controller = new BatchesController(service as never, { scanStock: jest.fn() } as never);
      const both = user([
        { ...GRANTS[0], canTransfer: true },
        { ...GRANTS[0], warehouseId: STORE_B },
      ]);
      await controller.transfer(both, {
        fromWarehouseId: STORE_A,
        toWarehouseId: STORE_B,
        itemId: ITEM,
      } as never);
      expect(calls).toEqual(['transfer']);
    });
  });

  describe('the stock-document route', () => {
    function documentsService() {
      const calls: string[] = [];
      const service = {
        create: jest.fn(async () => (calls.push('create'), { ok: true })),
      };
      return { service, calls };
    }

    it('refuses a TRANSFER document out of an ungranted store', async () => {
      const { service, calls } = documentsService();
      const controller = new StockDocumentsController(service as never);
      expect(() =>
        controller.create(
          user(),
          {
            kind: 'TRANSFER',
            fromWarehouseId: STORE_A,
            toWarehouseId: STORE_B,
            lines: [],
          },
          undefined,
        ),
      ).toThrow(ForbiddenException);
      expect(calls).toEqual([]);
    });

    it('still refuses a write-off into an ungranted store', async () => {
      const { service, calls } = documentsService();
      const controller = new StockDocumentsController(service as never);
      expect(() =>
        controller.create(
          user(),
          { kind: 'WRITE_OFF', toWarehouseId: STORE_B, reason: 'spillage', lines: [] },
          undefined,
        ),
      ).toThrow(ForbiddenException);
      expect(calls).toEqual([]);
    });
  });

  describe('a stock take belongs to one shelf', () => {
    function takesService(warehouseId = STORE_A) {
      const calls: string[] = [];
      const service = {
        findOne: jest.fn(async () => ({ id: 'take-1', warehouseId })),
        start: jest.fn(async () => (calls.push('start'), { ok: true })),
        record: jest.fn(async () => (calls.push('record'), { ok: true })),
        approve: jest.fn(async () => (calls.push('approve'), { ok: true })),
        post: jest.fn(async () => (calls.push('post'), { ok: true })),
      };
      return { service, calls };
    }

    it('refuses to open a count on a shelf they are not trusted with', async () => {
      const { service, calls } = takesService();
      const controller = new StockTakesController(service as never);
      expect(() =>
        controller.start(user(), { warehouseId: STORE_B, scope: 'FULL' } as never),
      ).toThrow(ForbiddenException);
      expect(calls).toEqual([]);
    });

    it('refuses to record a count of a shelf they are not trusted with', async () => {
      const { service, calls } = takesService(STORE_B);
      const controller = new StockTakesController(service as never);
      await expect(
        controller.record(user(), 'take-1', { lines: [], finish: true } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(calls).toEqual([]);
    });

    it('refuses to approve a count on a shelf they may not approve in', async () => {
      const { service, calls } = takesService(STORE_A);
      const controller = new StockTakesController(service as never);
      await expect(controller.approve(user(), 'take-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(calls).toEqual([]);
    });

    it('lets the counter record and post their own shelf', async () => {
      const { service, calls } = takesService(STORE_A);
      const controller = new StockTakesController(service as never);
      await controller.record(user(), 'take-1', { lines: [], finish: true } as never);
      await controller.post(user(), 'take-1');
      expect(calls).toEqual(['record', 'post']);
    });
  });
});
