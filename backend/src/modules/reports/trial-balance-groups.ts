import { Prisma } from '@prisma/client';

const MONEY_SCALE = 4;

export interface TrialBalanceAccount {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  type: string;
  parentId: string | null;
  isPostable: boolean;
}

export interface TrialBalanceValues {
  opening: Prisma.Decimal;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  closing: Prisma.Decimal;
}

const zero = (): TrialBalanceValues => ({
  opening: new Prisma.Decimal(0),
  debit: new Prisma.Decimal(0),
  credit: new Prisma.Decimal(0),
  closing: new Prisma.Decimal(0),
});

const add = (into: TrialBalanceValues, from: TrialBalanceValues) => {
  into.opening = into.opening.plus(from.opening);
  into.debit = into.debit.plus(from.debit);
  into.credit = into.credit.plus(from.credit);
  into.closing = into.closing.plus(from.closing);
};

const isZero = (v: TrialBalanceValues) =>
  v.opening.isZero() && v.debit.isZero() && v.credit.isZero() && v.closing.isZero();

/**
 * Subtotals for the grouping (non-postable) accounts of a trial balance:
 * each heading carries the sum of every postable account beneath it, so a
 * reader can read "current assets" without adding up its leaves by hand.
 *
 * These rows are presentation only. They are never part of the report's
 * totals — the totals keep coming from the postable rows alone — so a
 * subtotal can never double-count its children into the grand total.
 * A postable account that also has children keeps its own row as before
 * and gets no subtotal row; its balance still rolls up into whichever
 * heading sits above it.
 */
export function buildTrialBalanceGroups(
  accounts: TrialBalanceAccount[],
  valuesById: Map<string, TrialBalanceValues>,
) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const children = new Map<string, TrialBalanceAccount[]>();
  for (const account of accounts) {
    if (account.parentId && byId.has(account.parentId)) {
      const list = children.get(account.parentId) ?? [];
      list.push(account);
      children.set(account.parentId, list);
    }
  }

  // Post-order rollup with a cycle guard: the chart is a tree by
  // construction, but a report must never hang on bad data.
  const rollup = new Map<string, TrialBalanceValues>();
  const visiting = new Set<string>();
  const sumOf = (account: TrialBalanceAccount): TrialBalanceValues => {
    const cached = rollup.get(account.id);
    if (cached) return cached;
    if (visiting.has(account.id)) return zero();
    visiting.add(account.id);
    const total = zero();
    if (account.isPostable) {
      const own = valuesById.get(account.id);
      if (own) add(total, own);
    }
    for (const child of children.get(account.id) ?? []) {
      add(total, sumOf(child));
    }
    visiting.delete(account.id);
    rollup.set(account.id, total);
    return total;
  };

  const depthOf = (account: TrialBalanceAccount): number => {
    let depth = 0;
    let current = account;
    const seen = new Set<string>([account.id]);
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.parentId)) {
      seen.add(current.parentId);
      current = byId.get(current.parentId)!;
      depth += 1;
    }
    return depth;
  };

  return accounts
    .filter((account) => !account.isPostable)
    .map((account) => ({ account, total: sumOf(account) }))
    .filter(({ total }) => !isZero(total))
    .map(({ account, total }) => ({
      accountId: account.id,
      code: account.code,
      nameEn: account.nameEn,
      nameAr: account.nameAr,
      type: account.type.toLowerCase(),
      parentId: account.parentId,
      depth: depthOf(account),
      opening: total.opening.toFixed(MONEY_SCALE),
      debit: total.debit.toFixed(MONEY_SCALE),
      credit: total.credit.toFixed(MONEY_SCALE),
      closing: total.closing.toFixed(MONEY_SCALE),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}
