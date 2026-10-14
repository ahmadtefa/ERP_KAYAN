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
            ? matches(a, { deletedAt: null, ...args.where })
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
      return { ...accounts[0], ...args.data };
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
      fn({ account: delegate, journalLine }),
  } as any;
}

function serviceWith(prisma: any) {
  const audit = { record: async () => {} } as any;
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
