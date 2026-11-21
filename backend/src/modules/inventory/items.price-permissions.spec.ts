import { ForbiddenException } from '@nestjs/common';
import { ItemsController } from './items.controller';

describe('item price read and write permissions', () => {
  const user = (permissions: string[]) => ({
    userId: 'user-1',
    username: 'operator',
    companyId: 'company-1',
    branchId: 'branch-1',
    isSuperAdmin: false,
    permissions,
  });

  it('allows an inventory operator to create an item without catalogue prices', async () => {
    const service = { create: jest.fn().mockResolvedValue({ id: 'item-1', code: 'ITEM-1' }) };
    const controller = new ItemsController(service as never);
    await expect(controller.create(user(['inventory.items.create']) as never, {
      code: 'ITEM-1', nameEn: 'Unpriced item',
    })).resolves.toEqual({ id: 'item-1', code: 'ITEM-1' });
    expect(service.create).toHaveBeenCalledTimes(1);
  });

  it('does not let ordinary item-edit permission write a selling price', () => {
    const controller = new ItemsController({ create: jest.fn() } as never);
    expect(() => controller.create(user(['inventory.items.create']) as never, {
      code: 'ITEM-2', salePrice: '5.00',
    })).toThrow(ForbiddenException);
  });

  it('does not let legacy cost-read permission write purchase prices', () => {
    const controller = new ItemsController({ create: jest.fn() } as never);
    expect(() => controller.create(user([
      'inventory.items.create', 'inventory.cost.read',
    ]) as never, { code: 'ITEM-3', purchasePrice: '4.00' })).toThrow(ForbiddenException);
  });

  it('keeps price entry separate from price visibility', async () => {
    const service = { create: jest.fn().mockResolvedValue({
      id: 'item-4', salePrice: '8.00', purchasePrice: '3.00',
    }) };
    const controller = new ItemsController(service as never);
    const result = await controller.create(user([
      'inventory.items.create',
      'inventory.items.saleprice.manage',
      'inventory.items.purchaseprice.manage',
    ]) as never, {
      code: 'ITEM-4', salePrice: '8.00', purchasePrice: '3.00',
    }) as Record<string, unknown>;
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'item-4' });
  });
});
