import { Prisma } from '@prisma/client';

import { PostingLine } from './posting.service';

/// One part of a document amount, and the centre that part belongs to.
export interface AttributedPart {
  costCenterId: string | null;
  amount: Prisma.Decimal;
}

/// Turns "this much belongs to this centre" parts into posting lines.
///
/// A document splits into at most two lines per account: one for the parts
/// that name a centre (carried as a single-centre line or, when there are
/// several, as allocations), and one for the parts that name none. That keeps
/// the ledger balanced to the piastre and keeps every figure reconcilable:
/// nothing is guessed onto a centre that the document did not name, and no
/// amount is counted twice.
///
/// Parts of zero are dropped: a zero line carries no information and would
/// only add rows to the ledger.
export function attributedLines(
  accountId: string,
  side: 'debit' | 'credit',
  description: string,
  parts: AttributedPart[],
): PostingLine[] {
  const byCenter = new Map<string, Prisma.Decimal>();
  let unallocated = new Prisma.Decimal(0);

  for (const part of parts) {
    if (!part.amount || part.amount.isZero()) continue;
    if (!part.costCenterId) {
      unallocated = unallocated.plus(part.amount);
      continue;
    }
    byCenter.set(
      part.costCenterId,
      (byCenter.get(part.costCenterId) ?? new Prisma.Decimal(0)).plus(part.amount),
    );
  }

  const lines: PostingLine[] = [];
  const centres = [...byCenter.entries()].filter(([, amount]) => !amount.isZero());

  if (centres.length === 1) {
    lines.push({
      accountId,
      [side]: centres[0][1],
      description,
      costCenterId: centres[0][0],
    });
  } else if (centres.length > 1) {
    // A split line. The amounts are exactly the parts the document named, so
    // they add up to the line by construction; PostingService validates the
    // total again before anything is written.
    lines.push({
      accountId,
      [side]: centres.reduce(
        (sum, [, amount]) => sum.plus(amount),
        new Prisma.Decimal(0),
      ),
      description,
      allocations: centres.map(([costCenterId, amount]) => ({
        costCenterId,
        amount: amount.toFixed(4),
      })),
    });
  }

  if (!unallocated.isZero()) {
    lines.push({ accountId, [side]: unallocated, description, costCenterId: null });
  }

  return lines;
}
