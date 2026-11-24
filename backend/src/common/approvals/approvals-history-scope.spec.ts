import { NotFoundException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';

function service(transfer: unknown) {
  const prisma = {
    stockTransfer: { findFirst: jest.fn().mockResolvedValue(transfer) },
    approvalDecision: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { svc: new ApprovalsService(prisma as never, { record: jest.fn() } as never), prisma };
}
const ID = '11111111-1111-1111-1111-111111111111';

describe('approval history branch scope', () => {
  it('company-wide callers see any history', async () => {
    const { svc } = service({ sourceBranchId: 'a', destinationBranchId: 'b' });
    await expect(svc.history('c', 'StockTransfer', ID, null)).resolves.toEqual({ items: [] });
  });
  it('branch staff see a transfer only when both branches are theirs', async () => {
    const { svc } = service({ sourceBranchId: 'a', destinationBranchId: 'b' });
    await expect(svc.history('c', 'StockTransfer', ID, ['a', 'b'])).resolves.toEqual({ items: [] });
    await expect(svc.history('c', 'StockTransfer', ID, ['a'])).rejects.toThrow(NotFoundException);
  });
  it('hides unknown document types and missing documents from branch staff', async () => {
    const { svc } = service(null);
    await expect(svc.history('c', 'SalesInvoice', ID, ['a'])).rejects.toThrow(NotFoundException);
    await expect(svc.history('c', 'StockTransfer', ID, ['a'])).rejects.toThrow(NotFoundException);
  });
});
