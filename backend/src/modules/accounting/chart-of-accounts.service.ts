import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Account as PrismaAccount, AccountType, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { CreateExpenseAccountDto, UpdateExpenseAccountDto } from './dto/expense-account.dto';
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
  description: string | null;
}

@Injectable()
export class ChartOfAccountsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async createExpenseAccount(companyId: string, userId: string, dto: CreateExpenseAccountDto) {
    await this.validateParent(companyId, dto.parentId ?? null);
    const code = dto.code.trim();
    const duplicate = await this.prisma.account.findFirst({ where: { companyId, code } });
    if (duplicate) throw new ConflictException('Account code already exists in this company');
    let account: PrismaAccount;
    try {
      account = await this.prisma.account.create({ data: {
        companyId,
        code,
        nameEn: dto.nameEn.trim(),
        nameAr: dto.nameAr.trim(),
        type: AccountType.EXPENSE,
        parentId: dto.parentId ?? null,
        description: dto.description?.trim() || null,
        isPostable: dto.isPostable ?? true,
        createdBy: userId,
      } });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictException('Account code already exists in this company');
      throw error;
    }
    await this.audit.record({ companyId, userId, action: 'CREATE', entity: 'accounts', entityId: account.id, after: account });
    return this.toResponse(account);
  }

  async updateExpenseAccount(companyId: string, userId: string, id: string, dto: UpdateExpenseAccountDto) {
    const before = await this.prisma.account.findFirst({ where: { id, companyId, type: AccountType.EXPENSE, deletedAt: null } });
    if (!before) throw new NotFoundException('Expense account not found');
    if (dto.parentId !== undefined) {
      if (dto.parentId === id) throw new BadRequestException('An account cannot be its own parent');
      await this.validateParent(companyId, dto.parentId);
      let ancestorId = dto.parentId;
      const visited = new Set<string>();
      while (ancestorId) {
        if (ancestorId === id) throw new BadRequestException('Account hierarchy cannot contain a cycle');
        if (visited.has(ancestorId)) throw new BadRequestException('Existing account hierarchy contains a cycle');
        visited.add(ancestorId);
        const ancestor = await this.prisma.account.findFirst({ where: { id: ancestorId, companyId }, select: { parentId: true } });
        ancestorId = ancestor?.parentId ?? null;
      }
    }
    if (dto.isPostable === true && !before.isPostable) {
      const [children, lines] = await Promise.all([
        this.prisma.account.count({ where: { parentId: id, deletedAt: null } }),
        this.prisma.journalLine.count({ where: { accountId: id } }),
      ]);
      if (children) throw new BadRequestException('An account with subaccounts must remain a grouping account');
      if (lines) throw new BadRequestException('An account with ledger history cannot become postable');
    }
    if (dto.isPostable === false && before.isPostable) {
      const lines = await this.prisma.journalLine.count({ where: { accountId: id } });
      if (lines) throw new BadRequestException('An account with ledger history cannot become a grouping account');
    }
    const data: Prisma.AccountUncheckedUpdateInput = {
      ...(dto.code !== undefined ? { code: dto.code.trim() } : {}),
      ...(dto.nameEn !== undefined ? { nameEn: dto.nameEn.trim() } : {}),
      ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr.trim() } : {}),
      ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
      ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
      ...(dto.isPostable !== undefined ? { isPostable: dto.isPostable } : {}),
      updatedBy: userId,
    };
    try {
      const account = await this.prisma.account.update({ where: { id }, data });
      await this.audit.record({ companyId, userId, action: 'UPDATE', entity: 'accounts', entityId: id, before, after: account });
      return this.toResponse(account);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictException('Account code already exists in this company');
      throw error;
    }
  }

  async setExpenseAccountActive(companyId: string, userId: string, id: string, isActive: boolean) {
    const before = await this.prisma.account.findFirst({ where: { id, companyId, type: AccountType.EXPENSE, deletedAt: null } });
    if (!before) throw new NotFoundException('Expense account not found');
    if (isActive && before.parentId) {
      await this.validateParent(companyId, before.parentId);
    }
    if (!isActive) {
      const activeAccounts = await this.prisma.account.findMany({ where: { companyId, type: AccountType.EXPENSE, deletedAt: null, isActive: true }, select: { id: true, parentId: true } });
      const descendants = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of activeAccounts) {
          if (candidate.parentId && descendants.has(candidate.parentId) && !descendants.has(candidate.id)) {
            descendants.add(candidate.id);
            changed = true;
          }
        }
      }
      if ([...descendants].some((childId) => childId !== id)) {
        throw new BadRequestException('Deactivate active subaccounts before deactivating their parent');
      }
    }
    const account = await this.prisma.account.update({ where: { id }, data: { isActive, updatedBy: userId } });
    await this.audit.record({ companyId, userId, action: isActive ? 'ACTIVATE' : 'DEACTIVATE', entity: 'accounts', entityId: id, before: { isActive: before.isActive }, after: { isActive } });
    return this.toResponse(account);
  }

  private async validateParent(companyId: string, parentId: string | null) {
    if (!parentId) return;
    const parent = await this.prisma.account.findFirst({ where: { id: parentId, companyId, deletedAt: null } });
    if (!parent) throw new BadRequestException('Parent account does not exist in this company');
    if (parent.type !== AccountType.EXPENSE || parent.isPostable || !parent.isActive) {
      throw new BadRequestException('Expense subaccounts require an active, non-postable expense parent');
    }
  }

  private toResponse(a: { id: string; companyId: string; code: string; nameEn: string; nameAr: string; type: AccountType; parentId: string | null; isPostable: boolean; isActive: boolean; currency: string | null; description: string | null }) {
    return { ...a, name: a.nameEn, type: a.type.toLowerCase() };
  }

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
        description: a.description,
      })),
    };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
