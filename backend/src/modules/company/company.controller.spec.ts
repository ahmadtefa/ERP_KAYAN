import { ForbiddenException } from '@nestjs/common';

import {
  AuthUser,
} from '../../common/decorators/current-user.decorator';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';

describe('CompanyController company-data access', () => {
  const service = {
    createBranch: jest.fn(),
    updateBranch: jest.fn(),
    deleteBranch: jest.fn(),
  } as unknown as CompanyService;

  const controller = new CompanyController(service);
  const ordinaryUser = {
    companyId: 'company-1',
    userId: 'user-1',
    isSuperAdmin: false,
  } as AuthUser;
  const superAdmin = {
    companyId: 'company-1',
    userId: 'admin-1',
    isSuperAdmin: true,
  } as AuthUser;

  beforeEach(() => jest.clearAllMocks());

  it('does not create a branch for a user with company.manage permission but no Super Admin status', () => {
    expect(() => controller.createBranch(ordinaryUser, {} as never)).toThrow(
      ForbiddenException,
    );
    expect(service.createBranch).not.toHaveBeenCalled();
  });

  it('does not update a branch for a user who is not Super Admin', () => {
    expect(() =>
      controller.updateBranch(ordinaryUser, 'branch-1', {} as never),
    ).toThrow(ForbiddenException);
    expect(service.updateBranch).not.toHaveBeenCalled();
  });

  it('does not delete a branch for a user who is not Super Admin', async () => {
    await expect(
      controller.deleteBranch(ordinaryUser, 'branch-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.deleteBranch).not.toHaveBeenCalled();
  });

  it('allows the Super Admin to create, update and delete company branches', async () => {
    (service.createBranch as jest.Mock).mockResolvedValue({ id: 'branch-1' });
    (service.updateBranch as jest.Mock).mockResolvedValue({ id: 'branch-1' });
    (service.deleteBranch as jest.Mock).mockResolvedValue(undefined);

    expect(
      controller.createBranch(superAdmin, {} as never),
    ).toEqual({ id: 'branch-1' });
    expect(
      controller.updateBranch(superAdmin, 'branch-1', {} as never),
    ).toEqual({ id: 'branch-1' });
    await expect(
      controller.deleteBranch(superAdmin, 'branch-1'),
    ).resolves.toEqual({ deleted: true });

    expect(service.createBranch).toHaveBeenCalledWith(
      'company-1',
      'admin-1',
      {},
    );
    expect(service.updateBranch).toHaveBeenCalledWith(
      'company-1',
      'admin-1',
      'branch-1',
      {},
    );
    expect(service.deleteBranch).toHaveBeenCalledWith(
      'company-1',
      'admin-1',
      'branch-1',
    );
  });
});
