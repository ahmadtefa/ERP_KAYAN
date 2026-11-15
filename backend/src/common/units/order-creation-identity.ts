import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

// A missing key preserves compatibility with existing clients. New clients must
// always send one and retain the exact body until the outcome is known.
export function orderCreationIdentity(dto: Record<string, unknown>): { key: string; hash: string } | null {
  if (dto.idempotencyKey === undefined) return null;
  const key = typeof dto.idempotencyKey === 'string' ? dto.idempotencyKey.trim() : '';
  if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(key)) {
    throw new BadRequestException('idempotencyKey must contain 16–128 safe characters');
  }
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([name, item]) => [name, canonical(item)]));
    }
    return value;
  };
  const { idempotencyKey: ignored, ...payload } = dto;
  void ignored;
  return { key, hash: createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex') };
}

/** Forces rollback of a losing transaction before its committed replay is read. */
export class OrderCreationDuplicateError extends Error {}
