import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ImportController } from './import.controller';

const user: AuthUser = {
  userId: 'actor', companyId: 'company', branchId: null,
  username: 'creator', isSuperAdmin: false,
  permissions: ['parties.customers.create'],
};
const file = { originalname: 'customers.csv', mimetype: 'text/csv', size: 20, buffer: Buffer.from('Code,Name\nC1,Customer') };

describe('spreadsheet import authorization', () => {
  it('allows create-only users to insert but not upsert existing customers', async () => {
    const run = jest.fn().mockResolvedValue({ created: 1 });
    const controller = new ImportController({ run } as any);
    await expect(controller.upload(user, 'customers', file, { mode: 'insert' })).resolves.toEqual({ created: 1 });
    run.mockClear();
    await expect(controller.upload(user, 'customers', file, { mode: 'upsert' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(run).not.toHaveBeenCalled();
  });

  it('allows upsert only with the matching update grant, or for a super admin', async () => {
    const run = jest.fn().mockResolvedValue({ updated: 1 });
    const controller = new ImportController({ run } as any);
    await expect(controller.upload({ ...user, permissions: [...user.permissions, 'parties.customers.update'] }, 'customers', file, { mode: 'upsert' })).resolves.toEqual({ updated: 1 });
    await expect(controller.upload({ ...user, isSuperAdmin: true, permissions: [] }, 'customers', file, { mode: 'upsert' })).resolves.toEqual({ updated: 1 });
  });

  it('still rejects users without the create grant before parsing or writing', async () => {
    const run = jest.fn();
    const controller = new ImportController({ run } as any);
    await expect(controller.upload({ ...user, permissions: [] }, 'customers', file, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(run).not.toHaveBeenCalled();
  });
});
