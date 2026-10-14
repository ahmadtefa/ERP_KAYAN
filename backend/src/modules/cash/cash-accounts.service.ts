import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CashAccountKind, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const MONEY_SCALE = 4;

/**
 * Cash boxes and bank accounts.
 *
 * A box is not a name in a list: it is a name bound to a general ledger
 * account, which is what makes "how much is in the safe?" a question with one
 * answer. A voucher that names a box posts to that account and nowhere else.
 */
@Injectable()
export class CashAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    companyId: string,
    query: { kind?: string; includeInactive?: boolean; branchId?: string } = {},
  ) {
    const where: Prisma.CashAccountWhereInput = { companyId, deletedAt: null };
    if (!query.includeInactive) where.isActive = true;
    if (query.branchId) where.branchId = query.branchId;
    if (query.kind) {
      const kind = query.kind.toUpperCase();
      if (!Object.values(CashAccountKind).includes(kind as CashAccountKind)) {
        throw new BadRequestException(`Unknown kind: ${query.kind}`);
      }
      where.kind = kind as CashAccountKind;
    }

    const items = await this.prisma.cashAccount.findMany({
      where,
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
      include: {
        account: { select: { code: true, nameEn: true, nameAr: true } },
        branch: { select: { code: true } },
      },
    });

    return { items: items.map((row) => this.toResponse(row)), total: items.length };
  }

  async findOne(companyId: string, id: string) {
    const row = await this.prisma.cashAccount.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        account: { select: { code: true, nameEn: true, nameAr: true } },
        branch: { select: { code: true } },
      },
    });
    if (!row) throw new NotFoundException('Cash account not found');
    return this.toResponse(row);
  }

  async create(companyId: string, userId: string, dto: Record<string, unknown>) {
    const code = this.text(dto.code, 'code');
    const nameEn = this.text(dto.nameEn, 'nameEn');
    const nameAr = this.text(dto.nameAr, 'nameAr');
    const accountId = this.text(dto.accountId, 'accountId');
    const kind = String(dto.kind ?? 'CASH').toUpperCase() as CashAccountKind;
    if (!Object.values(CashAccountKind).includes(kind)) {
      throw new BadRequestException('kind must be CASH or BANK');
    }

    const existing = await this.prisma.cashAccount.findFirst({
      where: { companyId, code },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Cash account code ${code} is already used`);
    }

    // The ledger account must be able to carry money, must belong to this
    // company, and must not already be claimed by another box - two boxes
    // sharing one account would make their balances meaningless.
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, companyId, deletedAt: null },
      select: { id: true, code: true, isPostable: true, isActive: true },
    });
    if (!account) throw new BadRequestException('The ledger account does not exist');
    if (!account.isPostable) {
      throw new BadRequestException(
        `Account ${account.code} is a grouping account and cannot be a cash or bank account`,
      );
    }
    if (!account.isActive) throw new BadRequestException(`Account ${account.code} is inactive`);

    const taken = await this.prisma.cashAccount.findFirst({
      where: { companyId, accountId, deletedAt: null },
      select: { code: true },
    });
    if (taken) {
      throw new ConflictException(
        `Account ${account.code} already belongs to cash account ${taken.code}`,
      );
    }

    const created = await this.prisma.cashAccount.create({
      data: {
        companyId,
        branchId: (dto.branchId as string) ?? null,
        code,
        nameEn,
        nameAr,
        kind,
        currency: String(dto.currency ?? 'EGP').slice(0, 3).toUpperCase(),
        accountId,
        bankName: (dto.bankName as string) ?? null,
        bankAccountNumber: (dto.bankAccountNumber as string) ?? null,
        iban: (dto.iban as string) ?? null,
        swiftCode: (dto.swiftCode as string) ?? null,
        notes: (dto.notes as string) ?? null,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'cash_accounts',
      entityId: created.id,
      after: { code, nameEn, kind, accountCode: account.code },
    });

    return this.findOne(companyId, created.id);
  }

  async update(companyId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const before = await this.prisma.cashAccount.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Cash account not found');

    const data: Record<string, unknown> = { updatedBy: userId };
    for (const field of ['nameEn', 'nameAr', 'bankName', 'bankAccountNumber', 'iban', 'swiftCode', 'notes']) {
      if (dto[field] !== undefined) data[field] = (dto[field] as string) ?? null;
    }
    if (dto.isActive !== undefined) data.isActive = Boolean(dto.isActive);
    if (dto.accountId !== undefined && dto.accountId !== before.accountId) {
      // Changing the account of a box that already has movements would move
      // every historical figure to a different account. Refused, with the
      // reason stated.
      const movements = await this.prisma.cashVoucher.count({
        where: { cashAccountId: id, status: { in: ['POSTED', 'REVERSED'] } },
      });
      if (movements > 0) {
        throw new BadRequestException(
          'This cash account already has posted movements, so its ledger account cannot be changed. Create a new cash account instead.',
        );
      }
      data.account = { connect: { id: String(dto.accountId) } };
    }

    const updated = await this.prisma.cashAccount.update({
      where: { id },
      data: data as Prisma.CashAccountUpdateInput,
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'cash_accounts',
      entityId: id,
      before: { nameEn: before.nameEn, isActive: before.isActive },
      after: { nameEn: updated.nameEn, isActive: updated.isActive },
    });

    return this.findOne(companyId, id);
  }

  /** Deactivates. A box with movements is never deleted. */
  async deactivate(companyId: string, userId: string, id: string) {
    const row = await this.prisma.cashAccount.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Cash account not found');

    const updated = await this.prisma.cashAccount.update({
      where: { id },
      data: { isActive: false, updatedBy: userId },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'DEACTIVATE',
      entity: 'cash_accounts',
      entityId: id,
    });

    return this.toResponse(updated);
  }

  /** What each box or bank holds, read from the ledger. */
  async balances(companyId: string, asOf?: string) {
    const date = asOf ? new Date(`${asOf.slice(0, 10)}T23:59:59.999Z`) : new Date();

    const accounts = await this.prisma.cashAccount.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
      include: { account: { select: { code: true, nameEn: true, nameAr: true } } },
    });

    const balances = await this.prisma.$queryRaw<
      Array<{ accountId: string; net: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT l."accountId" AS "accountId",
             COALESCE(SUM(l.debit - l.credit), 0) AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" <= ${date}::date
       GROUP BY l."accountId"
    `);
    const byAccount = new Map(balances.map((row) => [row.accountId, new Prisma.Decimal(row.net)]));

    return {
      asOf: date.toISOString().slice(0, 10),
      rows: accounts.map((row) => ({
        cashAccountId: row.id,
        code: row.code,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        kind: row.kind.toLowerCase(),
        currency: row.currency,
        ledgerAccountCode: row.account.code,
        balance: (byAccount.get(row.accountId) ?? new Prisma.Decimal(0)).toFixed(MONEY_SCALE),
      })),
    };
  }

  /** Everything that moved through one box or bank, with a running balance. */
  async statement(
    companyId: string,
    id: string,
    query: { from?: string; to?: string },
  ) {
    const cashAccount = await this.prisma.cashAccount.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { account: { select: { code: true, nameEn: true, nameAr: true } } },
    });
    if (!cashAccount) throw new NotFoundException('Cash account not found');

    const to = query.to ? new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`) : new Date();
    const from = query.from
      ? new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`)
      : new Date(Date.UTC(to.getUTCFullYear(), 0, 1));

    const openingRows = await this.prisma.$queryRaw<Array<{ net: Prisma.Decimal }>>(Prisma.sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND l."accountId" = ${cashAccount.accountId}::uuid
         AND e."entryDate" < ${from}::date
    `);
    const opening = new Prisma.Decimal(openingRows[0]?.net ?? 0);

    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountId: cashAccount.accountId,
        entry: {
          companyId,
          status: { in: ['POSTED', 'REVERSED'] },
          entryDate: { gte: from, lte: to },
        },
      },
      include: {
        entry: {
          select: {
            id: true,
            entryNumber: true,
            entryDate: true,
            description: true,
            status: true,
          },
        },
      },
      orderBy: [{ entry: { entryDate: 'asc' } }, { entry: { entryNumber: 'asc' } }],
    });

    let running = opening;
    const movements = lines.map((line) => {
      running = running.plus(line.debit).minus(line.credit);
      return {
        entryId: line.entry.id,
        entryNumber: line.entry.entryNumber,
        entryDate: line.entry.entryDate.toISOString().slice(0, 10),
        description: line.description ?? line.entry.description,
        debit: line.debit.toFixed(MONEY_SCALE),
        credit: line.credit.toFixed(MONEY_SCALE),
        runningBalance: running.toFixed(MONEY_SCALE),
      };
    });

    return {
      cashAccount: this.toResponse(cashAccount),
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      opening: opening.toFixed(MONEY_SCALE),
      movements,
      closing: running.toFixed(MONEY_SCALE),
    };
  }

  private text(value: unknown, field: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException(`${field} is required`);
    return text;
  }

  private toResponse(row: {
    id: string;
    companyId: string;
    branchId: string | null;
    code: string;
    nameEn: string;
    nameAr: string;
    kind: CashAccountKind;
    currency: string;
    accountId: string;
    bankName: string | null;
    bankAccountNumber: string | null;
    iban: string | null;
    swiftCode: string | null;
    notes: string | null;
    isActive: boolean;
    account?: { code: string; nameEn: string; nameAr: string };
    branch?: { code: string } | null;
  }) {
    return {
      id: row.id,
      companyId: row.companyId,
      branchId: row.branchId,
      branchCode: row.branch?.code ?? null,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      kind: row.kind.toLowerCase(),
      currency: row.currency,
      accountId: row.accountId,
      ledgerAccountCode: row.account?.code ?? null,
      ledgerAccountNameEn: row.account?.nameEn ?? null,
      ledgerAccountNameAr: row.account?.nameAr ?? null,
      bankName: row.bankName,
      bankAccountNumber: row.bankAccountNumber,
      iban: row.iban,
      swiftCode: row.swiftCode,
      notes: row.notes,
      isActive: row.isActive,
    };
  }
}
