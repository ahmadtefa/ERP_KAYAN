import { NotFoundException } from '@nestjs/common';
import { ReturnsService } from './returns.service';

function make() {
  const prisma = {
    salesInvoice: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null) },
    purchaseInvoice: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const svc = new ReturnsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { svc, prisma };
}

describe('returns branch scope', () => {
  it('filters the sales and purchase return lists by the caller branches', async () => {
    const { svc, prisma } = make();
    await svc.findAll('c', 'sales', {}, true, ['mns']);
    expect(prisma.salesInvoice.findMany.mock.calls[0][0].where.branchId).toEqual({ in: ['mns'] });
    expect(prisma.salesInvoice.findMany.mock.calls[0][0].where.documentType).toBe('CREDIT_NOTE');
    await svc.findAll('c', 'purchases', {}, true, ['mns']);
    expect(prisma.purchaseInvoice.findMany.mock.calls[0][0].where.branchId).toEqual({ in: ['mns'] });
    expect(prisma.purchaseInvoice.findMany.mock.calls[0][0].where.documentType).toBe('DEBIT_NOTE');
  });
  it('does not filter for company-wide callers', async () => {
    const { svc, prisma } = make();
    await svc.findAll('c', 'sales', {}, true, null);
    expect(prisma.salesInvoice.findMany.mock.calls[0][0].where.branchId).toBeUndefined();
  });
  it('queries detail with the branch filter, so a foreign return is 404', async () => {
    const { svc, prisma } = make();
    await expect(svc.findOne('c', 'sales', 'id', true, ['mns'])).rejects.toThrow(NotFoundException);
    expect(prisma.salesInvoice.findFirst.mock.calls[0][0].where.branchId).toEqual({ in: ['mns'] });
  });
  it('a no-branch ordinary user (empty scope) matches nothing', async () => {
    const { svc, prisma } = make();
    await svc.findAll('c', 'sales', {}, true, []);
    expect(prisma.salesInvoice.findMany.mock.calls[0][0].where.branchId).toEqual({ in: [] });
  });
});
