import { BadRequestException } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';

describe('ChartOfAccountsService expense hierarchy', () => {
  const prisma = {
    account: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const service = new ChartOfAccountsService(prisma, audit);

  beforeEach(() => jest.clearAllMocks());

  it('rejects a postable account as a parent', async () => {
    (prisma.account.findFirst as jest.Mock).mockResolvedValue({
      id: 'parent-id',
      companyId: 'company-id',
      type: AccountType.EXPENSE,
      isPostable: true,
      isActive: true,
    });

    await expect(
      service.createExpenseAccount('company-id', 'user-id', {
        code: '510201',
        nameEn: 'Travel',
        nameAr: 'انتقالات',
        parentId: 'parent-id',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it('creates an expense account under an active grouping expense account', async () => {
    const parent = {
      id: 'parent-id', companyId: 'company-id', type: AccountType.EXPENSE,
      isPostable: false, isActive: true,
    };
    (prisma.account.findFirst as jest.Mock)
      .mockResolvedValueOnce(parent)
      .mockResolvedValueOnce(null);
    (prisma.account.create as jest.Mock).mockResolvedValue({
      id: 'child-id', companyId: 'company-id', code: '510201',
      nameEn: 'Travel', nameAr: 'انتقالات', type: AccountType.EXPENSE,
      parentId: 'parent-id', isPostable: true, isActive: true,
      currency: null, description: 'Local travel',
    });

    const result = await service.createExpenseAccount('company-id', 'user-id', {
      code: ' 510201 ', nameEn: ' Travel ', nameAr: ' انتقالات ',
      parentId: 'parent-id', description: ' Local travel ',
    });

    expect(result).toMatchObject({
      id: 'child-id', code: '510201', parentId: 'parent-id',
      type: 'expense', description: 'Local travel', isPostable: true,
    });
    expect(prisma.account.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId: 'company-id', type: AccountType.EXPENSE }),
    }));
  });
});
