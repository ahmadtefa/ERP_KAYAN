import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Called under the order lock, which is shared by conversion and reversal.
 * Legacy/malformed allocations must be reconciled manually, not guessed. */
export function assertActiveOrderAllocations(
  lines: readonly { id:string; invoicedQuantity:Prisma.Decimal }[],
  invoices: readonly { lines: readonly { orderLineId:string | null; quantity:Prisma.Decimal }[] }[],
): void {
  const totals = new Map(lines.map(line => [line.id, new Prisma.Decimal(0)]));
  for (const invoice of invoices) {
    if (!invoice.lines.length) throw new BadRequestException('Invoice allocation missing; manual review required');
    for (const line of invoice.lines) {
      if (!line.orderLineId || !totals.has(line.orderLineId) || !line.quantity.isFinite() || !line.quantity.isPositive()) {
        throw new BadRequestException('Invoice allocation is invalid; manual review required');
      }
      totals.set(line.orderLineId, totals.get(line.orderLineId)!.plus(line.quantity));
    }
  }
  for (const line of lines) {
    if (!line.invoicedQuantity.equals(totals.get(line.id)!)) {
      throw new BadRequestException('Order allocations are inconsistent; manual review required');
    }
  }
}
