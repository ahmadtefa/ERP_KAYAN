import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

const MONEY_SCALE = 4;

/**
 * Reads the stock ledger.
 *
 * The balance table is a running total kept in step with the movements inside
 * the posting transaction, so this is a plain read rather than an aggregate
 * over every movement ever recorded.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async balances(
    companyId: string,
    filters: { branchId?: string; itemId?: string; onlyInStock?: boolean },
  ) {
    const where: Prisma.StockBalanceWhereInput = { companyId };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.itemId) where.itemId = filters.itemId;

    const rows = await this.prisma.stockBalance.findMany({
      where,
      include: {
        item: {
          select: { code: true, nameEn: true, nameAr: true, unit: true },
        },
        branch: { select: { code: true, nameEn: true, nameAr: true } },
      },
      orderBy: { itemId: 'asc' },
    });

    const mapped = rows.map((r) => {
      const quantity = r.quantity;
      const value = r.value;
      // Weighted average: the value on hand divided by the quantity on hand.
      const averageCost = quantity.isZero()
        ? new Prisma.Decimal(0)
        : value.div(quantity).toDecimalPlaces(MONEY_SCALE);

      return {
        itemId: r.itemId,
        itemCode: r.item.code,
        itemNameEn: r.item.nameEn,
        itemNameAr: r.item.nameAr,
        unit: r.item.unit,
        branchId: r.branchId,
        branchCode: r.branch.code,
        quantity: quantity.toFixed(MONEY_SCALE),
        value: value.toFixed(MONEY_SCALE),
        averageCost: averageCost.toFixed(MONEY_SCALE),
      };
    });

    return filters.onlyInStock
      ? mapped.filter((m) => !new Prisma.Decimal(m.quantity).isZero())
      : mapped;
  }

  async itemLedger(companyId: string, itemId: string) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, companyId, deletedAt: null },
      select: { id: true, code: true, nameEn: true, nameAr: true, unit: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    const movements = await this.prisma.stockMovement.findMany({
      where: { companyId, itemId },
      orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }],
      include: { branch: { select: { code: true } } },
    });

    let runningQty = new Prisma.Decimal(0);
    let runningValue = new Prisma.Decimal(0);

    return {
      item,
      movements: movements.map((m) => {
        const signedQty = m.direction === 'IN' ? m.quantity : m.quantity.negated();
        const signedValue = m.direction === 'IN' ? m.totalCost : m.totalCost.negated();
        runningQty = runningQty.plus(signedQty);
        runningValue = runningValue.plus(signedValue);

        return {
          id: m.id,
          movementDate: m.movementDate.toISOString().slice(0, 10),
          direction: m.direction.toLowerCase(),
          branchCode: m.branch.code,
          quantity: m.quantity.toFixed(MONEY_SCALE),
          unitCost: m.unitCost.toFixed(MONEY_SCALE),
          totalCost: m.totalCost.toFixed(MONEY_SCALE),
          referenceType: m.referenceType,
          referenceNumber: m.referenceNumber,
          notes: m.notes,
          runningQuantity: runningQty.toFixed(MONEY_SCALE),
          runningValue: runningValue.toFixed(MONEY_SCALE),
        };
      }),
    };
  }
}
