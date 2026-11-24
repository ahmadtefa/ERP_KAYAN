import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

export interface AggregateVisibilityPrincipal {
  isSuperAdmin?: boolean;
  roles?: string[] | null;
}

/** The only ordinary company roles allowed to receive cross-record aggregates. */
export function mayReadCompanyAggregates(user: AggregateVisibilityPrincipal): boolean {
  const roles = new Set((user.roles ?? []).map((role) => role.trim().toUpperCase()));
  // Technical administration is not a financial role, even for a super admin.
  return roles.has('GENERAL_MANAGER') || roles.has('FINANCE_MANAGER');
}

/** Dashboard-only audience. Does not widen report or other aggregate access. */
export function mayReadDashboardStatistics(user: AggregateVisibilityPrincipal): boolean {
  const roles = new Set((user.roles ?? []).map((role) => role.trim().toUpperCase()));
  return roles.has('ADMIN') || roles.has('FINANCE_MANAGER');
}

const AGGREGATE_KEYS = new Set([
  'totals', 'summary', 'statistics', 'aggregates', 'metrics',
  'grandtotal', 'overalltotal', 'hasdata', 'documentsinperiod',
]);
const ROOT_AGGREGATE_KEYS = new Set(['total', 'count', 'counts']);

/** Remove aggregate payloads without hiding the individual records a caller may read. */
export function redactCompanyAggregates<T>(value: T): T {
  function visit(current: unknown, root = false): unknown {
    if (Array.isArray(current)) return current.map((item) => visit(item));
    if (current === null || typeof current !== 'object' || current instanceof Date || Buffer.isBuffer(current)) {
      return current;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) return current;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(current)) {
      const normalized = key.toLowerCase();
      if (AGGREGATE_KEYS.has(normalized) || (root && ROOT_AGGREGATE_KEYS.has(normalized))) continue;
      result[key] = visit(child);
    }
    return result;
  }
  return visit(value, true) as T;
}

@Injectable()
export class CompanyAggregateVisibilityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest<{ user?: AggregateVisibilityPrincipal }>().user;
    if (!user || mayReadCompanyAggregates(user)) return next.handle();
    return next.handle().pipe(map((value) => redactCompanyAggregates(value)));
  }
}
