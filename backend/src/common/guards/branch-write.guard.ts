import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { branchReadScope } from '../auth/branch-read-scope';
import type { AuthUser } from '../decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/// Documents that belong to one branch, by the route prefix that addresses
/// them by id. A change (post, reverse, cancel, edit, delete ...) to one of
/// them must come from someone assigned to that branch.
const BRANCH_OWNED: Array<{ prefix: RegExp; model: string }> = [
  { prefix: /^\/api\/v1\/sales\/invoices\/([0-9a-f-]{36})(\/|$)/i, model: 'salesInvoice' },
  { prefix: /^\/api\/v1\/purchases\/invoices\/([0-9a-f-]{36})(\/|$)/i, model: 'purchaseInvoice' },
  { prefix: /^\/api\/v1\/accounting\/journal-entries\/([0-9a-f-]{36})(\/|$)/i, model: 'journalEntry' },
  { prefix: /^\/api\/v1\/sales\/orders\/([0-9a-f-]{36})(\/|$)/i, model: 'salesOrder' },
  { prefix: /^\/api\/v1\/purchases\/orders\/([0-9a-f-]{36})(\/|$)/i, model: 'purchaseOrder' },
  { prefix: /^\/api\/v1\/sales\/quotations\/([0-9a-f-]{36})(\/|$)/i, model: 'quotation' },
  { prefix: /^\/api\/v1\/cash\/vouchers\/([0-9a-f-]{36})(\/|$)/i, model: 'cashVoucher' },
  { prefix: /^\/api\/v1\/cash\/transfers\/([0-9a-f-]{36})(\/|$)/i, model: 'cashTransfer' },
  { prefix: /^\/api\/v1\/fixed-assets\/([0-9a-f-]{36})(\/|$)/i, model: 'fixedAsset' },
  { prefix: /^\/api\/v1\/returns\/sales\/([0-9a-f-]{36})(\/|$)/i, model: 'salesInvoice' },
  { prefix: /^\/api\/v1\/returns\/purchases\/([0-9a-f-]{36})(\/|$)/i, model: 'purchaseInvoice' },
  { prefix: /^\/api\/v1\/inventory\/stock-documents\/(?:vouchers\/)?([0-9a-f-]{36})(\/|$)/i, model: 'stockDocument' },
  { prefix: /^\/api\/v1\/cash\/accounts\/([0-9a-f-]{36})(\/|$)/i, model: 'cashAccount' },
];

/**
 * Owner policy: a branch employee works on their own branch only. Reads are
 * filtered in the services; this guard covers every state-changing request
 * that names a branch document by id. Super administrators and accounts with
 * no branch assignment are company-wide and pass.
 */
@Injectable()
export class BranchWriteGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      originalUrl?: string;
      url: string;
      user?: AuthUser;
      body?: unknown;
    }>();
    const method = request.method.toUpperCase();
    if (['HEAD', 'OPTIONS'].includes(method)) return true;
    const user = request.user;
    if (!user) return true;
    const scope = branchReadScope(user);
    if (scope === null) return true;
    // Reading one stock document by id is branch-confined too (lists already
    // are); other reads are filtered inside their services.
    if (method === 'GET' && !/\/inventory\/stock-documents\//.test((request.originalUrl ?? request.url).split('?')[0])) return true;

    // Creating stock documents: the branch and warehouses named in the body
    // must be inside the caller's scope.
    if (method === 'POST' && /\/inventory\/stock-documents\/?(vouchers\/?)?$/.test((request.originalUrl ?? request.url).split('?')[0])) {
      const body = (request.body ?? {}) as Record<string, unknown>;
      for (const key of ['branchId', 'toBranchId', 'fromBranchId']) {
        const v = body[key];
        if (typeof v === 'string' && v && !scope.includes(v)) throw new ForbiddenException({ code: 'BRANCH_OUTSIDE_ASSIGNMENT', message: 'This branch is outside your assignment.' });
      }
      for (const key of ['toWarehouseId', 'fromWarehouseId', 'warehouseId']) {
        const v = body[key];
        if (typeof v !== 'string' || !v) continue;
        const wh = await (this.prisma as unknown as { warehouse: { findFirst(a: unknown): Promise<{ branchId: string } | null> } })
          .warehouse.findFirst({ where: { id: v, companyId: user.companyId }, select: { branchId: true } });
        if (wh && !scope.includes(wh.branchId)) throw new ForbiddenException({ code: 'WAREHOUSE_OUTSIDE_ASSIGNMENT', message: 'This warehouse is outside your assignment.' });
      }
      return true;
    }

    const path = (request.originalUrl ?? request.url).split('?')[0];
    for (const { prefix, model } of BRANCH_OWNED) {
      const match = prefix.exec(path);
      if (!match) continue;
      const delegate = (this.prisma as unknown as Record<string, {
        findFirst(args: unknown): Promise<{ branchId: string | null } | null>;
      }>)[model];
      const row = await delegate.findFirst({
        where: { id: match[1], companyId: user.companyId },
        select: { branchId: true },
      });
      // Unknown ids fall through to the route's own 404. A document with no
      // branch is company-level and is not made writable to branch staff.
      if (row && (row.branchId === null || !scope.includes(row.branchId))) {
        throw new NotFoundException('Not found');
      }
      return true;
    }
    return true;
  }
}
