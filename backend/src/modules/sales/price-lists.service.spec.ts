import { Prisma } from '@prisma/client';

import { PriceListsService } from './price-lists.service';

/// What a line costs when nobody typed a price.
///
/// The rules are small but they decide real money, so they are checked here
/// with a Prisma double that answers only the questions resolvePrice asks.
function fakeTx(state: {
  customer?: { priceListId: string | null } | null;
  supplier?: { priceListId: string | null } | null;
  list?: Record<string, unknown> | null;
  rows?: Array<Record<string, unknown>>;
}) {
  return {
    customer: { findFirst: async () => state.customer ?? null },
    supplier: { findFirst: async () => state.supplier ?? null },
    priceList: { findFirst: async () => state.list ?? null },
    priceListItem: {
      findMany: async (args: { where: { minQuantity: { lte: Prisma.Decimal } } }) => {
        const max = args.where.minQuantity.lte;
        return (state.rows ?? [])
          .filter((row) => new Prisma.Decimal(row.minQuantity as never).lessThanOrEqualTo(max))
          .sort((a, b) => {
            const unitOrder = String(a.unit).localeCompare(String(b.unit));
            if (unitOrder !== 0) return unitOrder;
            return new Prisma.Decimal(b.minQuantity as never).comparedTo(
              new Prisma.Decimal(a.minQuantity as never),
            );
          });
      },
    },
  };
}

const build = () => Object.create(PriceListsService.prototype) as PriceListsService;

const service = build();

describe('PriceListsService.resolvePrice', () => {
  const list = { id: 'list-1', discountPercent: new Prisma.Decimal(0), validFrom: null, validTo: null };

  it('answers nothing for a party that has no list', async () => {
    const tx = fakeTx({ customer: { priceListId: null } });
    const resolved = await service.resolvePrice(tx as never, 'company-1', {
      partyId: 'customer-1',
      partyKind: 'CUSTOMER',
      itemId: 'item-1',
      unit: 'piece',
      quantity: new Prisma.Decimal(1),
    });
    expect(resolved).toBeNull();
  });

  it('answers nothing when the line names no item', async () => {
    const tx = fakeTx({ customer: { priceListId: 'list-1' }, list });
    const resolved = await service.resolvePrice(tx as never, 'company-1', {
      partyId: 'customer-1',
      partyKind: 'CUSTOMER',
      itemId: null,
      unit: 'piece',
      quantity: new Prisma.Decimal(1),
    });
    expect(resolved).toBeNull();
  });

  it('uses the listed price', async () => {
    const tx = fakeTx({
      customer: { priceListId: 'list-1' },
      list,
      rows: [{ unit: 'piece', minQuantity: new Prisma.Decimal(0), price: new Prisma.Decimal(120), discountPercent: new Prisma.Decimal(0) }],
    });
    const resolved = await service.resolvePrice(tx as never, 'company-1', {
      partyId: 'customer-1',
      partyKind: 'CUSTOMER',
      itemId: 'item-1',
      unit: 'piece',
      quantity: new Prisma.Decimal(1),
    });
    expect(resolved?.price.toFixed(4)).toBe('120.0000');
  });

  it('applies the quantity break once the quantity reaches it', async () => {
    const rows = [
      { unit: 'piece', minQuantity: new Prisma.Decimal(0), price: new Prisma.Decimal(120), discountPercent: new Prisma.Decimal(0) },
      { unit: 'piece', minQuantity: new Prisma.Decimal(10), price: new Prisma.Decimal(110), discountPercent: new Prisma.Decimal(0) },
    ];
    const tx = fakeTx({ customer: { priceListId: 'list-1' }, list, rows });
    const resolved = await service.resolvePrice(tx as never, 'company-1', {
      partyId: 'customer-1',
      partyKind: 'CUSTOMER',
      itemId: 'item-1',
      unit: 'piece',
      quantity: new Prisma.Decimal(10),
    });
    expect(resolved?.price.toFixed(4)).toBe('110.0000');
  });

  it('does not reach a break the quantity has not reached', async () => {
    const rows = [
      { unit: 'piece', minQuantity: new Prisma.Decimal(0), price: new Prisma.Decimal(120), discountPercent: new Prisma.Decimal(0) },
      { unit: 'piece', minQuantity: new Prisma.Decimal(10), price: new Prisma.Decimal(110), discountPercent: new Prisma.Decimal(0) },
    ];
    const tx = fakeTx({ customer: { priceListId: 'list-1' }, list, rows });
    const resolved = await service.resolvePrice(tx as never, 'company-1', {
      partyId: 'customer-1',
      partyKind: 'CUSTOMER',
      itemId: 'item-1',
      unit: 'piece',
      quantity: new Prisma.Decimal(9),
    });
    expect(resolved?.price.toFixed(4)).toBe('120.0000');
  });

  it('prefers the exact unit over a list that covers every unit', async () => {
    const rows = [
      { unit: '', minQuantity: new Prisma.Decimal(0), price: new Prisma.Decimal(100), discountPercent: new Prisma.Decimal(0) },
      { unit: 'carton', minQuantity: new Prisma.Decimal(0), price: new Prisma.Decimal(90), discountPercent: new Prisma.Decimal(0) },
    ];
    const tx = fakeTx({ customer: { priceListId: 'list-1' }, list, rows });
    const resolved = await service.resolvePrice(tx as never, 'company-1', {
      partyId: 'customer-1',
      partyKind: 'CUSTOMER',
      itemId: 'item-1',
      unit: 'carton',
      quantity: new Prisma.Decimal(1),
    });
    expect(resolved?.price.toFixed(4)).toBe('90.0000');
  });

  it('ignores a list that has not started yet, or has ended', async () => {
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    const rows = [{ unit: 'piece', minQuantity: new Prisma.Decimal(0), price: new Prisma.Decimal(120), discountPercent: new Prisma.Decimal(0) }];

    const notStarted = fakeTx({
      customer: { priceListId: 'list-1' },
      list: { ...list, validFrom: future },
      rows,
    });
    expect(
      await service.resolvePrice(notStarted as never, 'company-1', {
        partyId: 'customer-1',
        partyKind: 'CUSTOMER',
        itemId: 'item-1',
        unit: 'piece',
        quantity: new Prisma.Decimal(1),
      }),
    ).toBeNull();

    const ended = fakeTx({
      customer: { priceListId: 'list-1' },
      list: { ...list, validTo: past },
      rows,
    });
    expect(
      await service.resolvePrice(ended as never, 'company-1', {
        partyId: 'customer-1',
        partyKind: 'CUSTOMER',
        itemId: 'item-1',
        unit: 'piece',
        quantity: new Prisma.Decimal(1),
      }),
    ).toBeNull();
  });

  it('reads the supplier list for a purchase', async () => {
    const tx = fakeTx({
      supplier: { priceListId: 'list-1' },
      list,
      rows: [{ unit: 'piece', minQuantity: new Prisma.Decimal(0), price: new Prisma.Decimal(95), discountPercent: new Prisma.Decimal(0) }],
    });
    const resolved = await service.resolvePrice(tx as never, 'company-1', {
      partyId: 'supplier-1',
      partyKind: 'SUPPLIER',
      itemId: 'item-1',
      unit: 'piece',
      quantity: new Prisma.Decimal(1),
    });
    expect(resolved?.price.toFixed(4)).toBe('95.0000');
  });

  it('passes the list discount on to the caller, which applies it', async () => {
    const tx = fakeTx({
      customer: { priceListId: 'list-1' },
      list: { ...list, discountPercent: new Prisma.Decimal(5) },
      rows: [{ unit: 'piece', minQuantity: new Prisma.Decimal(0), price: new Prisma.Decimal(100), discountPercent: new Prisma.Decimal(0) }],
    });
    const resolved = await service.resolvePrice(tx as never, 'company-1', {
      partyId: 'customer-1',
      partyKind: 'CUSTOMER',
      itemId: 'item-1',
      unit: 'piece',
      quantity: new Prisma.Decimal(1),
    });
    expect(resolved?.discountPercent.toFixed(4)).toBe('5.0000');
  });
});
