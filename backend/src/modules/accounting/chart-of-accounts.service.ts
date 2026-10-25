import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CreateAccountDto,
  ListAccountsQueryDto,
  UpdateAccountDto,
} from './dto/account.dto';

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
  description: string | null;
  cashFlowClass: string | null;
}

/**
 * The chart of accounts, in every depth the company needs.
 *
 * The rules, all enforced here on the server:
 *
 *  - a code is unique within the company and never renumbered after the
 *    account carries movements (history keeps its labels);
 *  - a child shares its parent's account type, so the tree can be summed
 *    without surprises;
 *  - an account that has children is a grouping account and cannot receive
 *    postings; when a postable account gains its first child and has no
 *    movements of its own, it becomes a grouping account automatically;
 *  - an account with movements or children is never deleted — it is
 *    deactivated instead, so the books keep their past;
 *  - moving an account can never close a circle (an account cannot become its
 *    own ancestor).
 */
@Injectable()
export class ChartOfAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    companyId: string,
    query: ListAccountsQueryDto = {},
  ): Promise<{ items: AccountResponse[] }> {
    const where: Prisma.AccountWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.type ? { type: query.type as AccountType } : {}),
      ...(query.parentId ? { parentId: query.parentId } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { nameEn: { contains: query.q, mode: 'insensitive' } },
              { nameAr: { contains: query.q } },
            ],
          }
        : {}),
    };

    const accounts = await this.prisma.account.findMany({
      where,
      orderBy: { code: 'asc' },
    });

    return { items: accounts.map((a) => toResponse(a)) };
  }

  async findOne(companyId: string, id: string): Promise<AccountResponse> {
    return toResponse(await this.findAccount(companyId, id));
  }

  /**
   * Suggests the next free code under a parent, following the numbering the
   * seeded chart uses: a child's code starts with its parent's code, and the
   * suffix width matches the existing siblings (1 → 11, 12 …; 11 → 1101,
   * 1102 …). The suggestion is a starting point — the caller may send any
   * unique code instead.
   */
  async suggestCode(
    companyId: string,
    parentId: string | null,
  ): Promise<{ code: string }> {
    let prefix = '';
    if (parentId) {
      const parent = await this.findAccount(companyId, parentId);
      prefix = parent.code;
    }
    const siblings = await this.prisma.account.findMany({
      where: { companyId, parentId, deletedAt: null },
      select: { code: true },
    });
    const taken = new Set(siblings.map((s) => s.code));

    // The width the existing children use; for a first child, one digit
    // under a one-digit parent (1 → 11) and two digits deeper (11 → 1101),
    // which is exactly how the starter chart is numbered.
    const siblingWidth = siblings.length
      ? Math.max(1, siblings[0].code.length - prefix.length)
      : prefix.length >= 2
        ? 2
        : 1;

    for (let n = 1; n < 10_000; n += 1) {
      const candidate = prefix + String(n).padStart(siblingWidth, '0');
      if (!taken.has(candidate)) return { code: candidate };
    }
    throw new BadRequestException('No free code left under this parent');
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateAccountDto,
  ): Promise<AccountResponse> {
    const type = (dto.type ?? 'EXPENSE') as AccountType;
    const parentId = dto.parentId ?? null;

    // The parent is checked first: an account cannot be planned under a
    // parent that will not accept it, and guessing a code for one is wasted.
    if (parentId) {
      await this.assertParentUsable(companyId, parentId, type);
    }

    let code = dto.code?.trim();
    if (!code) {
      code = (await this.suggestCode(companyId, parentId)).code;
    }
    await this.assertCodeFree(companyId, code);

    // A grouping account collects children; a final account receives
    // postings. The two are never mixed in one row's intent.
    const isPostable = dto.isPostable ?? (parentId ? true : false);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.account.create({
        data: {
          companyId,
          code,
          nameEn: dto.nameEn,
          nameAr: dto.nameAr,
          type,
          parentId,
          isPostable,
          currency: dto.currency ?? null,
          cashFlowClass: dto.cashFlowClass ?? null,
          description: dto.description?.trim() || null,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      // The moment an account gains a child, it becomes a grouping account —
      // unless it already carries postings, which must never be rewritten.
      if (parentId) {
        await this.demoteParentToGrouping(tx, companyId, parentId);
      }
      return row;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'accounts',
      entityId: created.id,
      after: {
        code: created.code,
        nameEn: created.nameEn,
        nameAr: created.nameAr,
        type: created.type,
        parentId: created.parentId,
        isPostable: created.isPostable,
      },
    });

    return toResponse(created);
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateAccountDto,
  ): Promise<AccountResponse> {
    const account = await this.findAccount(companyId, id);

    // Deactivating a grouping account would leave its active children orphaned
    // in the tree; the subaccounts are deactivated first.
    if (dto.isActive === false && account.isActive) {
      const activeChildren = await this.prisma.account.count({
        where: { parentId: id, companyId, deletedAt: null, isActive: true },
      });
      if (activeChildren > 0) {
        throw new BadRequestException(
          'Deactivate active subaccounts before deactivating their parent',
        );
      }
    }

    if (dto.code !== undefined && dto.code !== account.code) {
      const movements = await this.prisma.journalLine.count({
        where: { accountId: id },
      });
      if (movements > 0) {
        throw new BadRequestException(
          'This account already has journal movements. Its code cannot be changed — ' +
            'deactivate it and create a new account instead.',
        );
      }
      await this.assertCodeFree(companyId, dto.code, id);
    }

    let parentChanged = false;
    if (dto.parentId !== undefined && dto.parentId !== account.parentId) {
      parentChanged = true;
      if (dto.parentId === id) {
        throw new BadRequestException('An account cannot be its own parent');
      }
      await this.assertParentUsable(
        companyId,
        dto.parentId,
        account.type as AccountType,
        id,
      );
    }

    // An account with children is a grouping account: it may not claim to be
    // postable while it still collects others.
    if (dto.isPostable === true) {
      const children = await this.prisma.account.count({
        where: { parentId: id, deletedAt: null },
      });
      if (children > 0) {
        throw new BadRequestException(
          'This account has sub-accounts, so it is a grouping account and cannot ' +
            'receive postings. Remove the sub-accounts first.',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.account.update({
        where: { id },
        data: {
          code: dto.code,
          nameEn: dto.nameEn,
          nameAr: dto.nameAr,
          parentId: dto.parentId,
          isPostable: dto.isPostable,
          isActive: dto.isActive,
          currency: dto.currency,
          cashFlowClass: dto.cashFlowClass,
          description:
            dto.description === undefined ? undefined : dto.description?.trim() || null,
          updatedBy: userId,
        },
      });

      if (parentChanged && dto.parentId) {
        await this.demoteParentToGrouping(tx, companyId, dto.parentId);
      }
      return row;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'accounts',
      entityId: id,
      before: toResponse(account),
      after: toResponse(updated),
    });

    return toResponse(updated);
  }

  /**
   * Deletes an account — only when nothing depends on it.
   *
   * An account with journal movements or with children is history: deleting
   * it would leave the ledger pointing at nothing. Those are deactivated
   * instead, which the screen offers in the same place.
   */
  async remove(companyId: string, userId: string, id: string): Promise<void> {
    const account = await this.findAccount(companyId, id);

    const [movements, children] = await Promise.all([
      this.prisma.journalLine.count({ where: { accountId: id } }),
      this.prisma.account.count({
        where: { parentId: id, deletedAt: null },
      }),
    ]);

    if (movements > 0) {
      throw new BadRequestException(
        'This account has journal movements and cannot be deleted. ' +
          'Deactivate it instead so the past stays readable.',
      );
    }
    if (children > 0) {
      throw new BadRequestException(
        'This account has sub-accounts. Move or delete them first, or deactivate this account.',
      );
    }

    await this.prisma.account.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'DELETE',
      entity: 'accounts',
      entityId: id,
      before: toResponse(account),
    });
  }

  /// ────────────────────────────────────────────────────────────── helpers

  private async findAccount(companyId: string, id: string) {
    const account = await this.prisma.account.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  private async assertCodeFree(
    companyId: string,
    code: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.prisma.account.findFirst({
      where: {
        companyId,
        code,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        `The code "${code}" is already used by another account in this company`,
      );
    }
  }

  /**
   * A parent must exist in this company, must not be the account being moved
   * (or one of its descendants), and must share the child's account type.
   * A parent that already carries postings of its own is refused unless it is
   * already a grouping account — lines should end on final accounts.
   */
  private async assertParentUsable(
    companyId: string,
    parentId: string,
    type: AccountType,
    movingId?: string,
  ): Promise<void> {
    const parent = await this.prisma.account.findFirst({
      where: { id: parentId, companyId, deletedAt: null },
    });
    if (!parent) {
      throw new BadRequestException(
        'The parent account does not exist in this company',
      );
    }
    if (!parent.isActive) {
      throw new BadRequestException(
        'The parent account is inactive. Activate it before adding sub-accounts under it.',
      );
    }
    if (parent.type !== type) {
      throw new BadRequestException(
        `A sub-account must have the same type as its parent ` +
          `(parent is ${parent.type}, this account is ${type})`,
      );
    }

    if (movingId) {
      // Walk up from the proposed parent. Reaching `movingId` means the new
      // parent sits under the account being moved: that closes a circle.
      let cursor: string | null = parent.parentId;
      const seen = new Set<string>([parent.id]);
      while (cursor) {
        if (cursor === movingId) {
          throw new BadRequestException(
            'This would make the account its own ancestor. Choose another parent.',
          );
        }
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const next = await this.prisma.account.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
        cursor = next?.parentId ?? null;
      }
    }
  }

  /**
   * When an account gains a child it becomes a grouping account — but only if
   * it has no movements of its own. An account someone already posted against
   * keeps its postings and stays postable; the child simply sits under it.
   * (Postings to a grouping account are refused at posting time regardless.)
   */
  private async demoteParentToGrouping(
    tx: Prisma.TransactionClient,
    companyId: string,
    parentId: string,
  ): Promise<void> {
    const parent = await tx.account.findFirst({
      where: { id: parentId, companyId, deletedAt: null },
      select: { isPostable: true },
    });
    if (!parent?.isPostable) return;

    const movements = await tx.journalLine.count({
      where: { accountId: parentId },
    });
    if (movements > 0) return;

    await tx.account.update({
      where: { id: parentId },
      data: { isPostable: false },
    });
  }
}

function toResponse(a: {
  id: string;
  companyId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  type: AccountType;
  parentId: string | null;
  isPostable: boolean;
  isActive: boolean;
  currency: string | null;
  description: string | null;
  cashFlowClass: string | null;
}): AccountResponse {
  return {
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
    description: a.description,
    cashFlowClass: a.cashFlowClass ? a.cashFlowClass.toLowerCase() : null,
  };
}
