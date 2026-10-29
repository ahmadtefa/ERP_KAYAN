import { BadRequestException } from '@nestjs/common';

/**
 * Code 128, code set B — the barcode used on item/unit labels.
 *
 * Pure geometry, no I/O. Set B covers ASCII 32–127, which every item code and
 * unit barcode in the system already uses. It is not the shortest possible
 * encoding for long digit runs (set C would be), but a scanner reads both
 * identically and one deterministic set keeps the labels auditable.
 *
 * The pattern table is the published Code 128 symbol table (each string is a
 * six-module pattern, 1 = bar, 0 = space, three of each). It is cross-checked
 * against the independent python-barcode library in barcode-labels.spec.ts.
 */

/// Symbol patterns for values 0–105. STOP (106) is a seven-module pattern.
const PATTERNS: readonly string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
  '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
  '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
  '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
  '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
  '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
  '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
  '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
  '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
  '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
  '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
  '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010000100', '11010010000',
  '11010011100',
];

const START_B = 104;
const STOP = 106;
const STOP_PATTERN = '2331112';
const MODULES_PER_SYMBOL = 11;

export interface Code128Module {
  bar: boolean;
  width: number;
}

export interface Code128Encoding {
  /// Code 128 symbol values: START_B, data…, checksum, STOP.
  symbols: number[];
  checksum: number;
  /// Alternating bar/space runs, beginning and ending with a bar.
  modules: Code128Module[];
  /// Published symbol concatenation used as a cross-library test vector:
  /// eleven-bit patterns for values 0–105, then the seven-width STOP code.
  widthPattern: string;
}

function valueForSetB(char: string, index: number): number {
  const code = char.charCodeAt(0);
  if (code < 32 || code > 127) {
    throw new BadRequestException(
      `Barcode character at position ${index + 1} is outside the printable Code 128 set B range`,
    );
  }
  return code - 32;
}

/** Encode text into a Code 128 set B symbol with its modulus-103 checksum. */
export function encodeCode128B(value: string): Code128Encoding {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException('A barcode label needs a non-empty barcode');
  }
  if (value.length > 80) {
    throw new BadRequestException('Barcode is too long for a Code 128 label (max 80 characters)');
  }

  const dataValues: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    dataValues.push(valueForSetB(value[i], i));
  }

  let weighted = START_B;
  dataValues.forEach((v, i) => {
    weighted += (i + 1) * v;
  });
  const checksum = weighted % 103;
  const symbols = [START_B, ...dataValues, checksum, STOP];

  // Values 0–105 are eleven-bit patterns (1 = bar, 0 = space), each starting
  // with a bar and ending with a space, so concatenating them keeps runs
  // naturally alternating. STOP (106) is published as seven run widths rather
  // than bits, so it is appended in its own convention. `widthPattern` keeps
  // the exact published concatenation (used as a cross-library test vector);
  // `modules` is the normalised run list the SVG renderer actually draws.
  const symbolBits = symbols.slice(0, -1).map((s) => PATTERNS[s]).join('');
  const widthPattern = symbolBits + STOP_PATTERN;

  const modules: Code128Module[] = [];
  for (let i = 0; i < symbolBits.length; ) {
    const isBar = symbolBits[i] === '1';
    let width = 0;
    while (i < symbolBits.length && (symbolBits[i] === '1') === isBar) {
      width += 1;
      i += 1;
    }
    modules.push({ bar: isBar, width });
  }
  // The bit stream ends on a space and STOP opens on a bar, so appending its
  // seven published widths continues the alternation without a seam.
  let stopIsBar = true;
  for (const digit of STOP_PATTERN) {
    modules.push({ bar: stopIsBar, width: Number(digit) });
    stopIsBar = !stopIsBar;
  }

  return { symbols, checksum, modules, widthPattern };
}

/** Number of quiet-zone modules required on each side of the symbol. */
export const QUIET_ZONE_MODULES = 10;

export { PATTERNS as CODE128_PATTERNS, STOP_PATTERN as CODE128_STOP_PATTERN, MODULES_PER_SYMBOL };
