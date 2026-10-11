/**
 * The one place that decides which account name a person sees.
 *
 * The program is bilingual and accounts carry two names. Everywhere a name is
 * shown — screens, reports, exported files — it goes through here, so the
 * rules are the same in every corner of the system:
 *
 *  - the requested language wins when the account has that name;
 *  - the other language is the fallback when it does not;
 *  - the account code is the last resort, so a cell is never blank and never
 *    the word "null".
 *
 * The company typed these names. Nothing here translates them: an account the
 * business named "البنك الأهلي" stays exactly that in every language.
 */

export type Lang = 'ar' | 'en';

export interface AccountNameSource {
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
}

/** The name to show for `lang`, with the documented fallbacks. */
export function accountName(account: AccountNameSource, lang: Lang): string {
  const preferred = (lang === 'ar' ? account.nameAr : account.nameEn)?.trim();
  if (preferred) return preferred;

  const other = (lang === 'ar' ? account.nameEn : account.nameAr)?.trim();
  if (other) return other;

  return account.code;
}

/** "1101 — النقدية بالصندوق", the label used in pickers and meta rows. */
export function accountLabel(account: AccountNameSource, lang: Lang): string {
  return `${account.code} — ${accountName(account, lang)}`;
}

/**
 * The fallback itself, for places that must say something when even the code
 * is missing (a broken row, an import template). One phrase, used everywhere.
 */
export const UNKNOWN_ACCOUNT = '—';
