import {
  STOCK_TRANSFER_APPROVAL_REQUIRED,
  STOCK_TRANSFER_CLOSE_REQUIRED,
  STOCK_TRANSFER_DISPATCH_REQUIRED,
  STOCK_TRANSFER_RECEIPT_REQUIRED,
  STOCK_TRANSFER_RECEIVED,
  STOCK_TRANSFER_REVIEW_REQUIRED,
  STOCK_TRANSFER_SETTLEMENT_APPROVAL_REQUIRED,
  notificationKind,
} from './notification-kinds';

describe('stock-transfer notification catalogue', () => {
  it('routes each transfer task and receipt event to its matching permission', () => {
    const expected = [
      [STOCK_TRANSFER_REVIEW_REQUIRED, 'inventory.transfer.review'],
      [STOCK_TRANSFER_APPROVAL_REQUIRED, 'inventory.transfer.approve'],
      [STOCK_TRANSFER_DISPATCH_REQUIRED, 'inventory.transfer.dispatch'],
      [STOCK_TRANSFER_RECEIPT_REQUIRED, 'inventory.transfer.receive'],
      [STOCK_TRANSFER_RECEIVED, 'inventory.transfer.dispatch'],
      [STOCK_TRANSFER_SETTLEMENT_APPROVAL_REQUIRED, 'inventory.transfer.settle.approve'],
      [STOCK_TRANSFER_CLOSE_REQUIRED, 'inventory.transfer.close'],
    ] as const;

    for (const [type, permission] of expected) {
      expect(notificationKind(type)).toMatchObject({
        type,
        module: 'inventory',
        permission,
        entityType: 'StockTransfer',
      });
    }
  });
});
