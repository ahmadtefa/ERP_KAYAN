import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ItemWarehouseSettingsService } from './item-warehouse-settings.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const OTHER_BRANCH = '99999999-9999-4999-8999-999999999999';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';
const USER = 'user-storekeeper';

/// The minimum, the reorder point and the maximum, per item per warehouse.
///
/// The figures a shop acts on every morning are decided here, so what is under
/// test is the arithmetic that decides them and the refusals that stop a
/// nonsense pair being saved: a negative minimum, a maximum under the minimum,
/// or a reorder point above the ceiling.
describe('item warehouse settings', () => {
  type Row = Record<string, any>;

  function makeHarness(seed: {
    settings?: Row[];
    onHand?: Array<{ warehouseId: string; itemId: string; quantity: string }>;
    warehouse?: Row | null;
    item?: Row | null;
  } = {}) {
    const state = {
      settings: [...(seed.settings ?? [])],
      onHand: seed.onHand ?? [],
      warehouse: seed.warehouse === undefined ? { id: WAREHOUSE, branchId: BRANCH } : seed.warehouse,
      item: seed.item === undefined ? { id: ITEM, code: 'MILK' } : seed.item,
      audits: [] as Row[],
      listWhere: null as Row | null,
      saved: null as Row | null,
    };

    const settingRow = (row: Row) => ({
      id: row.id ?? `setting-${state.settings.indexOf(row)}`,
      warehouseId: WAREHOUSE,
      itemId: ITEM,
      item: { code: 'MILK', nameEn: 'Milk', nameAr: 'حليب', unit: 'علبة' },
      warehouse: { code: 'MAIN', nameEn: 'Main store', nameAr: 'المخزن الرئيسي' },
      minQuantity: D('0'),
      reorderQuantity: D('0'),
      maxQuantity: D('0'),
      ...row,
    });

    const prisma = {
      itemWarehouseSetting: {
        findMany: jest.fn(async (args: Row) => {
          state.listWhere = args.where;
          return state.settings.map(settingRow);
        }),
        upsert: jest.fn(async (args: Row) => {
          state.saved = args;
          return {
            id: 'setting-saved',
            warehouseId: args.create.warehouseId,
            itemId: args.create.itemId,
            minQuantity: args.create.minQuantity,
            reorderQuantity: args.create.reorderQuantity,
            maxQuantity: args.create.maxQuantity,
          };
        }),
      },
      warehouse: { findFirst: jest.fn(async () => state.warehouse) },
      item: { findFirst: jest.fn(async () => state.item) },
      $queryRaw: jest.fn(async () => state.onHand),
    };

    const audit = { record: jest.fn(async (entry: Row) => state.audits.push(entry)) };
    const service = new ItemWarehouseSettingsService(prisma as never, audit as never);
    return { service, prisma, audit, state };
  }

  it('prints a saved pair of limits at four places', async () => {
    const { service } = makeHarness({
      settings: [
        { minQuantity: D('5'), reorderQuantity: D('8'), maxQuantity: D('40') },
      ],
    });

    const answer = await service.list(COMPANY);

    expect(answer.total).toBe(1);
    expect(answer.items[0]).toMatchObject({
      minQuantity: '5.0000',
      reorderQuantity: '8.0000',
      maxQuantity: '40.0000',
      onHand: '0.0000',
    });
  });

  it('falls back to the minimum when no separate reorder point was saved', async () => {
    // A shop that only knows its minimum is still told to order something; the
    // older company-wide figure is not consulted here.
    const { service } = makeHarness({
      settings: [{ minQuantity: D('10'), reorderQuantity: D('0'), maxQuantity: D('0') }],
      onHand: [{ warehouseId: WAREHOUSE, itemId: ITEM, quantity: '4' }],
    });

    const answer = await service.list(COMPANY);

    expect(answer.items[0].onHand).toBe('4.0000');
    expect(answer.items[0].isBelowMinimum).toBe(true);
    // No ceiling, so ordering brings the shelf back to the reorder point.
    expect(answer.items[0].suggestedOrder).toBe('6.0000');
  });

  it('orders up to the maximum when the shelf is below the reorder point', async () => {
    const { service } = makeHarness({
      settings: [{ minQuantity: D('5'), reorderQuantity: D('10'), maxQuantity: D('30') }],
      onHand: [{ warehouseId: WAREHOUSE, itemId: ITEM, quantity: '2' }],
    });

    const answer = await service.list(COMPANY);

    expect(answer.items[0].suggestedOrder).toBe('28.0000');
    expect(answer.items[0].isAboveMaximum).toBe(false);
  });

  it('suggests nothing while the shelf is above the reorder point', async () => {
    const { service } = makeHarness({
      settings: [{ minQuantity: D('5'), reorderQuantity: D('10'), maxQuantity: D('30') }],
      onHand: [{ warehouseId: WAREHOUSE, itemId: ITEM, quantity: '25' }],
    });

    const answer = await service.list(COMPANY);

    expect(answer.items[0].suggestedOrder).toBe('0.0000');
    expect(answer.items[0].isBelowMinimum).toBe(false);
  });

  it('reads the on-hand quantity as the net of both directions, per warehouse', async () => {
    // The raw read is the whole point: a return and an issue cancel out, and a
    // second warehouse holding the same item is a different shelf.
    const { service, prisma } = makeHarness({
      settings: [
        { minQuantity: D('1'), reorderQuantity: D('0'), maxQuantity: D('0') },
        {
          warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          itemId: ITEM,
          minQuantity: D('1'),
          reorderQuantity: D('0'),
          maxQuantity: D('0'),
        },
      ],
      onHand: [
        { warehouseId: WAREHOUSE, itemId: ITEM, quantity: '7' },
        { warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', itemId: ITEM, quantity: '0' },
      ],
    });

    const answer = await service.list(COMPANY);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(answer.items.map((row) => row.onHand)).toEqual(['7.0000', '0.0000']);
  });

  it('narrows the list to the warehouses the caller may see', async () => {
    const { service, state } = makeHarness({
      settings: [{ minQuantity: D('1') }],
    });

    await service.list(COMPANY, {}, [BRANCH]);

    expect(state.listWhere).toMatchObject({
      companyId: COMPANY,
      warehouse: { branchId: { in: [BRANCH] } },
    });
  });

  it('filters to the shelves that are at or under their minimum', async () => {
    const { service } = makeHarness({
      settings: [
        { itemId: 'item-low', minQuantity: D('10'), reorderQuantity: D('0'), maxQuantity: D('0') },
        { itemId: 'item-full', minQuantity: D('10'), reorderQuantity: D('0'), maxQuantity: D('0') },
      ],
      onHand: [
        { warehouseId: WAREHOUSE, itemId: 'item-low', quantity: '3' },
        { warehouseId: WAREHOUSE, itemId: 'item-full', quantity: '30' },
      ],
    });

    const all = await service.list(COMPANY);
    const low = await service.list(COMPANY, { belowMinimum: 'true' });

    expect(all.total).toBe(2);
    expect(low.total).toBe(1);
    expect(low.items[0].itemId).toBe('item-low');
  });

  it('keeps a shelf with no minimum out of the below-minimum list', async () => {
    // A zero minimum means "no rule", not "everything is short".
    const { service } = makeHarness({
      settings: [{ minQuantity: D('0'), reorderQuantity: D('0'), maxQuantity: D('0') }],
      onHand: [{ warehouseId: WAREHOUSE, itemId: ITEM, quantity: '0' }],
    });

    const low = await service.list(COMPANY, { belowMinimum: '1' });

    expect(low.total).toBe(0);
  });

  it('saves the three figures and records who set them', async () => {
    const { service, state, audit } = makeHarness();

    const saved = await service.upsert(
      COMPANY,
      USER,
      WAREHOUSE,
      ITEM,
      { minQuantity: '5', reorderQuantity: '10', maxQuantity: '40' },
    );

    expect(saved).toMatchObject({
      minQuantity: '5.0000',
      reorderQuantity: '10.0000',
      maxQuantity: '40.0000',
    });
    expect(state.saved?.where).toEqual({
      warehouseId_itemId: { warehouseId: WAREHOUSE, itemId: ITEM },
    });
    expect(state.saved?.create).toMatchObject({ companyId: COMPANY, updatedBy: USER });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY,
        userId: USER,
        entity: 'item_warehouse_settings',
        after: expect.objectContaining({ item: 'MILK', min: '5.0000', reorder: '10.0000', max: '40.0000' }),
      }),
    );
  });

  it('treats a missing figure as zero rather than as an error', async () => {
    const { service, state } = makeHarness();

    await service.upsert(COMPANY, USER, WAREHOUSE, ITEM, { minQuantity: '3' });

    expect(state.saved?.create.reorderQuantity.toFixed(4)).toBe('0.0000');
    expect(state.saved?.create.maxQuantity.toFixed(4)).toBe('0.0000');
  });

  it.each([
    [{ minQuantity: '-1' }, /negative/i],
    [{ minQuantity: '10', maxQuantity: '5' }, /below the minimum/i],
    [{ reorderQuantity: '50', maxQuantity: '40' }, /above the maximum/i],
  ])('refuses %j before writing anything', async (input, message) => {
    const { service, state } = makeHarness();

    await expect(service.upsert(COMPANY, USER, WAREHOUSE, ITEM, input)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.upsert(COMPANY, USER, WAREHOUSE, ITEM, input)).rejects.toThrow(message);
    expect(state.saved).toBeNull();
  });

  it('refuses a warehouse that is not this company’s', async () => {
    const { service } = makeHarness({ warehouse: null });

    await expect(
      service.upsert(COMPANY, USER, WAREHOUSE, ITEM, { minQuantity: '1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses an item that is not this company’s', async () => {
    const { service } = makeHarness({ item: null });

    await expect(
      service.upsert(COMPANY, USER, WAREHOUSE, ITEM, { minQuantity: '1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses a warehouse the caller’s branch scope does not cover', async () => {
    const { service, state } = makeHarness();

    await expect(
      service.upsert(COMPANY, USER, WAREHOUSE, ITEM, { minQuantity: '1' }, [OTHER_BRANCH]),
    ).rejects.toThrow(NotFoundException);
    expect(state.saved).toBeNull();
  });
});
