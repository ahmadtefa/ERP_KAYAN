import type { INestApplication } from '@nestjs/common';
import { LicensingService } from '../../modules/licensing/licensing.service';
import { RoleCatalogueBootstrap } from '../../modules/admin/role-catalogue.bootstrap';
import { MaintenanceService } from './maintenance';
import { coordinateBusinessStartup } from './startup-coordination';

describe('business startup maintenance coordination', () => {
  function setup(blocked = false) {
    const release = jest.fn();
    const maintenance = { admitBusinessRequest: blocked
      ? jest.fn().mockRejectedValue(new Error('restore pending'))
      : jest.fn().mockResolvedValue(release) };
    const initialize = jest.fn().mockResolvedValue(undefined);
    const licence = { onModuleInit: initialize };
    const roles = { onApplicationBootstrap: jest.fn(), ensureAllCompanies: jest.fn().mockResolvedValue({ created: 0, companies: 0 }) };
    const app = { get: (token: unknown) => token === MaintenanceService ? maintenance
      : token === LicensingService ? licence : token === RoleCatalogueBootstrap ? roles : undefined };
    coordinateBusinessStartup(app as INestApplication);
    return { release, initialize, licence, roles };
  }
  it('defers business initializers while recovery is pending', async () => {
    const { licence, roles, initialize, release } = setup(true);
    await licence.onModuleInit();
    await roles.onApplicationBootstrap();
    expect(initialize).not.toHaveBeenCalled();
    expect(roles.ensureAllCompanies).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
  it('holds the lease until detached role writes actually finish', async () => {
    const { roles, release } = setup();
    let finish!: () => void;
    roles.ensureAllCompanies.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const initializing = roles.onApplicationBootstrap();
    await Promise.resolve();
    await Promise.resolve();
    expect(release).not.toHaveBeenCalled();
    finish();
    await initializing;
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('preserves normal initialization and releases on error', async () => {
    const { licence, initialize, release } = setup();
    initialize.mockRejectedValueOnce(new Error('initializer failed'));
    await expect(licence.onModuleInit()).rejects.toThrow('initializer failed');
    expect(release).toHaveBeenCalledTimes(1);
  });
});
