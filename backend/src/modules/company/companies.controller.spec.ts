import { ForbiddenException } from '@nestjs/common';

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyService } from './company.service';
import { CompaniesController } from './companies.controller';

describe('CompaniesController company profile and logo access', () => {
  const service = {
    updateProfile: jest.fn(),
    setLogo: jest.fn(),
    deleteLogo: jest.fn(),
    getProfile: jest.fn(),
  } as unknown as CompanyService;
  const controller = new CompaniesController(service);

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

  it('refuses profile edits from a non-Super-Admin before calling the service', () => {
    expect(() => controller.update(ordinaryUser, {} as never)).toThrow(
      ForbiddenException,
    );
    expect(service.updateProfile).not.toHaveBeenCalled();
  });

  it('refuses logo uploads from a non-Super-Admin before calling the service', async () => {
    await expect(
      controller.uploadLogo(ordinaryUser, {
        originalname: 'company.png',
        mimetype: 'image/png',
        size: 4,
        buffer: Buffer.from('logo'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.setLogo).not.toHaveBeenCalled();
  });

  it('refuses logo deletion from a non-Super-Admin before calling the service', async () => {
    await expect(controller.removeLogo(ordinaryUser)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(service.deleteLogo).not.toHaveBeenCalled();
  });

  it('allows the Super Admin to update the profile and logo', async () => {
    (service.updateProfile as jest.Mock).mockResolvedValue({ name: 'KAYAN' });
    (service.setLogo as jest.Mock).mockResolvedValue({ updated: true });
    (service.deleteLogo as jest.Mock).mockResolvedValue(undefined);
    (service.getProfile as jest.Mock).mockResolvedValue({ name: 'KAYAN' });

    expect(controller.update(superAdmin, { name: 'KAYAN' } as never)).toEqual({
      name: 'KAYAN',
    });
    await expect(
      controller.uploadLogo(superAdmin, {
        originalname: 'company.png',
        mimetype: 'image/png',
        size: 4,
        buffer: Buffer.from('logo'),
      }),
    ).resolves.toEqual({ updated: true });
    await expect(controller.removeLogo(superAdmin)).resolves.toEqual({
      name: 'KAYAN',
    });

    expect(service.updateProfile).toHaveBeenCalledWith(
      'company-1',
      'admin-1',
      { name: 'KAYAN' },
    );
    expect(service.setLogo).toHaveBeenCalledWith(
      'company-1',
      'admin-1',
      Buffer.from('logo'),
      'image/png',
    );
    expect(service.deleteLogo).toHaveBeenCalledWith('company-1', 'admin-1');
  });
});
