import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { WarehouseService } from './warehouse.service';

const D = (v: string | number) => new Prisma.Decimal(v);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * The guard only ever touches the transaction client, so a WarehouseService
 * built with empty constructor deps is enough; every query is answered by the
 * fake tx below.
 */
function makeService(rawResults: Array<Record<string, unknown>>, sqlProbe: jest.Mock) {
  const tx = {
    $queryRaw: jest.fn(async (query: Prisma.Sql) => {
      sqlProbe(query);
      const text = query.sql;
      if (text.includes('FROM warehouses')) return [{ id: WAREHOUSE }];
      if (text.includes('FROM stock_movements')) {
        // $queryRaw always resolves to an ARRAY of rows.
        return rawResults.length ? [rawResults.shift()] : [{ quantity: D(0) }];
      }
      throw new Error(`unexpected raw query: ${text}`);
    }),
  };
  const service = new WarehouseService({} as never, {} as never);
  return { service, tx };
}

describe('WarehouseService warehouse-level availability guard', () => {
  it('does nothing when negative stock is explicitly allowed', async () => {
    const probe = jest.fn();
    const { service, tx } = makeService([], probe);
    await service.assertWarehouseAvailable({
      tx: tx as never,
      companyId: COMPANY,
      warehouseId: WAREHOUSE,
      itemId: ITEM,
      quantity: D(999),
      allowNegative: true,
      reference: 'ST-1',
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('does nothing when the posting resolves to no warehouse (branch guard remains)', async () => {
    const probe = jest.fn();
    const { service, tx } = makeService([], probe);
    await service.assertWarehouseAvailable({
      tx: tx as never,
      companyId: COMPANY,
      warehouseId: null,
      itemId: ITEM,
      quantity: D(5),
      allowNegative: false,
      reference: 'ST-1',
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('locks the warehouse row before reading availability', async () => {
    const probe = jest.fn();
    const { service, tx } = makeService([{ quantity: D(20) }], probe);
    await service.assertWarehouseAvailable({
      tx: tx as never,
      companyId: COMPANY,
      warehouseId: WAREHOUSE,
      itemId: ITEM,
      quantity: D(5),
      allowNegative: false,
      reference: 'ST-1',
    });
    const texts = probe.mock.calls.map(([q]) => (q as Prisma.Sql).sql);
    expect(texts[0]).toContain('FOR UPDATE');
    expect(texts[0]).toContain('FROM warehouses');
    expect(texts[1]).toContain('FROM stock_movements');
  });

  it('passes when the warehouse holds exactly the requested quantity', async () => {
    const probe = jest.fn();
    const { service, tx } = makeService([{ quantity: D(5) }], probe);
    await expect(
      service.assertWarehouseAvailable({
        tx: tx as never,
        companyId: COMPANY,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        quantity: D(5),
        allowNegative: false,
        reference: 'ST-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects when the warehouse holds less than requested, even with no row yet', async () => {
    const probe = jest.fn();
    const { service, tx } = makeService([{ quantity: D(4) }], probe);
    await expect(
      service.assertWarehouseAvailable({
        tx: tx as never,
        companyId: COMPANY,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        quantity: D(5),
        allowNegative: false,
        reference: 'ST-1',
      }),
    ).rejects.toMatchObject({
      name: 'BadRequestException',
      message: expect.stringContaining('selected warehouse'),
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('availability uses the same IN-minus-OUT movement formula as the stock reports', async () => {
    const probe = jest.fn();
    const { service, tx } = makeService([], probe);
    await service.availableQuantity(tx as never, COMPANY, WAREHOUSE, ITEM);
    const sql = probe.mock.calls[0][0] as Prisma.Sql;
    const text = sql.sql;
    expect(text).toContain("CASE WHEN direction = 'IN' THEN quantity ELSE -quantity END");
    expect(text).toContain('"warehouseId"');
    expect(text).toContain('"itemId"');
  });

  it('returns a zero Decimal (not null) when the warehouse has no movements', async () => {
    const probe = jest.fn();
    const { service, tx } = makeService([{ quantity: D(0) }], probe);
    const qty = await service.availableQuantity(tx as never, COMPANY, WAREHOUSE, ITEM);
    expect(qty.isZero()).toBe(true);
  });

  it('is a BadRequestException, not a generic error, so the API maps it to 400', async () => {
    const probe = jest.fn();
    const { service, tx } = makeService([{ quantity: D(0) }], probe);
    await expect(
      service.assertWarehouseAvailable({
        tx: tx as never,
        companyId: COMPANY,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        quantity: D(1),
        allowNegative: false,
        reference: 'ST-9',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
