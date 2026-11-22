import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { InventoryReportsService } from './inventory-reports.service';

const centerId = '11111111-1111-4111-8111-111111111111';
const D = (value: string) => new Prisma.Decimal(value);

describe('InventoryReportsService cost-centre movement report', () => {
  const settings = { get: jest.fn() };
  const audit = {};
  const prisma = { $queryRaw: jest.fn() };
  const service = new InventoryReportsService(prisma as never, audit as never, settings as never);

  beforeEach(() => jest.clearAllMocks());

  it('attributes each source movement once, keeps legacy unassigned rows, and totals signed activity', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'in', movementDate: new Date('2026-10-01T00:00:00Z'), direction: 'IN', quantity: D('5'), unitCost: D('8'), totalCost: D('40'), referenceType: 'STOCK_ADJUSTMENT', referenceNumber: 'SA-1', itemId: 'item', itemCode: 'I1', itemNameEn: 'Item', itemNameAr: 'صنف', unit: 'piece', costCenterId: centerId, costCenterCode: 'OPS', costCenterNameEn: 'Operations', costCenterNameAr: 'تشغيل' },
      { id: 'out', movementDate: new Date('2026-10-02T00:00:00Z'), direction: 'OUT', quantity: D('2'), unitCost: D('8'), totalCost: D('16'), referenceType: 'STOCK_ADJUSTMENT', referenceNumber: 'SI-1', itemId: 'item', itemCode: 'I1', itemNameEn: 'Item', itemNameAr: 'صنف', unit: 'piece', costCenterId: centerId, costCenterCode: 'OPS', costCenterNameEn: 'Operations', costCenterNameAr: 'تشغيل' },
      { id: 'legacy', movementDate: new Date('2025-01-01T00:00:00Z'), direction: 'OUT', quantity: D('1'), unitCost: D('3'), totalCost: D('3'), referenceType: 'STOCK_ADJUSTMENT', referenceNumber: 'SA-OLD', itemId: 'item', itemCode: 'I1', itemNameEn: 'Item', itemNameAr: 'صنف', unit: 'piece', costCenterId: null, costCenterCode: null, costCenterNameEn: null, costCenterNameAr: null },
    ]);

    const result = await service.costCenterMovements('company', {}, true);

    expect(result.items).toHaveLength(3);
    expect(result.items.map((row) => row.id)).toEqual(['in', 'out', 'legacy']);
    expect(result.totals).toHaveLength(2);
    expect(result.totals).toEqual(expect.arrayContaining([
      expect.objectContaining({ costCenterId: centerId, movementCount: 2, quantityIn: '5.0000', quantityOut: '2.0000', valueIn: '40.0000', valueOut: '16.0000', netValue: '24.0000' }),
      expect.objectContaining({ costCenterId: null, movementCount: 1, quantityOut: '1.0000', valueOut: '3.0000' }),
    ]));
    expect(result.items.filter((row) => row.id === 'in')).toHaveLength(1);
  });

  it('redacts movement values and centre totals without cost permission', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'out', movementDate: new Date('2026-10-02T00:00:00Z'), direction: 'OUT', quantity: D('2'), unitCost: D('8'), totalCost: D('16'), referenceType: 'STOCK_ADJUSTMENT', referenceNumber: 'SI-1', itemId: 'item', itemCode: 'I1', itemNameEn: 'Item', itemNameAr: 'صنف', unit: 'piece', costCenterId: centerId, costCenterCode: 'OPS', costCenterNameEn: 'Operations', costCenterNameAr: 'تشغيل' },
    ]);
    const result = await service.costCenterMovements('company', {}, false);
    expect(result.items[0].unitCost).toBeNull();
    expect(result.items[0].value).toBeNull();
    expect(result.totals[0].valueOut).toBeNull();
    expect(result.totals[0].netValue).toBeNull();
  });

  it('rejects malformed cost-center filters before querying', async () => {
    await expect(service.costCenterMovements('company', { costCenterId: 'not-a-uuid' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
