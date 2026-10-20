const MONEY_SCALE = 4;
const MONEY_UNITS = 10_000n;

/**
 * Allocate a fixed monetary total across line values by weight.
 *
 * All inputs are decimal strings already rounded to four places. Integer
 * arithmetic avoids binary/decimal division drift, and the largest-remainder
 * method makes the allocations add up to the supplied total exactly (even
 * when the total is one ten-thousandth and there are many lines).
 */
export function allocateLandedCostAmounts(
  lineValues: readonly string[],
  totalAmount: string,
): string[] {
  const totalUnits = toMoneyUnits(totalAmount);
  const valueUnits = lineValues.map(toMoneyUnits);
  if (valueUnits.some((value) => value < 0n)) {
    throw new Error('Line values used for landed-cost allocation cannot be negative');
  }
  if (totalUnits < 0n) {
    throw new Error('Landed costs cannot be negative');
  }
  if (valueUnits.length === 0) {
    if (totalUnits === 0n) return [];
    throw new Error('A landed cost cannot be allocated without invoice lines');
  }
  if (totalUnits === 0n) return valueUnits.map(() => '0.0000');

  const subtotalUnits = valueUnits.reduce((sum, value) => sum + value, 0n);
  if (subtotalUnits === 0n) {
    throw new Error('A positive landed cost needs a positive invoice line value to allocate against');
  }

  const portions = valueUnits.map((value, index) => {
    const numerator = totalUnits * value;
    return {
      index,
      units: numerator / subtotalUnits,
      remainder: numerator % subtotalUnits,
    };
  });

  let remaining = totalUnits - portions.reduce((sum, portion) => sum + portion.units, 0n);
  const byRemainder = [...portions].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (const portion of byRemainder) {
    if (remaining === 0n) break;
    if (valueUnits[portion.index] === 0n) continue;
    portion.units += 1n;
    remaining -= 1n;
  }
  if (remaining !== 0n) {
    throw new Error('Could not distribute every landed-cost rounding unit');
  }

  return portions
    .sort((left, right) => left.index - right.index)
    .map((portion) => fromMoneyUnits(portion.units));
}

function toMoneyUnits(input: string): bigint {
  const value = String(input).trim();
  const match = /^(\+)?(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (!match) throw new Error(`Expected a non-negative decimal with at most four places, received: ${value}`);
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? '').padEnd(MONEY_SCALE, '0') || '0');
  return whole * MONEY_UNITS + fraction;
}

function fromMoneyUnits(units: bigint): string {
  const whole = units / MONEY_UNITS;
  const fraction = (units % MONEY_UNITS).toString().padStart(MONEY_SCALE, '0');
  return `${whole}.${fraction}`;
}
