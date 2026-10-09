import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * The accounts that automatic postings use.
 *
 * These are conventional defaults for a trading company. They are looked up by
 * code so a company that renumbers its chart of accounts only has to change
 * this map, not the posting logic.
 *
 * REQUIRES BUSINESS DECISION: the chart of accounts mapping, and whether VAT
 * applies at all. Nothing here is a legal opinion on tax treatment.
 */
export const ACCOUNT_CODES = {
  accountsReceivable: '1103',
  accountsPayable: '2101',
  inventory: '1104',
  vatReceivable: '1105',
  vatPayable: '2103',
  salesRevenue: '4101',
  costOfGoodsSold: '5101',
} as const;

export type AccountKey = keyof typeof ACCOUNT_CODES;

@Injectable()
export class AccountMapService {
  /**
   * Resolves the codes to account ids inside the caller's transaction, so the
   * lookup sees exactly the same snapshot as the posting that uses it.
   */
  async resolve(
    tx: Prisma.TransactionClient,
    companyId: string,
    keys: AccountKey[],
  ): Promise<Record<AccountKey, string>> {
    const codes = keys.map((k) => ACCOUNT_CODES[k]);
    const accounts = await tx.account.findMany({
      where: { companyId, code: { in: codes }, deletedAt: null },
      select: { id: true, code: true, isPostable: true, isActive: true },
    });

    const result = {} as Record<AccountKey, string>;
    for (const key of keys) {
      const code = ACCOUNT_CODES[key];
      const account = accounts.find((a) => a.code === code);
      if (!account) {
        throw new BadRequestException(
          `Required account ${code} (${key}) does not exist in this company's chart of accounts`,
        );
      }
      if (!account.isPostable) {
        throw new BadRequestException(`Account ${code} cannot receive postings`);
      }
      if (!account.isActive) {
        throw new BadRequestException(`Account ${code} is inactive`);
      }
      result[key] = account.id;
    }
    return result;
  }
}
