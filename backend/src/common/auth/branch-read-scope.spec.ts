import { branchReadScope } from './branch-read-scope';

describe('branchReadScope', () => {
  it('super admin is company-wide', () => {
    expect(branchReadScope({ isSuperAdmin: true })).toBeNull();
  });
  it('assigned staff see only their branches', () => {
    expect(branchReadScope({ branchIds: ['a', 'b'], roles: ['SALES_REP'] })).toEqual(['a', 'b']);
    expect(branchReadScope({ branchId: 'a' })).toEqual(['a']);
  });
  it('unassigned ordinary staff fail closed', () => {
    expect(branchReadScope({ roles: ['SALES_REP'] })).toEqual([]);
    expect(branchReadScope({})).toEqual([]);
  });
  it('unassigned company-wide roles keep the company', () => {
    expect(branchReadScope({ roles: ['general_manager'] })).toBeNull();
    expect(branchReadScope({ roles: ['ADMIN'] })).toBeNull();
  });
});
