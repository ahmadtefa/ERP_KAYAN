/**
 * Whether a person's company stops them from signing in.
 *
 * A suspended company (`isActive = false`) or a retired one (`deletedAt`) closes
 * its people out of sign-in, refresh and every request. There is no exception
 * here.
 */
export interface CompanyState {
  isActive: boolean;
  deletedAt: Date | null;
}

export function companyClosesSignIn(company: CompanyState | null | undefined): boolean {
  return !company || !company.isActive || company.deletedAt !== null;
}
