import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const BUDGETABLE_TYPES = new Set<AccountType>([
  AccountType.REVENUE,
  AccountType.EXPENSE,
]);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;

type BudgetWithRelations = Prisma.BudgetGetPayload<{
  include: {
    costCenter: {
      select: {
        id: true;
        code: true;
        nameEn: true;
        nameAr: true;
        type: true;
        isActive: true;
      };
    };
    account: {
      select: {
        id: true;
        code: true;
        nameEn: true;
        nameAr: true;
        type: true;
        isPostable: true;
      };
    };
  };
}>;

/// Budgets: a plan per cost centre, account and period, compared with what the
/// posted ledger actually contains.
///
/// Deliberate limits, all visible in the answer rather than hidden:
///
///  * the account must be revenue or expense — a balance-sheet account has no
///    "spend" to compare;
///  * one currency: the company's own. There is no FX conversion, so a budget
///    can never quietly mix two currencies;
///  * actuals come from journal entries in `POSTED` or `REVERSED` (the pair
///    nets to zero when an entry is reversed), split by the same
///    `COALESCE(allocation, line)` rule as the cost-center report;
///  * nothing is prorated: a row compares a budget with the ledger over that
///    budget's own period, and the period is returned with every row.
@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    companyId: string,
    query: {
      includeInactive?: boolean;
      costCenterId?: string;
      accountId?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const where: Prisma.BudgetWhereInput = { companyId };
    if (!query.includeInactive) {
      where.deletedAt = null;
      where.isActive = true;
    }
    if (query.costCenterId) where.costCenterId = query.costCenterId;
    if (query.accountId) where.accountId = query.accountId;
    if (query.from) where.periodEnd = { gte: this.date(query.from, 'from') };
    if (query.to) where.periodStart = { lte: this.date(query.to, 'to') };

    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 500);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.budget.findMany({
        where,
        include: this.relations,
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.budget.count({ where }),
    ]);

    return {
      items: items.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
    };
  }

  async findOne(companyId: string, id: string) {
    // A retired budget is still readable: the comparison it took part in must
    // remain explainable after it leaves the list.
    const budget = await this.prisma.budget.findFirst({
      where: { id, companyId },
      include: this.relations,
    });
    if (!budget) throw new NotFoundException('Budget not found');
    return this.toResponse(budget);
  }

  async create(companyId: string, userId: string, dto: Record<string, unknown>) {
    const company = await this.company(companyId);
    const costCenterId = await this.costCenter(
      companyId,
      dto.costCenterId,
      true,
    );
    const accountId = await this.account(companyId, dto.accountId);
    const periodStart = this.date(dto.periodStart, 'periodStart');
    const periodEnd = this.date(dto.periodEnd, 'periodEnd');
    if (periodEnd < periodStart) {
      throw new BadRequestException('periodEnd must not be before periodStart');
    }
    const amount = this.money(dto.amount);
    const currency = this.currency(dto.currency, company.currency);

    await this.assertUnique(companyId, {
      costCenterId,
      accountId,
      periodStart,
      periodEnd,
    });

    const created = await this.prisma.budget.create({
      data: {
        companyId,
        costCenterId,
        accountId,
        periodStart,
        periodEnd,
        amount,
        currency,
        notes: this.optionalText(dto.notes),
        isActive: dto.isActive === undefined ? true : Boolean(dto.isActive),
        createdBy: userId,
        updatedBy: userId,
      },
      include: this.relations,
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'budgets',
      entityId: created.id,
      after: this.toResponse(created),
    });

    return this.toResponse(created);
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: Record<string, unknown>,
  ) {
    const before = await this.prisma.budget.findFirst({
      where: { id, companyId, deletedAt: null },
      include: this.relations,
    });
    if (!before) throw new NotFoundException('Budget not found');
    if (before.deletedAt) {
      throw new BadRequestException('A retired budget cannot be edited');
    }
    const company = await this.company(companyId);

    const data: Prisma.BudgetUncheckedUpdateInput = { updatedBy: userId };
    let costCenterId = before.costCenterId;
    let accountId = before.accountId;
    let periodStart = before.periodStart;
    let periodEnd = before.periodEnd;
    let keyChanged = false;

    if (dto.costCenterId !== undefined) {
      const next = await this.costCenter(
        companyId,
        dto.costCenterId,
        // Keeping a budget on a centre that has since been deactivated is not
        // a new assignment; it stays valid. Moving it to another inactive
        // centre is refused.
        String(dto.costCenterId) !== before.costCenterId,
      );
      keyChanged = keyChanged || next !== costCenterId;
      costCenterId = next;
      data.costCenterId = next;
    }
    if (dto.accountId !== undefined) {
      const next = await this.account(companyId, dto.accountId);
      keyChanged = keyChanged || next !== accountId;
      accountId = next;
      data.accountId = next;
    }
    if (dto.periodStart !== undefined) {
      const next = this.date(dto.periodStart, 'periodStart');
      keyChanged = keyChanged || next.getTime() !== periodStart.getTime();
      periodStart = next;
      data.periodStart = next;
    }
    if (dto.periodEnd !== undefined) {
      const next = this.date(dto.periodEnd, 'periodEnd');
      keyChanged = keyChanged || next.getTime() !== periodEnd.getTime();
      periodEnd = next;
      data.periodEnd = next;
    }
    if (periodEnd < periodStart) {
      throw new BadRequestException('periodEnd must not be before periodStart');
    }
    if (dto.amount !== undefined) data.amount = this.money(dto.amount);
    if (dto.currency !== undefined) {
      data.currency = this.currency(dto.currency, company.currency);
    }
    if (dto.notes !== undefined) data.notes = this.optionalText(dto.notes);
    if (dto.isActive !== undefined) data.isActive = Boolean(dto.isActive);

    if (keyChanged) {
      await this.assertUnique(
        companyId,
        { costCenterId, accountId, periodStart, periodEnd },
        id,
      );
    }

    let updated: BudgetWithRelations;
    try {
      updated = await this.prisma.budget.update({
        where: { id },
        data,
        include: this.relations,
      });
    } catch (error) {
      throw this.translateDuplicate(error);
    }

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'budgets',
      entityId: id,
      before: this.toResponse(before),
      after: this.toResponse(updated),
    });

    return this.toResponse(updated);
  }

  /// A budget is retired, never deleted: the comparison it took part in stays
  /// reproducible. Retiring twice is a no-op rather than an error, so a
  /// double-click cannot fail the screen.
  async retire(companyId: string, userId: string, id: string) {
    const before = await this.prisma.budget.findFirst({
      where: { id, companyId },
      include: this.relations,
    });
    if (!before) throw new NotFoundException('Budget not found');
    // Retiring twice is a no-op, so a double click cannot fail the screen.
    if (before.deletedAt) return this.toResponse(before);

    const updated = await this.prisma.budget.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date(), updatedBy: userId },
      include: this.relations,
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'DELETE',
      entity: 'budgets',
      entityId: id,
      before: this.toResponse(before),
      after: this.toResponse(updated),
    });

    return this.toResponse(updated);
  }

  /**
   * Budget against actual.
   *
   * `from`/`to` choose which budgets are listed (any period overlapping the
   * window); every row's actual is read over that row's own period. The answer
   * carries the periods, so a reader can see exactly what was compared.
   */
  async report(
    companyId: string,
    query: {
      from?: string;
      to?: string;
      type?: string;
      costCenterId?: string;
      accountId?: string;
      includeInactive?: string | boolean;
      asOf?: string;
    } = {},
  ) {
    const includeInactive =
      query.includeInactive === true || query.includeInactive === 'true';
    const from = query.from
      ? this.date(query.from, 'from')
      : new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const to = query.to
      ? this.date(query.to, 'to')
      : new Date(Date.UTC(new Date().getUTCFullYear(), 11, 31));
    if (to < from) {
      throw new BadRequestException('to must not be before from');
    }

    const type = query.type ? String(query.type).toUpperCase() : null;
    if (
      type &&
      !['DEPARTMENT', 'ADMINISTRATIVE_UNIT', 'PROJECT'].includes(type)
    ) {
      throw new BadRequestException(
        'type must be DEPARTMENT, ADMINISTRATIVE_UNIT or PROJECT',
      );
    }

    const budgets = await this.prisma.budget.findMany({
      where: {
        companyId,
        ...(includeInactive ? {} : { deletedAt: null, isActive: true }),
        ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
        ...(query.accountId ? { accountId: query.accountId } : {}),
        ...(type ? { costCenter: { type: type as never } } : {}),
        periodStart: { lte: to },
        periodEnd: { gte: from },
      },
      include: this.relations,
      orderBy: [{ periodStart: 'desc' }, { costCenterId: 'asc' }],
    });

    if (budgets.length === 0) {
      return {
        currency: (await this.company(companyId)).currency,
        from: this.day(from),
        to: this.day(to),
        rows: [],
        totals: this.emptyTotals(),
        basis:
          'Each row compares its budget with posted ledger lines attributed to the same cost centre and account inside the budget own period.',
      };
    }

    const actuals = await this.prisma.$queryRaw<
      Array<{ budgetId: string; actual: Prisma.Decimal }>
    >(Prisma.sql`
      WITH attributed AS (
        SELECT l."accountId"   AS account_id,
               al."costCenterId" AS cost_center_id,
               e."entryDate"   AS entry_date,
               CASE
                 WHEN a.type = 'EXPENSE'
                   THEN CASE WHEN l.debit > 0 THEN al.amount ELSE -al.amount END
                 ELSE CASE WHEN l.credit > 0 THEN al.amount ELSE -al.amount END
               END             AS amount
          FROM journal_line_allocations al
          JOIN journal_lines l ON l.id = al."journalLineId"
          JOIN journal_entries e ON e.id = l."journalEntryId"
          JOIN accounts a ON a.id = l."accountId"
         WHERE e."companyId" = ${companyId}::uuid
           AND e.status IN ('POSTED', 'REVERSED')

        UNION ALL

        SELECT l."accountId",
               l."costCenterId",
               e."entryDate",
               CASE
                 WHEN a.type = 'EXPENSE' THEN (l.debit - l.credit)
                 ELSE (l.credit - l.debit)
               END
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l."journalEntryId"
          JOIN accounts a ON a.id = l."accountId"
         WHERE e."companyId" = ${companyId}::uuid
           AND e.status IN ('POSTED', 'REVERSED')
           AND l."costCenterId" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM journal_line_allocations al
              WHERE al."journalLineId" = l.id
           )
      )
      SELECT b.id AS "budgetId",
             COALESCE(SUM(t.amount), 0) AS actual
        FROM budgets b
        LEFT JOIN attributed t
          ON t.account_id = b."accountId"
         AND t.cost_center_id = b."costCenterId"
         AND t.entry_date >= b."periodStart"
         AND t.entry_date <= b."periodEnd"
       WHERE b.id::text IN (${Prisma.join(budgets.map((row) => row.id))})
       GROUP BY b.id
    `);

    const actualByBudget = new Map(
      actuals.map((row) => [row.budgetId, new Prisma.Decimal(row.actual)]),
    );

    const rows = budgets.map((budget) => {
      const actual = actualByBudget.get(budget.id) ?? new Prisma.Decimal(0);
      const planned = new Prisma.Decimal(budget.amount);
      const variance = actual.minus(planned);
      const variancePercent = planned.isZero()
        ? null
        : variance
            .div(planned)
            .mul(100)
            .toDecimalPlaces(2)
            .toFixed(2);
      const isRevenue = budget.account.type === AccountType.REVENUE;
      return {
        budgetId: budget.id,
        costCenterId: budget.costCenterId,
        costCenterCode: budget.costCenter.code,
        costCenterNameEn: budget.costCenter.nameEn,
        costCenterNameAr: budget.costCenter.nameAr,
        costCenterType: budget.costCenter.type,
        costCenterActive: budget.costCenter.isActive,
        accountId: budget.accountId,
        accountCode: budget.account.code,
        accountNameEn: budget.account.nameEn,
        accountNameAr: budget.account.nameAr,
        accountType: budget.account.type,
        periodStart: this.day(budget.periodStart),
        periodEnd: this.day(budget.periodEnd),
        currency: budget.currency,
        budget: planned.toFixed(4),
        actual: actual.toFixed(4),
        variance: variance.toFixed(4),
        variancePercent,
        // Spending less than planned is favourable; earning more is.
        favorable: isRevenue ? variance.greaterThanOrEqualTo(0) : variance.lessThanOrEqualTo(0),
        isActive: budget.isActive,
        retired: budget.deletedAt !== null,
        notes: budget.notes,
      };
    });

    return {
      currency: (await this.company(companyId)).currency,
      from: this.day(from),
      to: this.day(to),
      rows,
      totals: this.totals(rows),
      basis:
        'Each row compares its budget with posted ledger lines attributed to the same cost centre and account inside the budget own period. Nothing is prorated or converted between currencies.',
    };
  }

  // -------------------------------------------------------------- internals

  private get relations() {
    return {
      costCenter: {
        select: {
          id: true,
          code: true,
          nameEn: true,
          nameAr: true,
          type: true,
          isActive: true,
        },
      },
      account: {
        select: {
          id: true,
          code: true,
          nameEn: true,
          nameAr: true,
          type: true,
          isPostable: true,
        },
      },
    } as const;
  }

  private async company(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { currency: true },
    });
    if (!company) throw new BadRequestException('The company does not exist');
    return company;
  }

  private async costCenter(
    companyId: string,
    value: unknown,
    requireActive: boolean,
  ): Promise<string> {
    const id = String(value ?? '').trim();
    if (!id) throw new BadRequestException('costCenterId is required');
    const center = await this.prisma.costCenter.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, code: true, isActive: true },
    });
    if (!center) {
      throw new BadRequestException(
        'costCenterId does not name a cost center of this company',
      );
    }
    if (requireActive && !center.isActive) {
      throw new BadRequestException(
        `Cost center ${center.code} is inactive and cannot receive a new budget`,
      );
    }
    return center.id;
  }

  private async account(companyId: string, value: unknown): Promise<string> {
    const id = String(value ?? '').trim();
    if (!id) throw new BadRequestException('accountId is required');
    const account = await this.prisma.account.findFirst({
      where: { id, companyId, deletedAt: null },
      select: {
        id: true,
        code: true,
        type: true,
        isPostable: true,
      },
    });
    if (!account) {
      throw new BadRequestException(
        'accountId does not name an account of this company',
      );
    }
    if (!account.isPostable) {
      throw new BadRequestException(
        `Account ${account.code} is a heading account, not one that can be posted to`,
      );
    }
    if (!BUDGETABLE_TYPES.has(account.type)) {
      throw new BadRequestException(
        `Account ${account.code} is a ${account.type.toLowerCase()} account. ` +
          'A budget must name a revenue or an expense account.',
      );
    }
    return account.id;
  }

  private async assertUnique(
    companyId: string,
    key: {
      costCenterId: string;
      accountId: string;
      periodStart: Date;
      periodEnd: Date;
    },
    exceptId?: string,
  ) {
    const duplicate = await this.prisma.budget.findFirst({
      where: {
        companyId,
        deletedAt: null,
        costCenterId: key.costCenterId,
        accountId: key.accountId,
        periodStart: key.periodStart,
        periodEnd: key.periodEnd,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'A budget for this cost center, account and period already exists',
      );
    }
  }

  private translateDuplicate(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException(
        'A budget for this cost center, account and period already exists',
      );
    }
    return error;
  }

  private money(value: unknown): Prisma.Decimal {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException('amount is required');
    if (!MONEY_PATTERN.test(text)) {
      throw new BadRequestException(
        'amount must be a positive number with at most four decimal places',
      );
    }
    const amount = new Prisma.Decimal(text);
    if (amount.isNegative()) {
      throw new BadRequestException('amount cannot be negative');
    }
    return amount;
  }

  private currency(value: unknown, companyCurrency: string): string {
    const currency = String(value ?? companyCurrency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException('currency must be a three-letter code');
    }
    if (currency !== companyCurrency.toUpperCase()) {
      throw new BadRequestException(
        `A budget is kept in the company currency (${companyCurrency}); ` +
          'this program has no exchange-rate conversion.',
      );
    }
    return currency;
  }

  private date(value: unknown, field: string): Date {
    const text = String(value ?? '').trim();
    if (!DATE_PATTERN.test(text)) {
      throw new BadRequestException(`${field} must be a date (YYYY-MM-DD)`);
    }
    const parsed = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || this.day(parsed) !== text) {
      throw new BadRequestException(`${field} is not a real date`);
    }
    return parsed;
  }

  private optionalText(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (text.length > 500) {
      throw new BadRequestException('notes cannot exceed 500 characters');
    }
    return text;
  }

  private day(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private toResponse(row: BudgetWithRelations) {
    return {
      id: row.id,
      companyId: row.companyId,
      costCenterId: row.costCenterId,
      costCenter: row.costCenter,
      accountId: row.accountId,
      account: row.account,
      periodStart: this.day(row.periodStart),
      periodEnd: this.day(row.periodEnd),
      amount: row.amount.toFixed(4),
      currency: row.currency,
      notes: row.notes,
      isActive: row.isActive,
      retired: row.deletedAt !== null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private emptyTotals() {
    const zero = {
      budget: '0.0000',
      actual: '0.0000',
      variance: '0.0000',
      variancePercent: null as string | null,
    };
    return { expense: { ...zero }, revenue: { ...zero } };
  }

  private totals(
    rows: Array<{
      accountType: string;
      budget: string;
      actual: string;
      variance: string;
    }>,
  ) {
    const build = (type: AccountType) => {
      const selected = rows.filter((row) => row.accountType === type);
      const budget = selected.reduce(
        (sum, row) => sum.plus(new Prisma.Decimal(row.budget)),
        new Prisma.Decimal(0),
      );
      const actual = selected.reduce(
        (sum, row) => sum.plus(new Prisma.Decimal(row.actual)),
        new Prisma.Decimal(0),
      );
      const variance = actual.minus(budget);
      return {
        budget: budget.toFixed(4),
        actual: actual.toFixed(4),
        variance: variance.toFixed(4),
        variancePercent: budget.isZero()
          ? null
          : variance
              .div(budget)
              .mul(100)
              .toDecimalPlaces(2)
              .toFixed(2),
      };
    };
    return {
      expense: build(AccountType.EXPENSE),
      revenue: build(AccountType.REVENUE),
    };
  }
}
