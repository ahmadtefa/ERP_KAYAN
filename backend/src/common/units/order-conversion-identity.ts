import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

/** The caller validates selected lines and quantities before computing a hash. */
export function orderConversionIdentity(
  dto: Record<string, unknown>,
  selected: ReadonlyMap<string, Prisma.Decimal>,
): { key: string; hash: string } {
  const key = typeof dto.idempotencyKey === 'string' ? dto.idempotencyKey.trim() : '';
  if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(key)) {
    throw new BadRequestException('idempotencyKey is required (16–128 safe characters)');
  }
  if (dto.invoiceDate !== undefined && typeof dto.invoiceDate !== 'string') {
    throw new BadRequestException('invoiceDate must be a date string');
  }
  const lines = [...selected.entries()]
    .map(([id, quantity]) => ({ id, quantity: quantity.toFixed(4) }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const hash = createHash('sha256').update(JSON.stringify({ invoiceDate: dto.invoiceDate ?? null, lines })).digest('hex');
  return { key, hash };
}
