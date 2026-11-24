import { mayDiscloseCreditFigures } from './customer-credit-visibility';

describe('credit figures visibility follows the customer card rules', () => {
  const read = ['parties.customers.read'];
  it('company-wide finance/general manager with the card permission sees figures', () => {
    expect(mayDiscloseCreditFigures({ roles: ['FINANCE_MANAGER'], permissions: read })).toBe(true);
    expect(mayDiscloseCreditFigures({ roles: ['GENERAL_MANAGER'], permissions: read })).toBe(true);
  });
  it('a branch-limited manager does not', () => {
    expect(mayDiscloseCreditFigures({ roles: ['FINANCE_MANAGER'], permissions: read, branchId: 'b1' })).toBe(false);
    expect(mayDiscloseCreditFigures({ roles: ['GENERAL_MANAGER'], permissions: read, branchIds: ['b1'] })).toBe(false);
  });
  it('a role outside the aggregate roles does not, even a super admin or one holding the permission', () => {
    expect(mayDiscloseCreditFigures({ roles: ['SALES'], permissions: read })).toBe(false);
    expect(mayDiscloseCreditFigures({ isSuperAdmin: true, roles: ['ADMIN'] })).toBe(false);
    expect(mayDiscloseCreditFigures({ roles: ['ADMIN'], permissions: read })).toBe(false);
  });
  it('without the card permission it does not', () => {
    expect(mayDiscloseCreditFigures({ roles: ['FINANCE_MANAGER'], permissions: [] })).toBe(false);
  });
});
