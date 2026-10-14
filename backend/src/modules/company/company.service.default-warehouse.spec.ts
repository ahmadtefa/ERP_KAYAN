import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateBranchDto } from './dto/company.dto';
import { CompanyService } from './company.service';

describe('CompanyService default warehouse invariant', () => {
  it('creates the branch and its default warehouse in one transaction', async () => {
    const branch = {
      id: 'branch-12345678-0000-4000-8000-000000000001',
      companyId: 'company-1',
      code: 'BR01',
      nameEn: 'Branch',
      nameAr: 'الفرع',
      kind: 'HEADQUARTERS',
      parentBranchId: null,
      isActive: true,
    };
    const tx = {
      branch: {
        create: jest.fn().mockResolvedValue(branch),
      },
      warehouse: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'warehouse-1',
          companyId: 'company-1',
          branchId: branch.id,
          code: 'BR01-MAIN',
          isDefault: true,
          isActive: true,
        }),
      },
    };
    const prisma = {
      branch: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as PrismaService;
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const service = new CompanyService(prisma, audit);

    const result = await service.createBranch(
      'company-1',
      'user-1',
      {
        code: 'BR01',
        nameEn: 'Branch',
        nameAr: 'الفرع',
        kind: 'HEADQUARTERS',
      } as CreateBranchDto,
    );

    expect(result).toMatchObject({ id: branch.id, code: 'BR01' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.warehouse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-1',
        branchId: branch.id,
        code: 'BR01-MAIN',
        isDefault: true,
        isActive: true,
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'branches', entityId: branch.id }),
    );
  });
});
