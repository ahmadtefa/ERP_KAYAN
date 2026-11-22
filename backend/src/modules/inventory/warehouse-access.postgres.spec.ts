import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WarehouseAccessService } from './warehouse-access.service';

const run = process.env.KAYAN_WAREHOUSE_ACCESS_PG === '1';
(run ? describe : describe.skip)('warehouse access on isolated PostgreSQL', () => {
  jest.setTimeout(90_000);
  const companyId = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const warehouseA = randomUUID();
  const warehouseB = randomUUID();
  const userId = randomUUID();
  let prisma: PrismaService;
  let service: WarehouseAccessService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const suffix = companyId.slice(0, 8);
    await prisma.company.create({ data: { id: companyId, code: `WA-${suffix}`, nameEn: 'Access test', nameAr: 'اختبار الصلاحيات' } });
    await prisma.branch.createMany({ data: [
      { id: branchA, companyId, code: 'A', nameEn: 'A', nameAr: 'أ' },
      { id: branchB, companyId, code: 'B', nameEn: 'B', nameAr: 'ب' },
    ] });
    await prisma.warehouse.createMany({ data: [
      { id: warehouseA, companyId, branchId: branchA, code: 'A', nameEn: 'A', nameAr: 'أ' },
      { id: warehouseB, companyId, branchId: branchB, code: 'B', nameEn: 'B', nameAr: 'ب' },
    ] });
    await prisma.user.create({ data: {
      id: userId, companyId, username: `wa-${suffix}`, fullNameEn: 'Test', fullNameAr: 'اختبار', passwordHash: 'not-a-login',
    } });
    await prisma.userBranch.create({ data: { userId, branchId: branchA } });
    service = new WarehouseAccessService(prisma, { record: async () => {} } as never);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.userWarehouseAccess.deleteMany({ where: { companyId } });
    await prisma.userBranch.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.warehouse.deleteMany({ where: { companyId } });
    await prisma.branch.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it('prevents direct out-of-scope subject access and removal of the last restriction', async () => {
    await expect(service.forUser(companyId, userId, [branchB])).rejects.toMatchObject({ status: 404 });
    await expect(service.setForUser(companyId, userId, userId, [], [branchB])).rejects.toMatchObject({ status: 404 });
    await service.setForUser(companyId, userId, userId, [{ warehouseId: warehouseA }]);
    await expect(service.setForUser(companyId, userId, userId, [], [branchA])).rejects.toMatchObject({ status: 403 });
    expect(await prisma.userWarehouseAccess.count({ where: { companyId, userId } })).toBe(1);
  });
});
