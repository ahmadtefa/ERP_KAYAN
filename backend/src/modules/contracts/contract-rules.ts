import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export class ContractError extends Error {
  constructor(public readonly code: string, message: string, public readonly params?: Record<string, string>) {
    super(message);
  }
}

export function asHttp(error: unknown): never {
  if (error instanceof ContractError) {
    throw new BadRequestException({ code: error.code, message: error.message, ...(error.params ? { params: error.params } : {}) });
  }
  throw error;
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const r2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export function amount(value: unknown, field: string, opts: { allowZero?: boolean; negative?: boolean } = {}): Prisma.Decimal {
  const text = String(value ?? '').trim();
  const re = opts.negative ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/;
  if (!re.test(text)) throw new ContractError('CONTRACT_AMOUNT_BAD', `${field} must be a number with up to 2 decimals`, { field });
  const d = D(text);
  if ((!opts.allowZero && d.isZero()) || d.abs().gte(D('1e13'))) throw new ContractError('CONTRACT_AMOUNT_BAD', `${field} is out of range`, { field });
  return d;
}

export function percent(value: unknown, field: string): Prisma.Decimal {
  const text = String(value ?? '0').trim() || '0';
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(text) || D(text).gt(100)) throw new ContractError('CONTRACT_PERCENT_BAD', `${field} must be from 0 to 100`, { field });
  return D(text);
}

export function isoDate(value: unknown, field: string): string {
  const v = String(value ?? '').trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new ContractError('CONTRACT_DATE_BAD', `${field} must be a real date like 2026-03-31`, { field });
  }
  return v;
}

export interface ClaimFigures {
  periodWork: Prisma.Decimal;
  advanceRecovery: Prisma.Decimal;
  retention: Prisma.Decimal;
  vat: Prisma.Decimal;
  netDueNow: Prisma.Decimal;
}

/**
 * One progress claim. Work is cumulative: the claim states how much of the contract is done in
 * total, and this period's work is the difference from what earlier claims already billed.
 * Advance is recovered in proportion to the work (advance / original contract value), never more
 * than what is still unrecovered. Retention is a share of this period's work the customer holds.
 */
export function claimFigures(input: {
  effectiveValue: Prisma.Decimal.Value;
  contractValue: Prisma.Decimal.Value;
  advanceAmount: Prisma.Decimal.Value;
  advanceRecovered: Prisma.Decimal.Value;
  retentionPercent: Prisma.Decimal.Value;
  taxRatePercent: Prisma.Decimal.Value | null;
  previousWork: Prisma.Decimal.Value;
  cumulativeWork: Prisma.Decimal.Value;
}): ClaimFigures {
  const cumulative = D(input.cumulativeWork);
  const previous = D(input.previousWork);
  if (cumulative.lte(previous)) throw new ContractError('CLAIM_NOT_ABOVE_PREVIOUS', 'Cumulative work must be above the previous claim', { previous: previous.toFixed(2) });
  if (cumulative.gt(D(input.effectiveValue))) throw new ContractError('CLAIM_ABOVE_CONTRACT', 'Cumulative work is above the contract value', { limit: D(input.effectiveValue).toFixed(2) });
  const periodWork = r2(cumulative.minus(previous));
  const remainingAdvance = D(input.advanceAmount).minus(D(input.advanceRecovered));
  let recovery = r2(periodWork.mul(D(input.advanceAmount)).div(D(input.contractValue)));
  if (recovery.gt(remainingAdvance)) recovery = remainingAdvance.lt(0) ? D(0) : remainingAdvance;
  const retention = r2(periodWork.mul(D(input.retentionPercent)).div(100));
  const vat = input.taxRatePercent == null ? D(0) : r2(periodWork.mul(D(input.taxRatePercent)).div(100));
  const netDueNow = periodWork.plus(vat).minus(recovery).minus(retention);
  return { periodWork, advanceRecovery: recovery, retention, vat, netDueNow };
}
