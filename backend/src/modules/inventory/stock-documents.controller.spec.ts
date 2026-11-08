import { ForbiddenException } from '@nestjs/common';

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { StockDocumentsController } from './stock-documents.controller';

describe('stock document warehouse access', () => {
  const service = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    updateVoucher: jest.fn(),
    transitionVoucher: jest.fn(),
    post: jest.fn(),
    reverse: jest.fn(),
  };
  const controller = new StockDocumentsController(service as never);

  const user = (overrides: Record<string, unknown> = {}): AuthUser =>
    ({
      companyId: 'company-1',
      userId: 'user-1',
      branchId: 'branch-1',
      branchIds: ['branch-1'],
      isSuperAdmin: false,
      permissions: ['inventory.stock.read', 'inventory.stock.adjust'],
      warehouseAccess: [
        {
          warehouseId: 'warehouse-visible',
          canView: true,
          canReceive: true,
          canIssue: true,
          canTransfer: true,
          canCount: true,
          canApprove: true,
          canSeeCost: true,
        },
      ],
      ...overrides,
    }) as AuthUser;

  beforeEach(() => jest.clearAllMocks());

  it('passes only visible warehouse ids to the document list', () => {
    controller.findAll(user({
      warehouseAccess: [
        { warehouseId: 'warehouse-visible', canView: true },
        { warehouseId: 'warehouse-hidden', canView: false },
      ],
    }), {});

    expect(service.findAll).toHaveBeenCalledWith(
      'company-1',
      expect.any(Object),
      'branch-1',
      ['warehouse-visible'],
    );
  });

  it('refuses a transfer detail if either warehouse is outside the user grants', async () => {
    service.findOne.mockResolvedValueOnce({
      id: 'doc-1',
      kind: 'TRANSFER',
      fromWarehouseId: 'warehouse-visible',
      toWarehouseId: 'warehouse-hidden',
    });

    await expect(
      controller.findOne(user(), 'doc-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an issue voucher edit without issue access to its warehouse', async () => {
    service.findOne.mockResolvedValueOnce({
      id: 'doc-2',
      kind: 'ADJUSTMENT',
      voucherKind: 'ISSUE',
      toWarehouseId: 'warehouse-visible',
    });

    await expect(
      controller.updateVoucher(
        user({
          warehouseAccess: [
            {
              warehouseId: 'warehouse-visible',
              canView: true,
              canReceive: true,
              canIssue: false,
              canTransfer: false,
              canCount: false,
              canApprove: false,
              canSeeCost: false,
            },
          ],
        }),
        'doc-2',
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.updateVoucher).not.toHaveBeenCalled();
  });

  it('requires warehouse approval access before reviewing a voucher', async () => {
    service.findOne.mockResolvedValueOnce({
      id: 'doc-3',
      kind: 'ADJUSTMENT',
      voucherKind: 'RECEIPT',
      toWarehouseId: 'warehouse-visible',
    });

    await expect(
      controller.review(
        user({
          warehouseAccess: [
            {
              warehouseId: 'warehouse-visible',
              canView: true,
              canReceive: true,
              canIssue: false,
              canTransfer: false,
              canCount: false,
              canApprove: false,
              canSeeCost: true,
            },
          ],
        }),
        'doc-3',
        { expectedVersion: 0 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.transitionVoucher).not.toHaveBeenCalled();
  });
});
