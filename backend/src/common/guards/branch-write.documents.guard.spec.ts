import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BranchWriteGuard } from './branch-write.guard';

const DOC = '11111111-1111-1111-1111-111111111111';
function ctx(req: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as never;
}
function guardWith(rows: { stockDocument?: unknown; warehouse?: unknown; salesInvoice?: unknown }) {
  const del = (row: unknown) => ({ findFirst: jest.fn().mockResolvedValue(row) });
  const prisma = {
    stockDocument: del(rows.stockDocument),
    warehouse: del(rows.warehouse),
    salesInvoice: del(rows.salesInvoice),
  };
  return new BranchWriteGuard(prisma as never);
}
const branchUser = { companyId: 'c', isSuperAdmin: false, branchIds: ['mns'], roles: ['SALES_CLERK'] };

describe('BranchWriteGuard', () => {
  it('lets company-wide users through', async () => {
    const g = guardWith({});
    await expect(g.canActivate(ctx({ method: 'POST', url: `/api/v1/sales/invoices/${DOC}/reverse`, user: { companyId: 'c', isSuperAdmin: true } }))).resolves.toBe(true);
  });
  it('hides a foreign-branch invoice from a change', async () => {
    const g = guardWith({ salesInvoice: { branchId: 'main' } });
    await expect(g.canActivate(ctx({ method: 'POST', url: `/api/v1/sales/invoices/${DOC}/reverse`, user: branchUser }))).rejects.toThrow(NotFoundException);
  });
  it('allows an own-branch invoice', async () => {
    const g = guardWith({ salesInvoice: { branchId: 'mns' } });
    await expect(g.canActivate(ctx({ method: 'POST', url: `/api/v1/sales/invoices/${DOC}/reverse`, user: branchUser }))).resolves.toBe(true);
  });
  it('refuses a no-branch document for branch staff', async () => {
    const g = guardWith({ salesInvoice: { branchId: null } });
    await expect(g.canActivate(ctx({ method: 'POST', url: `/api/v1/sales/invoices/${DOC}/reverse`, user: branchUser }))).rejects.toThrow(NotFoundException);
  });
  it('refuses reading a foreign stock document by id', async () => {
    const g = guardWith({ stockDocument: { branchId: 'main' } });
    await expect(g.canActivate(ctx({ method: 'GET', url: `/api/v1/inventory/stock-documents/${DOC}`, user: branchUser }))).rejects.toThrow(NotFoundException);
  });
  it('refuses creating a stock document for a foreign branch or warehouse', async () => {
    const g = guardWith({ warehouse: { branchId: 'main' } });
    await expect(g.canActivate(ctx({ method: 'POST', url: '/api/v1/inventory/stock-documents', body: { branchId: 'main' }, user: branchUser }))).rejects.toThrow(ForbiddenException);
    await expect(g.canActivate(ctx({ method: 'POST', url: '/api/v1/inventory/stock-documents', body: { toWarehouseId: 'w1' }, user: branchUser }))).rejects.toThrow(ForbiddenException);
  });
  it('fails closed for an ordinary account with no branch', async () => {
    const g = guardWith({ salesInvoice: { branchId: 'mns' } });
    const u = { companyId: 'c', isSuperAdmin: false, branchIds: [], roles: ['SALES_CLERK'] };
    await expect(g.canActivate(ctx({ method: 'POST', url: `/api/v1/sales/invoices/${DOC}/reverse`, user: u }))).rejects.toThrow(NotFoundException);
  });
});
