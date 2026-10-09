import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** API shape expected by the Flutter client. */
export interface AccountResponse {
  id: string;
  companyId: string;
  code: string;
  name: string;
  nameEn: string;
  nameAr: string;
  type: string;
  parentId: string | null;
  isPostable: boolean;
  isActive: boolean;
  currency: string | null;
}

@Injectable()
export class ChartOfAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string): Promise<{ items: AccountResponse[] }> {
    const accounts = await this.prisma.account.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { code: 'asc' },
    });

    return {
      items: accounts.map((a) => ({
        id: a.id,
        companyId: a.companyId,
        code: a.code,
        // `name` defaults to English; nameEn/nameAr let the client pick.
        name: a.nameEn,
        nameEn: a.nameEn,
        nameAr: a.nameAr,
        // The client expects lower-case type names.
        type: a.type.toLowerCase(),
        parentId: a.parentId,
        isPostable: a.isPostable,
        isActive: a.isActive,
        currency: a.currency,
      })),
    };
  }
}
