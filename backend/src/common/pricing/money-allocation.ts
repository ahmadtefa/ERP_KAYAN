/// Splitting a single money amount across weighted buckets, exactly.
///
/// Both discounts and landed costs have the same problem: a document-wide
/// amount has to be spread over lines in proportion to their value, and the
/// parts must add back up to the whole at four decimal places. Doing that with
/// division on decimals leaves a residue on the last line; doing it with
/// integer ten-thousandths and the largest-remainder method leaves nothing
/// behind and never invents a negative part.

const SCALE = 4;
const UNITS = 10_000n;

export class MoneyAllocationError extends Error {}

/**
 * Allocate `total` across `values` by weight.
 *
 * Values are decimal strings already rounded to four places. The result always
 * has the same length as the input and adds up to `total` exactly, including
 * the awkward case where a single ten-thousandth has to go somewhere.
 */
export function allocateMoneyByWeight(
  values: readonly string[],
  total: string,
): string[] {
  const totalUnits = toUnits(total, 'total');
  const valueUnits = values.map((value) => toUnits(value, 'line value'));
  if (valueUnits.some((value) => value < 0n)) {
    throw new MoneyAllocationError('Line values used for allocation cannot be negative');
  }
  if (totalUnits < 0n) {
    throw new MoneyAllocationError('An allocated amount cannot be negative');
  }
  if (valueUnits.length === 0) {
    if (totalUnits === 0n) return [];
    throw new MoneyAllocationError('An amount cannot be allocated without lines');
  }
  if (totalUnits === 0n) return valueUnits.map(() => '0.0000');

  const weight = valueUnits.reduce((sum, value) => sum + value, 0n);
  if (weight === 0n) {
    throw new MoneyAllocationError(
      'A positive amount needs a positive line value to allocate against',
    );
  }

  const portions = valueUnits.map((value, index) => {
    const numerator = totalUnits * value;
    return {
      index,
      units: numerator / weight,
      remainder: numerator % weight,
    };
  });

  let remaining = totalUnits - portions.reduce((sum, portion) => sum + portion.units, 0n);
  const byRemainder = [...portions].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  // Zero-value buckets are skipped: a line worth nothing gets no part of a
  // document discount, and the rounding unit moves to a line that has value.
  for (const portion of byRemainder) {
    if (remaining === 0n) break;
    if (valueUnits[portion.index] === 0n) continue;
    portion.units += 1n;
    remaining -= 1n;
  }
  if (remaining !== 0n) {
    throw new MoneyAllocationError('Could not distribute every rounding unit');
  }

  return portions
    .sort((left, right) => left.index - right.index)
    .map((portion) => fromUnits(portion.units));
}

function toUnits(input: string, what: string): bigint {
  const value = String(input).trim();
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (!match) {
    throw new MoneyAllocationError(
      `Expected a non-negative decimal with at most four places for ${what}, received: ${value}`,
    );
  }
  return BigInt(match[1]) * UNITS + BigInt((match[2] ?? '').padEnd(SCALE, '0') || '0');
}

function fromUnits(units: bigint): string {
  const whole = units / UNITS;
  const fraction = (units % UNITS).toString().padStart(SCALE, '0');
  return `${whole}.${fraction}`;
}
