import { EIGHT_DIGIT_STARTER_ACCOUNTS } from '../../../prisma/starter-chart';
import {
  eightDigitViolation,
  nextEightDigitChildCode,
  normalizeAccountCode,
} from './account-code-scheme';
import { ACCOUNT_CODES, EIGHT_DIGIT_ACCOUNT_CODES } from './account-map.service';

describe('eight digit rule', () => {
  it('accepts the 2/4/6/8 chain and refuses everything else', () => {
    expect(eightDigitViolation({ code: '01', parentCode: null, isPostable: false })).toBeNull();
    expect(eightDigitViolation({ code: '0101', parentCode: '01', isPostable: false })).toBeNull();
    expect(eightDigitViolation({ code: '010101', parentCode: '0101', isPostable: false })).toBeNull();
    expect(eightDigitViolation({ code: '01010101', parentCode: '010101', isPostable: true })).toBeNull();
    // posting on a total
    expect(eightDigitViolation({ code: '010101', parentCode: '0101', isPostable: true })).not.toBeNull();
    expect(eightDigitViolation({ code: '01', parentCode: null, isPostable: true })).not.toBeNull();
    // odd length, non numeric, wrong prefix, missing parent, 2-digit with parent
    expect(eightDigitViolation({ code: '101', parentCode: '1', isPostable: false })).not.toBeNull();
    expect(eightDigitViolation({ code: '01A1', parentCode: '01', isPostable: false })).not.toBeNull();
    expect(eightDigitViolation({ code: '0201', parentCode: '01', isPostable: false })).not.toBeNull();
    expect(eightDigitViolation({ code: '0101', parentCode: null, isPostable: false })).not.toBeNull();
    expect(eightDigitViolation({ code: '01', parentCode: '01', isPostable: false })).not.toBeNull();
    // a skipped level
    expect(eightDigitViolation({ code: '010101', parentCode: '01', isPostable: false })).not.toBeNull();
  });

  it('normalises Arabic-Indic digits and suggests the next two-digit child', () => {
    expect(normalizeAccountCode(' ٠١٠١ ')).toBe('0101');
    expect(nextEightDigitChildCode(null, new Set(['01', '02']))).toBe('03');
    expect(nextEightDigitChildCode('0101', new Set(['010101']))).toBe('010102');
    expect(nextEightDigitChildCode('01010101', new Set())).toBeNull();
  });
});

describe('eight digit starter chart', () => {
  const byCode = new Map(EIGHT_DIGIT_STARTER_ACCOUNTS.map((a) => [a.code, a]));

  it('every account obeys the rule and has unique code', () => {
    expect(byCode.size).toBe(EIGHT_DIGIT_STARTER_ACCOUNTS.length);
    for (const a of EIGHT_DIGIT_STARTER_ACCOUNTS) {
      expect(eightDigitViolation({ code: a.code, parentCode: a.parent ?? null, isPostable: a.postable })).toBeNull();
      if (a.parent) {
        const parent = byCode.get(a.parent)!;
        expect(parent).toBeDefined();
        expect(parent.type).toBe(a.type);
        expect(parent.postable).toBe(false);
      }
      expect(a.postable).toBe(a.code.length === 8);
    }
  });

  it('every role the posting engine needs is a postable account of the right place', () => {
    for (const code of new Set(Object.values(EIGHT_DIGIT_ACCOUNT_CODES))) {
      expect(byCode.get(code)?.postable).toBe(true);
    }
    // same roles, same nature as the legacy map
    expect(byCode.get(EIGHT_DIGIT_ACCOUNT_CODES.accountsReceivable)?.type).toBe('ASSET');
    expect(byCode.get(EIGHT_DIGIT_ACCOUNT_CODES.accountsPayable)?.type).toBe('LIABILITY');
    expect(byCode.get(EIGHT_DIGIT_ACCOUNT_CODES.salesRevenue)?.type).toBe('REVENUE');
    expect(byCode.get(EIGHT_DIGIT_ACCOUNT_CODES.costOfGoodsSold)?.type).toBe('EXPENSE');
    expect(Object.keys(EIGHT_DIGIT_ACCOUNT_CODES).sort()).toEqual(Object.keys(ACCOUNT_CODES).sort());
  });
});
