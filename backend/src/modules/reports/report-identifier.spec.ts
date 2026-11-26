import { BadRequestException } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ReportsController } from './reports.controller';

const user = {
  userId: 'u1',
  username: 'accountant',
  companyId: 'company-1',
  branchId: null,
  permissions: ['reports.account-ledger.read', 'accounting.costcenters.read'],
  isSuperAdmin: false,
} as unknown as AuthUser;

/**
 * A malformed identifier in the address is a client mistake. Before these
 * tests it reached PostgreSQL as a uuid and the driver's error was reported as
 * `500 Unexpected server error` - which tells an operator the program is
 * broken when the address was simply wrong.
 */
describe('report routes refuse malformed identifiers as a bad request', () => {
  function controller() {
    const service = { accountLedger: jest.fn().mockResolvedValue({ rows: [] }) };
    const statements = { costCenterTransactions: jest.fn().mockResolvedValue({ items: [] }) };
    return {
      service,
      statements,
      controller: new ReportsController(
        service as never,
        statements as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  }

  it('rejects a cost centre id that is neither a UUID nor "unallocated"', async () => {
    const { controller: c, statements } = controller();
    expect(() =>
      c.costCenterTransactions(user, 'not-a-uuid', {} as never),
    ).toThrow(BadRequestException);
    expect(statements.costCenterTransactions).not.toHaveBeenCalled();
  });

  it('still accepts "unallocated" and a real UUID', async () => {
    const { controller: c, statements } = controller();
    await c.costCenterTransactions(user, 'unallocated', {} as never);
    expect(statements.costCenterTransactions).toHaveBeenLastCalledWith(
      'company-1',
      null,
      expect.anything(),
    );

    const id = '11111111-1111-4111-8111-111111111111';
    await c.costCenterTransactions(user, id, {} as never);
    expect(statements.costCenterTransactions).toHaveBeenLastCalledWith(
      'company-1',
      id,
      expect.anything(),
    );
  });
});
