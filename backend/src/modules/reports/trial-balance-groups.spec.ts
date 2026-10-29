import { Prisma } from '@prisma/client';

import {
  buildTrialBalanceGroups,
  TrialBalanceAccount,
  TrialBalanceValues,
} from './trial-balance-groups';

const account = (
  partial: Partial<TrialBalanceAccount> & { id: string; code: string },
): TrialBalanceAccount => ({
  nameEn: partial.code,
  nameAr: partial.code,
  type: 'ASSET',
  parentId: null,
  isPostable: true,
  ...partial,
});

const values = (closing: string, debit = closing): TrialBalanceValues => ({
  opening: new Prisma.Decimal(0),
  debit: new Prisma.Decimal(debit),
  credit: new Prisma.Decimal(0),
  closing: new Prisma.Decimal(closing),
});

describe('buildTrialBalanceGroups', () => {
  const chart: TrialBalanceAccount[] = [
    account({ id: 'g-1', code: '1', isPostable: false }),
    account({ id: 'g-11', code: '11', isPostable: false, parentId: 'g-1' }),
    account({ id: 'a-cash', code: '1101', parentId: 'g-11' }),
    account({ id: 'a-rec', code: '1101.REC', parentId: 'a-cash' }),
    account({ id: 'a-inv', code: '1104', parentId: 'g-11' }),
    account({ id: 'g-12', code: '12', isPostable: false, parentId: 'g-1' }),
    account({ id: 'a-plant', code: '1201', parentId: 'g-12' }),
    account({ id: 'g-empty', code: '19', isPostable: false, parentId: 'g-1' }),
    account({ id: 'a-idle', code: '1901', parentId: 'g-empty' }),
  ];

  const byId = new Map<string, TrialBalanceValues>([
    ['a-cash', values('100')],
    ['a-rec', values('50')],
    ['a-inv', values('30')],
    ['a-plant', values('200')],
    ['a-idle', values('0', '0')],
  ]);

  it('rolls every descendant into its headings, at each level', () => {
    const groups = buildTrialBalanceGroups(chart, byId);
    const byCode = new Map(groups.map((g) => [g.code, g]));

    // 1101 is postable and a parent: no subtotal of its own, but its own
    // 100 and its child's 50 both roll into 11.
    expect(byCode.has('1101')).toBe(false);
    expect(byCode.get('11')?.closing).toBe('180.0000');
    expect(byCode.get('12')?.closing).toBe('200.0000');
    expect(byCode.get('1')?.closing).toBe('380.0000');
    expect(byCode.get('1')?.depth).toBe(0);
    expect(byCode.get('11')?.depth).toBe(1);
  });

  it('omits headings whose whole subtree is zero', () => {
    const groups = buildTrialBalanceGroups(chart, byId);
    expect(groups.map((g) => g.code)).not.toContain('19');
  });

  it('survives a parent cycle instead of hanging', () => {
    const cyclic = [
      account({ id: 'x', code: '9', isPostable: false, parentId: 'y' }),
      account({ id: 'y', code: '99', isPostable: false, parentId: 'x' }),
      account({ id: 'z', code: '9901', parentId: 'x' }),
    ];
    const groups = buildTrialBalanceGroups(
      cyclic,
      new Map([['z', values('7')]]),
    );
    expect(groups.length).toBeGreaterThan(0);
  });
});
