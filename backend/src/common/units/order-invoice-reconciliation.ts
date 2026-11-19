import { BadRequestException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

type Kind = 'sales' | 'purchase';
type Allocation = { orderLineId: string | null; quantity: Prisma.Decimal };

/** Called inside the invoice reversal transaction, before claiming the invoice. */
export async function releaseOrderAllocations(
  tx: Prisma.TransactionClient,
  kind: Kind,
  companyId: string,
  orderId: string,
  allocations: readonly Allocation[],
): Promise<void> {
  const locked = kind === 'sales'
    ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM sales_orders WHERE id = ${orderId}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL FOR UPDATE`)
    : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM purchase_orders WHERE id = ${orderId}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL FOR UPDATE`);
  if (locked.length !== 1) throw new BadRequestException('Related order is missing; manual review required');
  if (allocations.length === 0) throw new BadRequestException('Order invoice has no allocations; manual review required');
  const totals = new Map<string, Prisma.Decimal>();
  for (const line of allocations) {
    if (!line.orderLineId || !line.quantity.isFinite() || line.quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Historical order invoice lacks trustworthy allocations; manual review required');
    }
    totals.set(line.orderLineId, (totals.get(line.orderLineId) ?? new Prisma.Decimal(0)).plus(line.quantity));
  }
  const order = kind === 'sales'
    ? await tx.salesOrder.findFirst({ where: { id: orderId, companyId, deletedAt: null } })
    : await tx.purchaseOrder.findFirst({ where: { id: orderId, companyId, deletedAt: null } });
  if (!order || order.status === OrderStatus.CANCELLED || order.status === OrderStatus.DRAFT) {
    throw new BadRequestException('Related order cannot be reconciled');
  }
  for (const [id, quantity] of totals) {
    const line = kind === 'sales'
      ? await tx.salesOrderLine.findFirst({ where: { id, orderId } })
      : await tx.purchaseOrderLine.findFirst({ where: { id, orderId } });
    if (!line || line.invoicedQuantity.lessThan(quantity)) {
      throw new BadRequestException('Order allocation is inconsistent; manual review required');
    }
    if (kind === 'sales') await tx.salesOrderLine.update({ where: { id }, data: { invoicedQuantity: { decrement: quantity } } });
    else await tx.purchaseOrderLine.update({ where: { id }, data: { invoicedQuantity: { decrement: quantity } } });
  }
  const lines = kind === 'sales'
    ? await tx.salesOrderLine.findMany({ where: { orderId } })
    : await tx.purchaseOrderLine.findMany({ where: { orderId } });
  const status = lines.every((line) => line.invoicedQuantity.isZero()) ? OrderStatus.APPROVED
    : lines.every((line) => line.invoicedQuantity.greaterThanOrEqualTo(line.quantity)) ? OrderStatus.FULFILLED
    : OrderStatus.PARTIALLY_FULFILLED;
  if (kind === 'sales') await tx.salesOrder.update({ where: { id: orderId }, data: { status } });
  else await tx.purchaseOrder.update({ where: { id: orderId }, data: { status } });
}
