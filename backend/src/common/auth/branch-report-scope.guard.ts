import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { AuthUser } from '../decorators/current-user.decorator';
import { warehouseScopeOf } from '../warehouse/warehouse.service';

const BRANCH_SCOPED_LISTS = new Set([
  'stock',
  'stock-ledger',
  'sales-invoices',
  'purchase-invoices',
  'journal-entries',
  'cash-vouchers',
  'cash-transfers',
]);

/**
 * Report query parameters are an API boundary, not a branch authorization.
 * A branch-assigned person may choose one of their branches; omitting the
 * filter must never silently turn a branch report into a company report.
 */
@Injectable()
export class BranchReportScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      query?: Record<string, unknown>;
      params?: Record<string, string>;
    }>();
    const user = request.user;
    if (!user || user.isSuperAdmin) return true;

    // The list-export controller also serves company-wide master data and
    // administration lists. They have no branch dimension and must not be
    // made to require a branch merely because they share a route prefix.
    const listSlug = request.params?.list;
    if (listSlug && !BRANCH_SCOPED_LISTS.has(listSlug)) return true;

    const scope = warehouseScopeOf(user);
    if (scope === null) return true;

    // Express 5 builds `request.query` fresh on every read, so a value written
    // onto it is silently lost before the controller reads it. Replace the
    // property with a stable object first, then write to that.
    const stable: Record<string, unknown> = { ...(request.query ?? {}) };
    Object.defineProperty(request, 'query', { value: stable, writable: true, configurable: true, enumerable: true });
    const query = stable;
    const requested = typeof query.branchId === 'string' ? query.branchId.trim() : '';
    if (requested) {
      if (!scope.includes(requested)) throw new NotFoundException({ code: 'REPORT_NOT_FOUND', message: 'Report not found' });
      return true;
    }

    if (scope.length === 1) {
      query.branchId = scope[0];
      return true;
    }

    throw new ForbiddenException({ code: 'REPORT_SELECT_BRANCH', message: 'Choose one of your assigned branches to view this report.' });
  }
}
