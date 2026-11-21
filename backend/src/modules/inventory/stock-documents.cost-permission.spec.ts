import { ForbiddenException } from '@nestjs/common';
import { StockDocumentsService } from './stock-documents.service';

describe('StockDocumentsService receipt valuation permission', () => {
  it('rejects a receipt cost when the caller cannot read inventory costs', async () => {
    const service = new StockDocumentsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.create(
        'company',
        'branch',
        'user',
        {
          kind: 'ADJUSTMENT',
          voucherKind: 'RECEIPT',
          documentDate: '2026-11-21',
          toWarehouseId: 'warehouse',
          idempotencyKey: 'receipt-without-cost-access',
          lines: [{ itemId: 'item', quantity: '1', unitCost: '7.5' }],
        },
        false,
      ),
    ).rejects.toThrow(new ForbiddenException('inventory.cost.read permission is required to record receipt unit costs'));
  });
});
