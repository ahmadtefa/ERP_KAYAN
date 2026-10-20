import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BudgetsService } from './budgets.service';

const center = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'PRJ-1',
  nameEn: 'Project one',
  nameAr: 'مشروع واحد',
  type: 'PROJECT',
  isActive: true,
};

const expenseAccount = {
  id: '22222222-2222-4222-8222-222222222222',
  code: '5101',
  nameEn: 'Cost of sales',
  nameAr: 'تكلفة المبيعات',
  type: 'EXPENSE',
  isPostable: true,
};

const assetAccount = {
  id: '33333333-3333-4333-8333-333333333333',
  code: '1104',
  nameEn: 'Inventory',
  nameAr: 'المخزون',
  type: 'ASSET',
  isPostable: true,
};

function stored(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    companyId: '55555555-5555-4555-8555-555555555555',
    costCenterId: center.id,
    accountId: expenseAccount.id,
    periodStart: new Date('2026-01-01T00:00:00.000Z'),
    periodEnd: new Date('2026-12-31T00:00:00.000Z'),
    amount: new Prisma.Decimal('1000.0000'),
    currency: 'EGP',
    notes: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    costCenter: center,
    account: expenseAccount,
    ...overrides,
  };
}

function build(options: { existing?: ReturnType<typeof stored> | null } = {}) {
  let row = options.existing === undefined ? null : options.existing;
  const prisma = {
    company: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ currency: 'EGP' }),
    },
    costCenter: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === center.id || where.id === 'inactive'
          ? { ...center, id: where.id, isActive: where.id !== 'inactive' }
          : null,
      ),
    },
    account: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id === expenseAccount.id) return expenseAccount;
        if (where.id === assetAccount.id) return assetAccount;
        return null;
      }),
    },
    budget: {
      findFirst: jest.fn(async () => row),
      findMany: jest.fn(async () => (row ? [row] : [])),
      create: jest.fn(async ({ data }: any) => {
        row = stored({ ...data, costCenter: center, account: expenseAccount });
        return row;
      }),
      update: jest.fn(async ({ data }: any) => {
        row = { ...(row as ReturnType<typeof stored>), ...data };
        return row;
      }),
    },
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    ),
    $queryRaw: jest.fn().mockResolvedValue([
      { budgetId: '44444444-4444-4444-8444-444444444444', actual: new Prisma.Decimal('1200.0000') },
    ]),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new BudgetsService(prisma as any, audit as any);
  return { service, prisma, audit, get row() { return row; } };
}

const base = {
  costCenterId: center.id,
  accountId: expenseAccount.id,
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  amount: '1000.00',
};

describe('BudgetsService', () => {
  it('creates a budget for a revenue or expense account', async () => {
    const { service, audit } = build({ existing: null });

    const created = await service.create('company', 'user', base);

    expect(created.amount).toBe('1000.0000');
    expect(created.costCenter?.code).toBe('PRJ-1');
    expect(created.account?.type).toBe('EXPENSE');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'budgets', action: 'CREATE' }),
    );
  });

  it('refuses a balance-sheet account: a budget compares spending, not balances', async () => {
    const { service } = build({ existing: null });

    await expect(
      service.create('company', 'user', { ...base, accountId: assetAccount.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an inactive cost center', async () => {
    const { service } = build({ existing: null });

    await expect(
      service.create('company', 'user', { ...base, costCenterId: 'inactive' }),
    ).rejects.toThrow(/inactive/i);
  });

  it('refuses a second budget for the same centre, account and period', async () => {
    const { service } = build({ existing: stored() });

    await expect(service.create('company', 'user', base)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('keeps a budget in the company currency: no exchange-rate arithmetic', async () => {
    const { service } = build({ existing: null });

    await expect(
      service.create('company', 'user', { ...base, currency: 'USD' }),
    ).rejects.toThrow(/company currency/i);
  });

  it('refuses a period that ends before it starts', async () => {
    const { service } = build({ existing: null });

    await expect(
      service.create('company', 'user', {
        ...base,
        periodStart: '2026-12-31',
        periodEnd: '2026-01-01',
      }),
    ).rejects.toThrow(/periodEnd/);
  });

  it('edits an existing definition but refuses to move it onto an inactive centre', async () => {
    const { service } = build({ existing: stored() });

    const updated = await service.update('company', 'user', stored().id, {
      amount: '1500',
    });
    expect(updated.amount).toBe('1500.0000');

    // A centre already on the budget is not a new assignment; a different,
    // deactivated one is.
    await expect(
      service.update('company', 'user', stored().id, {
        costCenterId: 'inactive',
      }),
    ).rejects.toThrow(/inactive/i);
  });

  it('keeps a budget on a centre that was deactivated after the budget was set', async () => {
    const { service } = build({
      existing: stored({
        costCenterId: 'inactive',
        costCenter: { ...center, id: 'inactive', isActive: false },
      }),
    });

    const updated = await service.update('company', 'user', stored().id, {
      notes: 'still the same plan',
    });
    expect(updated.notes).toBe('still the same plan');
  });

  it('compares the budget with posted actuals and reports the variance', async () => {
    const { service } = build({ existing: stored() });

    const report = await service.report('company', {});

    expect(report.rows).toHaveLength(1);
    const [line] = report.rows;
    expect(line.budget).toBe('1000.0000');
    expect(line.actual).toBe('1200.0000');
    expect(line.variance).toBe('200.0000');
    expect(line.variancePercent).toBe('20.00');
    // Spending more than planned on an expense account is not favourable.
    expect(line.favorable).toBe(false);
    expect(report.totals.expense).toEqual({
      budget: '1000.0000',
      actual: '1200.0000',
      variance: '200.0000',
      variancePercent: '20.00',
    });
  });

  it('reports the period it compared, so nothing looks prorated', async () => {
    const { service } = build({ existing: stored() });

    const report = await service.report('company', {
      from: '2026-06-01',
      to: '2026-06-30',
    });

    expect(report.rows[0].periodStart).toBe('2026-01-01');
    expect(report.rows[0].periodEnd).toBe('2026-12-31');
    expect(report.basis).toMatch(/own period/);
  });
});
