import { BadRequestException, ConflictException } from '@nestjs/common';

import { ChartOfAccountsService } from './chart-of-accounts.service';

/// The chart rules live on the server, so they are checked here — with a
/// Prisma double that remembers what it was asked and answers the few
/// questions the service asks it.
function fakePrisma(state: {
  accounts?: Array<Record<string, unknown>>;
  journalLines?: number;
}) {
  const accounts = state.accounts ?? [];
  const calls: { method: string; args: unknown }[] = [];

  const matches = (row: Record<string, unknown>, where: Record<string, any>) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && 'not' in (value as object)) {
        return row[key] !== (value as { not: unknown }).not;
      }
      return row[key] === value;
    });

  const delegate = {
    findMany: async (args: any) => {
      calls.push({ method: 'account.findMany', args });
      return accounts.filter((a) =>
        args?.where ? matches(a, { deletedAt: null, ...args.where }) : true,
      );
    },
    findFirst: async (args: any) => {
      calls.push({ method: 'account.findFirst', args });
      return (
        accounts.find((a) =>
          args?.where
            ? matches(a, args.where)
            : true,
        ) ?? null
      );
    },
    findUnique: async (args: any) => {
      calls.push({ method: 'account.findUnique', args });
      return accounts.find((a) => a.id === args.where.id) ?? null;
    },
    count: async (args: any) => {
      calls.push({ method: 'account.count', args });
      if (args?.where?.parentId) {
        return accounts.filter((a) => a.parentId === args.where.parentId).length;
      }
      return accounts.length;
    },
    create: async (args: any) => {
      calls.push({ method: 'account.create', args });
      return { id: 'new-id', isActive: true, ...args.data };
    },
    update: async (args: any) => {
      calls.push({ method: 'account.update', args });
      const row = accounts.find((a) => a.id === args.where.id) ?? accounts[0];
      return { ...row, ...Object.fromEntries(Object.entries(args.data).filter(([, value]) => value !== undefined)) };
    },
  };

  const journalLine = {
    count: async () => state.journalLines ?? 0,
  };

  return {
    calls,
    account: delegate,
    journalLine,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ account: delegate, journalLine, $queryRaw: async (query: {sql:string,values:unknown[]}) => {
        if (!query.sql.includes('WITH RECURSIVE')) return [{locked: 1}];
        const ids = new Set([query.values[0]]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const a of accounts) if (ids.has(a.parentId) && !ids.has(a.id)) { ids.add(a.id); changed = true; }
        }
        return [...ids].map(id => ({id}));
      } }),
  } as any;
}

function serviceWith(prisma: any) {
  const audit = { recordRequired: async () => {} } as any;
  return new ChartOfAccountsService(prisma, audit);
}

const baseAccounts = [
  {
    id: 'root-1',
    companyId: 'c1',
    code: '1',
    nameEn: 'Assets',
    nameAr: 'الأصول',
    type: 'ASSET',
    parentId: null,
    isPostable: false,
    isActive: true,
    currency: null,
    deletedAt: null,
  },
  {
    id: 'child-11',
    companyId: 'c1',
    code: '11',
    nameEn: 'Current assets',
    nameAr: 'الأصول المتداولة',
    type: 'ASSET',
    parentId: 'root-1',
    isPostable: true,
    isActive: true,
    currency: null,
    deletedAt: null,
  },
];

describe('chart audit requirement', () => {
  it.each(['create', 'update', 'remove'] as const)(
    '%s propagates audit failures from the transaction', async (operation) => {
      const prisma = fakePrisma({ accounts: baseAccounts });
      const error = new Error('synthetic audit failure');
      const recordRequired = jest.fn(async (_input: unknown, tx: unknown) => {
        expect(tx).toBeDefined();
        throw error;
      });
      const service = new ChartOfAccountsService(prisma, { recordRequired } as any);
      const action = operation === 'create'
        ? service.create('c1', 'u1', { code: '12', nameEn: 'New', nameAr: 'جديد', type: 'ASSET' })
        : operation === 'update'
          ? service.update('c1', 'u1', 'child-11', { nameEn: 'Updated' })
          : service.remove('c1', 'u1', 'child-11');
      await expect(action).rejects.toBe(error);
      expect(recordRequired).toHaveBeenCalledTimes(1);
      expect(recordRequired.mock.calls[0][0]).toMatchObject({ entity: 'accounts' });
    },
  );
});

describe('ChartOfAccountsService', () => {
  describe('suggestCode', () => {
    it('matches the width the existing children use', async () => {
      const service = serviceWith(fakePrisma({ accounts: baseAccounts }));
      // root '1' has child '11', so the next one is '12'.
      await expect(service.suggestCode('c1', 'root-1')).resolves.toEqual({
        code: '12',
      });
    });

    it('numbers a first child the way the starter chart does', async () => {
      const service = serviceWith(fakePrisma({ accounts: baseAccounts }));
      // '11' has no children yet, so it gets '1101'.
      await expect(service.suggestCode('c1', 'child-11')).resolves.toEqual({
        code: '1101',
      });
    });

    it('offers the next single digit at the root', async () => {
      const service = serviceWith(fakePrisma({ accounts: baseAccounts }));
      await expect(service.suggestCode('c1', null)).resolves.toEqual({
        code: '2',
      });
    });
  });

  describe('create', () => {
    it('refuses a code that is already used', async () => {
      const service = serviceWith(fakePrisma({ accounts: baseAccounts }));
      await expect(
        service.create('c1', 'u1', {
          code: '11',
          nameEn: 'Dup',
          nameAr: 'مكرر',
          type: 'ASSET',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a code retained by a soft-deleted account', async () => {
      const prisma = fakePrisma({ accounts: [{ ...baseAccounts[1], deletedAt: new Date() }] });
      await expect(serviceWith(prisma).create('c1', 'u1', {
        code: '11', nameEn: 'Duplicate', nameAr: 'مكرر', type: 'ASSET',
      })).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a parent of a different account type', async () => {
      const prisma = fakePrisma({
        accounts: [
          ...baseAccounts,
          {
            id: 'equity',
            companyId: 'c1',
            code: '3',
            nameEn: 'Equity',
            nameAr: 'حقوق الملكية',
            type: 'EQUITY',
            parentId: null,
            isPostable: false,
            isActive: true,
            currency: null,
            deletedAt: null,
          },
        ],
      });
      const service = serviceWith(prisma);
      await expect(
        service.create('c1', 'u1', {
          nameEn: 'Wrong',
          nameAr: 'خطأ',
          type: 'ASSET',
          parentId: 'equity',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a parent that does not exist', async () => {
      const service = serviceWith(fakePrisma({ accounts: baseAccounts }));
      await expect(
        service.create('c1', 'u1', {
          nameEn: 'Orphan',
          nameAr: 'يتيم',
          type: 'ASSET',
          parentId: 'missing',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('turns the parent into a grouping account when it gains a child', async () => {
      const prisma = fakePrisma({ accounts: baseAccounts });
      const service = serviceWith(prisma);
      await service.create('c1', 'u1', {
        nameEn: 'Cash',
        nameAr: 'نقدية',
        type: 'ASSET',
        parentId: 'child-11',
      });
      const update = prisma.calls.find((c: { method: string }) => c.method === 'account.update');
      expect(update).toBeDefined();
      expect((update as { args: any }).args.data).toEqual({
        isPostable: false,
      });
    });
  });

  describe('update', () => {
    it('refuses to renumber an account that already carries movements', async () => {
      const service = serviceWith(
        fakePrisma({ accounts: baseAccounts, journalLines: 3 }),
      );
      await expect(
        service.update('c1', 'u1', 'child-11', { code: '11X' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to move an account under its own descendant', async () => {
      const service = serviceWith(fakePrisma({ accounts: baseAccounts }));
      await expect(
        service.update('c1', 'u1', 'root-1', { parentId: 'child-11' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('detaches an unused account when the expected parent matches', async () => {
      const prisma = fakePrisma({accounts:baseAccounts});
      const result = await serviceWith(prisma).update('c1','u1','child-11',{
        parentId:null,expectedParentId:'root-1',
      });
      expect(result.parentId).toBeNull();
    });

    it('refuses a stale expected parent and a snapshot without a move', async () => {
      const prisma = fakePrisma({accounts:baseAccounts});
      await expect(serviceWith(prisma).update('c1','u1','child-11',{
        parentId:null,expectedParentId:'other',
      })).rejects.toBeInstanceOf(ConflictException);
      await expect(serviceWith(prisma).update('c1','u1','child-11',{
        expectedParentId:'root-1',
      })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.calls.some((c: {method:string})=>c.method==='account.update')).toBe(false);
    });

    it('refuses moving a subtree with any journal lines, including drafts', async () => {
      const prisma = fakePrisma({accounts:baseAccounts,journalLines:1});
      await expect(serviceWith(prisma).update('c1','u1','child-11',{
        parentId:null,expectedParentId:'root-1',
      })).rejects.toThrow(/historical reports/);
      expect(prisma.calls.some((c: {method:string})=>c.method==='account.update')).toBe(false);
    });

    it('refuses to make a parent postable while it has children', async () => {
      const prisma = fakePrisma({ accounts: baseAccounts });
      const service = serviceWith(prisma);
      await expect(
        service.update('c1', 'u1', 'root-1', { isPostable: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remove', () => {
    it('refuses to delete an account with journal movements', async () => {
      const service = serviceWith(
        fakePrisma({ accounts: baseAccounts, journalLines: 1 }),
      );
      await expect(service.remove('c1', 'u1', 'child-11')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses to delete an account with children', async () => {
      const service = serviceWith(fakePrisma({ accounts: baseAccounts }));
      await expect(service.remove('c1', 'u1', 'root-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('soft-deletes a leaf account', async () => {
      const prisma = fakePrisma({ accounts: baseAccounts });
      const service = serviceWith(prisma);
      await service.remove('c1', 'u1', 'child-11');
      const update = prisma.calls.find((c: { method: string }) => c.method === 'account.update');
      expect((update as { args: any }).args.data.deletedAt).toBeInstanceOf(Date);
    });
  });
});

/// Desktop expense-account rules, kept from the earlier expense screen.
describe('ChartOfAccountsService desktop expense rules', () => {
  const expenseParent = {
    id: 'exp-parent',
    companyId: 'c1',
    code: '5',
    nameEn: 'Expenses',
    nameAr: 'المصروفات',
    type: 'EXPENSE',
    parentId: null,
    isPostable: false,
    isActive: true,
    currency: null,
    description: null,
    deletedAt: null,
  };

  it('creates an expense account when no type is named, keeping the description', async () => {
    const prisma = fakePrisma({ accounts: [expenseParent] });
    const result = await serviceWith(prisma).create('c1', 'u1', {
      code: '510201',
      nameEn: 'Travel',
      nameAr: 'انتقالات',
      parentId: 'exp-parent',
      description: ' Local travel ',
    } as any);

    expect(result).toMatchObject({ type: 'expense', description: 'Local travel' });
    const created = prisma.calls.find((c: { method: string }) => c.method === 'account.create') as any;
    expect(created.args.data.type).toBe('EXPENSE');
  });

  it('refuses an inactive parent', async () => {
    const prisma = fakePrisma({ accounts: [{ ...expenseParent, isActive: false }] });
    await expect(
      serviceWith(prisma).create('c1', 'u1', {
        code: '510202',
        nameEn: 'Fuel',
        nameAr: 'وقود',
        parentId: 'exp-parent',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not reactivate a child under an inactive parent', async () => {
    const prisma = fakePrisma({
      accounts: [{ ...expenseParent, isActive: false },
        { ...expenseParent, id: 'child', parentId: 'exp-parent', code: '51', isActive: false }],
    });
    await expect(serviceWith(prisma).update('c1', 'u1', 'child', { isActive: true }))
      .rejects.toThrow(/parent account is inactive/i);
    expect(prisma.calls.some((call: { method: string }) => call.method === 'account.update')).toBe(false);
  });

  it('will not deactivate an account that still has active subaccounts', async () => {
    const prisma = fakePrisma({
      accounts: [expenseParent, { ...expenseParent, id: 'child', parentId: 'exp-parent', code: '51', isActive: true }],
    });
    await expect(
      serviceWith(prisma).update('c1', 'u1', 'exp-parent', { isActive: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

