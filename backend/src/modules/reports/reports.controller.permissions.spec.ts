import { ForbiddenException } from '@nestjs/common';

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ReportsController } from './reports.controller';

describe('company-wide budget report access', () => {
  const budgetService = { report: jest.fn(() => ({ totals: { budget: '100' } })) };
  const controller = new ReportsController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    budgetService as never,
    {} as never,
    {} as never,
  );

  const user = (roles: string[]): AuthUser => ({
    userId: 'user-1',
    username: 'test',
    companyId: 'company-1',
    branchId: null,
    isSuperAdmin: false,
    roles,
    permissions: ['accounting.budgets.read'],
  });

  beforeEach(() => jest.clearAllMocks());

  it('keeps company-wide budgets away from ordinary accountants and report users', () => {
    expect(() => controller.budgetReport(user(['ACCOUNTANT']), {} as never)).toThrow(ForbiddenException);
    expect(() => controller.budgetReport(user(['REPORT_USER']), {} as never)).toThrow(ForbiddenException);
    expect(budgetService.report).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'GENERAL_MANAGER', 'FINANCE_MANAGER'])(
    'allows %s to read company-wide budgets',
    (role) => {
      expect(controller.budgetReport(user([role]), {} as never)).toEqual({ totals: { budget: '100' } });
      expect(budgetService.report).toHaveBeenCalledWith('company-1', {});
    },
  );
});
