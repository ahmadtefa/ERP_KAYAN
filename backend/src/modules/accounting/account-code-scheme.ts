import { Prisma } from '@prisma/client';

/**
 * The account code scheme.
 *
 * EIGHT_DIGIT: numeric codes in four levels of
 * 2, 4, 6 and 8 digits. Every level adds two digits to its parent's code
 * (01 -> 0101 -> 010101 -> 01010101). Only the 8-digit level is a posting
 * account; the shorter levels are totals and never take an entry.
 *
 * LEGACY: the free-form dotless codes older companies were created with
 * (1, 11, 1101 ...). Kept so an operating company is not locked out of posting
 * the moment this rule ships. A company moves to EIGHT_DIGIT only through an
 * explicit switch that the database refuses unless the whole chart obeys the
 * rule.
 */
export type AccountCodeScheme = 'LEGACY' | 'EIGHT_DIGIT';

/**
 * Reads the company's scheme with one raw query, so it works on a Prisma
 * client, a transaction client and the PGlite test adapter alike. Anything
 * unreadable counts as LEGACY: the old behaviour, never a surprise lockout.
 */
export async function loadAccountCodeScheme(
  client: { $queryRaw: (...args: never[]) => unknown },
  companyId: string,
): Promise<AccountCodeScheme> {
  if (typeof client.$queryRaw !== 'function') return 'LEGACY';
  const rows = await (client as { $queryRaw: (q: Prisma.Sql) => Promise<unknown> }).$queryRaw(
    Prisma.sql`SELECT "accountCodeScheme"::text AS scheme FROM companies WHERE id = ${companyId}::uuid`,
  );
  return Array.isArray(rows) && rows[0]?.scheme === 'EIGHT_DIGIT' ? 'EIGHT_DIGIT' : 'LEGACY';
}

export const POSTING_CODE_LENGTH = 8;
export const EIGHT_DIGIT_LEVELS = [2, 4, 6, 8] as const;

/** Western or Arabic-Indic digits are accepted on input and normalised. */
export function normalizeAccountCode(code: string): string {
  return code
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function isEightDigitPostingCode(code: string): boolean {
  return /^[0-9]{8}$/.test(code);
}

export function eightDigitLevel(code: string): 1 | 2 | 3 | 4 | null {
  if (!/^[0-9]+$/.test(code) || code.length % 2 !== 0) return null;
  const level = code.length / 2;
  return level >= 1 && level <= 4 ? (level as 1 | 2 | 3 | 4) : null;
}

/**
 * Returns the reason a code/parent/postable combination breaks the eight
 * digit rule, or null when it is valid.
 */
export interface EightDigitViolation {
  code: string;
  message: string;
  params?: Record<string, string>;
}

export function eightDigitViolationDetail(input: {
  code: string;
  parentCode: string | null;
  isPostable: boolean;
}): EightDigitViolation | null {
  const { code, parentCode, isPostable } = input;
  const level = eightDigitLevel(code);
  if (level === null) {
    return { code: 'ACCOUNT_CODE_FORMAT', message: 'The account code must be numeric with 2, 4, 6 or 8 digits (each level adds two digits to its parent code)' };
  }
  if (level === 1 && parentCode) {
    return { code: 'ACCOUNT_TOP_LEVEL_NO_PARENT', message: 'A 2-digit account is a top-level account and cannot have a parent' };
  }
  if (level > 1) {
    if (!parentCode) {
      return {
        code: 'ACCOUNT_PARENT_REQUIRED',
        message: `A ${code.length}-digit account needs a parent account with the first ${code.length - 2} digits of its code`,
        params: { digits: String(code.length), parentDigits: String(code.length - 2) },
      };
    }
    if (parentCode.length !== code.length - 2 || !code.startsWith(parentCode)) {
      return {
        code: 'ACCOUNT_PARENT_MISMATCH',
        message: `The account code ${code} must start with its parent's code and add exactly two digits (parent is ${parentCode})`,
        params: { code, parent: parentCode },
      };
    }
  }
  if (isPostable && level !== 4) {
    return { code: 'ACCOUNT_POSTABLE_LEVEL', message: 'Only an 8-digit account can receive entries; shorter codes are totals' };
  }
  return null;
}

export function eightDigitViolation(input: {
  code: string;
  parentCode: string | null;
  isPostable: boolean;
}): string | null {
  return eightDigitViolationDetail(input)?.message ?? null;
}

/** Next free child code under a parent, in the eight digit scheme. */
export function nextEightDigitChildCode(parentCode: string | null, taken: Set<string>): string | null {
  const prefix = parentCode ?? '';
  if (prefix.length >= 8) return null;
  for (let n = 1; n <= 99; n += 1) {
    const candidate = prefix + String(n).padStart(2, '0');
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}
