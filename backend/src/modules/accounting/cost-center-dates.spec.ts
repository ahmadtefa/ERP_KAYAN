import { BadRequestException } from '@nestjs/common';
import { CostCentersService } from './cost-centers.service';

const initial = {
  id: 'center', companyId: 'company', code: 'C', nameEn: 'Center', nameAr: 'مركز',
  type: 'DEPARTMENT', parentId: null, isActive: true, deletedAt: null,
  description: null, responsiblePerson: null,
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: new Date('2026-12-31T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};
function fixture() {
  const findFirst = jest.fn(async () => initial);
  const update = jest.fn(async ({ data }: { data: object }) => ({ ...initial, ...data }));
  const prisma = { costCenter: { findFirst, update } } as any;
  const audit = { record: jest.fn(async () => {}) } as any;
  return { service: new CostCentersService(prisma, audit), update };
}

describe('cost center date updates', () => {
  it.each([null, ''])('clears end date explicitly with %p while preserving omitted start', async (clear) => {
    const { service, update } = fixture();
    const result = await service.update('company', 'user', 'center', { endDate: clear });
    expect(result.startDate).toBe('2026-01-01');
    expect(result.endDate).toBeNull();
    expect(update.mock.calls[0][0].data).toMatchObject({ startDate: initial.startDate, endDate: null });
  });
  it.each([null, ''])('clears start date explicitly with %p while preserving omitted end', async (clear) => {
    const { service } = fixture();
    const result = await service.update('company', 'user', 'center', { startDate: clear });
    expect(result.startDate).toBeNull();
    expect(result.endDate).toBe('2026-12-31');
  });
  it('clears both dates together', async () => {
    const { service } = fixture();
    const result = await service.update('company', 'user', 'center', { startDate: null, endDate: null });
    expect(result.startDate).toBeNull();
    expect(result.endDate).toBeNull();
  });
  it('rejects inverted dates and writes nothing', async () => {
    const { service, update } = fixture();
    await expect(service.update('company', 'user', 'center', { startDate: '2027-01-01' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
  it('leaves both dates untouched if omitted', async () => {
    const { service, update } = fixture();
    await service.update('company', 'user', 'center', { nameEn: 'New' });
    expect(update.mock.calls[0][0].data).not.toHaveProperty('startDate');
    expect(update.mock.calls[0][0].data).not.toHaveProperty('endDate');
  });
});
