import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { WarehouseService } from '../../common/warehouse/warehouse.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';

describe('Warehouse advanced features', () => {
  let locations: any[];
  let itemSettings: any[];
  let userAccess: any[];
  let auditLogs: any[];

  const fakePrisma: any = {
    warehouse: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        if (where.id === WAREHOUSE && where.companyId === COMPANY) {
          return { id: WAREHOUSE, companyId: COMPANY, branchId: BRANCH, code: 'WH-1', nameEn: 'Main', nameAr: 'الرئيسي', isActive: true, isDefault: true };
        }
        return null;
      }),
    },
    item: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        if (where.id === ITEM && where.companyId === COMPANY) {
          return { id: ITEM, code: 'ITEM-1', nameEn: 'Item', nameAr: 'صنف', unit: 'piece' };
        }
        return null;
      }),
    },
    user: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        if (where.id === USER && where.companyId === COMPANY) {
          return { id: USER, username: 'testuser', fullName: 'Test' };
        }
        return null;
      }),
    },
    storageLocation: {
      findMany: jest.fn().mockImplementation(async () => locations.filter((l) => !l.deletedAt)),
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        return locations.find((l) => {
          if (l.deletedAt) return false;
          if (where.id && l.id !== where.id) return false;
          if (where.warehouseId && l.warehouseId !== where.warehouseId) return false;
          if (where.code && l.code !== where.code) return false;
          return true;
        }) ?? null;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const row = { id: 'loc-' + (locations.length + 1), ...data };
        locations.push(row);
        return row;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const idx = locations.findIndex((l) => l.id === where.id);
        if (idx === -1) throw new Error('Not found');
        locations[idx] = { ...locations[idx], ...data };
        return locations[idx];
      }),
      count: jest.fn().mockImplementation(async () => 0),
    },
    stockMovement: {
      count: jest.fn().mockImplementation(async () => 0),
    },
    itemWarehouseSetting: {
      findMany: jest.fn().mockImplementation(async () => itemSettings),
      upsert: jest.fn().mockImplementation(async ({ where, create, update }) => {
        const idx = itemSettings.findIndex(
          (s) => s.warehouseId === where.warehouseId_itemId.warehouseId && s.itemId === where.warehouseId_itemId.itemId,
        );
        if (idx !== -1) {
          itemSettings[idx] = { ...itemSettings[idx], ...update };
          return itemSettings[idx];
        }
        const row = { id: 'setting-1', ...create };
        itemSettings.push(row);
        return row;
      }),
    },
    userWarehouseAccess: {
      findMany: jest.fn().mockImplementation(async () => userAccess),
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        return userAccess.find(
          (a) => a.userId === where.userId_warehouseId.userId && a.warehouseId === where.userId_warehouseId.warehouseId,
        ) ?? null;
      }),
      upsert: jest.fn().mockImplementation(async ({ where, create, update }) => {
        const idx = userAccess.findIndex(
          (a) => a.userId === where.userId_warehouseId.userId && a.warehouseId === where.userId_warehouseId.warehouseId,
        );
        if (idx !== -1) {
          userAccess[idx] = { ...userAccess[idx], ...update };
          return userAccess[idx];
        }
        const row = { id: 'acc-1', ...create };
        userAccess.push(row);
        return row;
      }),
    },
  };

  const fakeAudit: any = {
    record: jest.fn().mockImplementation(async (entry) => auditLogs.push(entry)),
  };

  let service: WarehouseService;

  beforeEach(() => {
    locations = [];
    itemSettings = [];
    userAccess = [];
    auditLogs = [];
    service = new WarehouseService(fakePrisma, fakeAudit);
  });

  describe('Storage Locations', () => {
    it('creates an aisle location and refuses duplicate code', async () => {
      const loc = await service.createLocation(COMPANY, USER, WAREHOUSE, {
        code: 'A-01',
        nameEn: 'Aisle 1',
        nameAr: 'ممر 1',
        kind: 'AISLE',
      });
      expect(loc.code).toBe('A-01');
      expect(loc.kind).toBe('AISLE');

      await expect(
        service.createLocation(COMPANY, USER, WAREHOUSE, {
          code: 'A-01',
          nameEn: 'Duplicate',
          nameAr: 'مكرر',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates a shelf under an aisle parent', async () => {
      const parent = await service.createLocation(COMPANY, USER, WAREHOUSE, {
        code: 'A-01',
        nameEn: 'Aisle 1',
        nameAr: 'ممر 1',
        kind: 'AISLE',
      });

      const child = await service.createLocation(COMPANY, USER, WAREHOUSE, {
        code: 'A-01-S1',
        nameEn: 'Shelf 1',
        nameAr: 'رف 1',
        kind: 'SHELF',
        parentId: parent.id,
      });

      expect(child.parentId).toBe(parent.id);
    });

    it('refuses self-parenting on update', async () => {
      const loc = await service.createLocation(COMPANY, USER, WAREHOUSE, {
        code: 'A-01',
        nameEn: 'Aisle 1',
        nameAr: 'ممر 1',
      });

      await expect(
        service.updateLocation(COMPANY, USER, WAREHOUSE, loc.id, {
          parentId: loc.id,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Item Warehouse Settings', () => {
    it('upserts min, reorder and max limits and validates non-negative', async () => {
      const setting = await service.upsertItemSetting(COMPANY, USER, WAREHOUSE, ITEM, {
        minQuantity: 10,
        reorderQuantity: 25,
        maxQuantity: 100,
      });

      expect(setting.minQuantity).toBe('10.0000');
      expect(setting.reorderQuantity).toBe('25.0000');
      expect(setting.maxQuantity).toBe('100.0000');

      await expect(
        service.upsertItemSetting(COMPANY, USER, WAREHOUSE, ITEM, {
          minQuantity: -5,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('User Warehouse Access', () => {
    it('saves granular warehouse permissions and enforces them', async () => {
      await service.setUserAccess(COMPANY, USER, WAREHOUSE, USER, {
        canView: true,
        canReceive: true,
        canIssue: false,
        canCount: true,
      });

      await expect(
        service.assertUserAccess(COMPANY, USER, WAREHOUSE, 'receive'),
      ).resolves.not.toThrow();

      await expect(
        service.assertUserAccess(COMPANY, USER, WAREHOUSE, 'issue'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
