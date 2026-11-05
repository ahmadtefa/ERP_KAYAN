import { ForbiddenException } from '@nestjs/common';
import { InventoryReportsController } from './inventory-reports.controller';

describe('unit barcode permission', () => {
  const user = { companyId: 'c', userId: 'u', branchId: null, username: 'test', isSuperAdmin: false, permissions: ['inventory.items.update'] };
  it('does not allow adding or clearing a barcode without barcode management permission', () => {
    const service = { addUnit: jest.fn(), updateUnit: jest.fn() };
    const controller = new InventoryReportsController(service as never, {} as never);
    expect(() => controller.addUnit(user, 'i', { unit: 'box', factor: 12, barcode: 'abc' })).toThrow(ForbiddenException);
    expect(() => controller.addUnit(user, 'i', { unit: 'box', factor: 12, barcode: null })).toThrow(ForbiddenException);
    expect(() => controller.updateUnit(user, 'i', 'u', { barcode: null })).toThrow(ForbiddenException);
    expect(service.addUnit).not.toHaveBeenCalled();
    expect(service.updateUnit).not.toHaveBeenCalled();
    controller.addUnit(user, 'i', { unit: 'box', factor: 12 });
    expect(service.addUnit).toHaveBeenCalledTimes(1);
  });
  it('allows a barcode manager to supply the barcode', () => {
    const service = { addUnit: jest.fn() };
    const controller = new InventoryReportsController(service as never, {} as never);
    controller.addUnit({ ...user, permissions: [...user.permissions, 'inventory.barcodes.manage'] }, 'i', { barcode: 'abc' });
    expect(service.addUnit).toHaveBeenCalledTimes(1);
  });
});
