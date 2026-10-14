import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const MONEY_SCALE = 4;

/**
 * Agreed prices.
 *
 * A price list answers one question - "what does this customer pay for this
 * item?" - and it is only ever consulted when nobody has typed a price. What
 * the invoice says is still what was charged: the list is a default, never a
 * constraint, because the person at the counter can see the deal they struck
 * and the program cannot.
 */
@Injectable()
export class PriceListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(companyId: string, query: { includeInactive?: boolean } = {}) {
    const items = await this.prisma.priceList.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { code: 'asc' },
      include: { _count: { select: { items: true, customers: true, suppliers: true } } },
    });

    return {
      items: items.map((row) => ({
        id: row.id,
        code: row.code,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        currency: row.currency,
        validFrom: row.validFrom?.toISOString().slice(0, 10) ?? null,
        validTo: row.validTo?.toISOString().slice(0, 10) ?? null,
        discountPercent: row.discountPercent.toFixed(MONEY_SCALE),
        isActive: row.isActive,
        itemCount: row._count.items,
        customerCount: row._count.customers,
        supplierCount: row._count.suppliers,
      })),
      total: items.length,
    };
  }

  async findOne(companyId: string, id: string) {
    const list = await this.prisma.priceList.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        items: {
          orderBy: [{ itemId: 'asc' }, { minQuantity: 'asc' }],
          include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
        },
        customers: { select: { id: true, code: true, nameEn: true } },
        suppliers: { select: { id: true, code: true, nameEn: true } },
      },
    });
    if (!list) throw new NotFoundException('Price list not found');

    return {
      id: list.id,
      code: list.code,
      nameEn: list.nameEn,
      nameAr: list.nameAr,
      currency: list.currency,
      validFrom: list.validFrom?.toISOString().slice(0, 10) ?? null,
      validTo: list.validTo?.toISOString().slice(0, 10) ?? null,
      discountPercent: list.discountPercent.toFixed(MONEY_SCALE),
      isActive: list.isActive,
      notes: list.notes,
      customers: list.customers,
      suppliers: list.suppliers,
      items: list.items.map((row) => ({
        id: row.id,
        itemId: row.itemId,
        itemCode: row.item.code,
        itemNameEn: row.item.nameEn,
        itemNameAr: row.item.nameAr,
        unit: row.unit || row.item.unit,
        minQuantity: row.minQuantity.toFixed(MONEY_SCALE),
        price: row.price.toFixed(MONEY_SCALE),
        discountPercent: row.discountPercent.toFixed(MONEY_SCALE),
      })),
    };
  }

  async create(companyId: string, userId: string, dto: Record<string, unknown>) {
    const code = this.text(dto.code, 'code');
    const nameEn = this.text(dto.nameEn, 'nameEn');
    const nameAr = this.text(dto.nameAr, 'nameAr');

    const existing = await this.prisma.priceList.findFirst({
      where: { companyId, code },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Price list code ${code} is already used`);
    }

    const created = await this.prisma.priceList.create({
      data: {
        companyId,
        code,
        nameEn,
        nameAr,
        currency: String(dto.currency ?? 'EGP').slice(0, 3).toUpperCase(),
        validFrom: dto.validFrom ? new Date(`${String(dto.validFrom).slice(0, 10)}T00:00:00.000Z`) : null,
        validTo: dto.validTo ? new Date(`${String(dto.validTo).slice(0, 10)}T00:00:00.000Z`) : null,
        discountPercent: this.percent(dto.discountPercent, 'discountPercent'),
        notes: (dto.notes as string) ?? null,
        createdBy: userId,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'price_lists',
      entityId: created.id,
      after: { code, nameEn, nameAr },
    });

    return this.findOne(companyId, created.id);
  }

  async update(companyId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const before = await this.prisma.priceList.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Price list not found');

    const data: Prisma.PriceListUpdateInput = {};
    if (dto.nameEn !== undefined) data.nameEn = this.text(dto.nameEn, 'nameEn');
    if (dto.nameAr !== undefined) data.nameAr = this.text(dto.nameAr, 'nameAr');
    if (dto.validFrom !== undefined) {
      data.validFrom = dto.validFrom
        ? new Date(`${String(dto.validFrom).slice(0, 10)}T00:00:00.000Z`)
        : null;
    }
    if (dto.validTo !== undefined) {
      data.validTo = dto.validTo ? new Date(`${String(dto.validTo).slice(0, 10)}T00:00:00.000Z`) : null;
    }
    if (dto.discountPercent !== undefined) {
      data.discountPercent = this.percent(dto.discountPercent, 'discountPercent');
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive === true;
    if (dto.notes !== undefined) data.notes = (dto.notes as string) ?? null;

    const updated = await this.prisma.priceList.update({ where: { id }, data });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'price_lists',
      entityId: id,
      before: { nameEn: before.nameEn, discountPercent: before.discountPercent.toFixed(MONEY_SCALE) },
      after: { nameEn: updated.nameEn, discountPercent: updated.discountPercent.toFixed(MONEY_SCALE) },
    });

    return this.findOne(companyId, id);
  }

  async deactivate(companyId: string, userId: string, id: string) {
    const before = await this.prisma.priceList.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Price list not found');

    await this.prisma.priceList.update({ where: { id }, data: { isActive: false } });
    await this.audit.record({
      companyId,
      userId,
      action: 'DEACTIVATE',
      entity: 'price_lists',
      entityId: id,
      before: { isActive: true },
      after: { isActive: false },
    });

    return this.findOne(companyId, id);
  }

  /** Adds a price, or replaces it when the same row already exists. */
  async setItem(companyId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const list = await this.prisma.priceList.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!list) throw new NotFoundException('Price list not found');

    const itemId = this.text(dto.itemId, 'itemId');
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, companyId, deletedAt: null },
      select: { id: true, code: true, unit: true },
    });
    if (!item) throw new BadRequestException('The item does not exist in this company');

    const unit = String(dto.unit ?? '').trim() || item.unit;
    const minQuantity = this.nonNegative(dto.minQuantity ?? '0', 'minQuantity');
    const price = this.nonNegative(dto.price, 'price');
    const discountPercent = this.percent(dto.discountPercent, 'discountPercent');

    const row = await this.prisma.priceListItem.upsert({
      where: {
        priceListId_itemId_unit_minQuantity: { priceListId: id, itemId, unit, minQuantity },
      },
      create: { priceListId: id, itemId, unit, minQuantity, price, discountPercent },
      update: { price, discountPercent },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'PRICE_LIST_ITEM',
      entity: 'price_lists',
      entityId: id,
      after: { itemCode: item.code, unit, price: price.toFixed(MONEY_SCALE) },
    });

    return this.findOne(companyId, id).then(() => ({
      id: row.id,
      itemId: row.itemId,
      unit: row.unit,
      minQuantity: row.minQuantity.toFixed(MONEY_SCALE),
      price: row.price.toFixed(MONEY_SCALE),
      discountPercent: row.discountPercent.toFixed(MONEY_SCALE),
    }));
  }

  async removeItem(companyId: string, userId: string, id: string, itemId: string, unit?: string) {
    const list = await this.prisma.priceList.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!list) throw new NotFoundException('Price list not found');

    const deleted = await this.prisma.priceListItem.deleteMany({
      where: { priceListId: id, itemId, ...(unit ? { unit } : {}) },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'PRICE_LIST_ITEM_REMOVE',
      entity: 'price_lists',
      entityId: id,
      before: { itemId, unit: unit ?? null, rows: deleted.count },
    });

    return { removed: deleted.count };
  }

  /** Points a customer or a supplier at a list, or takes them off it. */
  async assign(companyId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const list = await this.prisma.priceList.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, code: true },
    });
    if (!list) throw new NotFoundException('Price list not found');

    const kind = String(dto.kind ?? '').toUpperCase();
    const partyId = this.text(dto.partyId, 'partyId');
    if (kind !== 'CUSTOMER' && kind !== 'SUPPLIER') {
      throw new BadRequestException('kind must be CUSTOMER or SUPPLIER');
    }

    if (kind === 'CUSTOMER') {
      const customer = await this.prisma.customer.findFirst({
        where: { id: partyId, companyId, deletedAt: null },
        select: { id: true, code: true },
      });
      if (!customer) throw new BadRequestException('The customer does not exist in this company');
      // A list that expired yesterday must not be handed out today.
      await this.assertUsable(companyId, list.id);
      await this.prisma.customer.update({ where: { id: partyId }, data: { priceListId: list.id } });
    } else {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: partyId, companyId, deletedAt: null },
        select: { id: true, code: true },
      });
      if (!supplier) throw new BadRequestException('The supplier does not exist in this company');
      await this.assertUsable(companyId, list.id);
      await this.prisma.supplier.update({ where: { id: partyId }, data: { priceListId: list.id } });
    }

    await this.audit.record({
      companyId,
      userId,
      action: 'PRICE_LIST_ASSIGN',
      entity: 'price_lists',
      entityId: list.id,
      after: { kind, partyId },
    });

    return { assigned: true, priceListCode: list.code, kind, partyId };
  }

  /**
   * The price to suggest for a line, or null when there is nothing to suggest.
   *
   * The rule, in order: the party's list, then the narrowest unit match, then
   * the largest minimum quantity that still applies, then the discount - the
   * row's own if it has one, the list's standing one otherwise.
   */
  async resolvePrice(
    tx: Prisma.TransactionClient,
    companyId: string,
    input: {
      partyId?: string | null;
      partyKind: 'CUSTOMER' | 'SUPPLIER';
      itemId?: string | null;
      unit?: string | null;
      quantity: Prisma.Decimal;
    },
  ): Promise<{ price: Prisma.Decimal; discountPercent: Prisma.Decimal } | null> {
    if (!input.partyId || !input.itemId) return null;

    const party =
      input.partyKind === 'CUSTOMER'
        ? await tx.customer.findFirst({
            where: { id: input.partyId, companyId, deletedAt: null },
            select: { priceListId: true },
          })
        : await tx.supplier.findFirst({
            where: { id: input.partyId, companyId, deletedAt: null },
            select: { priceListId: true },
          });
    const priceListId = party?.priceListId ?? null;
    if (!priceListId) return null;

    const list = await tx.priceList.findFirst({
      where: { id: priceListId, companyId, deletedAt: null, isActive: true },
      select: { id: true, discountPercent: true, validFrom: true, validTo: true },
    });
    if (!list) return null;

    const today = new Date();
    if (list.validFrom && today < list.validFrom) return null;
    if (list.validTo && today > list.validTo) return null;

    const rows = await tx.priceListItem.findMany({
      where: {
        priceListId: list.id,
        itemId: input.itemId,
        minQuantity: { lte: input.quantity },
        ...(input.unit ? { OR: [{ unit: input.unit }, { unit: '' }] } : {}),
      },
      orderBy: [{ unit: 'asc' }, { minQuantity: 'desc' }],
    });
    if (rows.length === 0) return null;

    // An exact unit beats "every unit"; within the same unit the higher
    // minimum quantity is the more specific deal.
    const exact = input.unit ? rows.find((row) => row.unit === input.unit) : undefined;
    const chosen = exact ?? rows[0];

    // The row's own discount wins when it carries one; otherwise the list's
    // standing discount applies, so a "5% off everything for this trade"
    // agreement does not have to be repeated on every item.
    const rowDiscount = new Prisma.Decimal(chosen.discountPercent ?? 0);
    const listDiscount = new Prisma.Decimal(list.discountPercent ?? 0);
    const discountPercent = rowDiscount.greaterThan(0) ? rowDiscount : listDiscount;

    return { price: chosen.price, discountPercent };
  }

  private async assertUsable(companyId: string, id: string) {
    const list = await this.prisma.priceList.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { isActive: true, validTo: true, code: true },
    });
    if (!list) throw new NotFoundException('Price list not found');
    if (!list.isActive) throw new BadRequestException(`Price list ${list.code} is inactive`);
    if (list.validTo && new Date() > list.validTo) {
      throw new BadRequestException(`Price list ${list.code} expired`);
    }
  }

  private text(value: unknown, field: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException(`${field} is required`);
    return text;
  }

  private nonNegative(value: unknown, field: string): Prisma.Decimal {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(String(value ?? '').trim() || '0');
    } catch {
      throw new BadRequestException(`${field} is not a valid number`);
    }
    if (decimal.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
    return decimal.toDecimalPlaces(MONEY_SCALE);
  }

  private percent(value: unknown, field: string): Prisma.Decimal {
    const decimal = this.nonNegative(value ?? '0', field);
    if (decimal.greaterThan(100)) throw new BadRequestException(`${field} cannot exceed 100`);
    return decimal;
  }
}
