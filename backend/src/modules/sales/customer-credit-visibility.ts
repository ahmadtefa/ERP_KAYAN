import { mayReadCompanyAggregates } from '../../common/auth/company-aggregate-visibility';
import { branchReadScope } from '../../common/auth/branch-read-scope';

interface CreditViewer {
  isSuperAdmin?: boolean;
  roles?: string[] | null;
  permissions?: string[] | null;
  branchId?: string | null;
  branchIds?: string[] | null;
}

/// The credit figures are the customer card's company-wide numbers, so they
/// follow the card's own rules: the card permission, the company-aggregate
/// roles (a super admin without one of those roles is excluded) and no branch
/// restriction. Anyone else still gets the block, without the numbers.
export function mayDiscloseCreditFigures(user: CreditViewer): boolean {
  return (
    (user.isSuperAdmin === true || (user.permissions ?? []).includes('parties.customers.read')) &&
    mayReadCompanyAggregates(user) &&
    branchReadScope(user) === null
  );
}
