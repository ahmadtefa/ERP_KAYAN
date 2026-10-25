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

  describe('template download', () => {
    const response = () => ({
      setHeader: jest.fn(),
      end: jest.fn(),
    });

    it('serves the opening-balances template to a user holding the manage grant', async () => {
      const body = Buffer.from('PK\x03\x04-template');
      const template = jest.fn().mockResolvedValue(body);
      const controller = new ImportController({ template } as any);
      const res = response();
      await controller.template(
        { ...user, permissions: ['accounting.openingbalances.manage'] },
        'opening-balances',
        res as any,
      );
      expect(template).toHaveBeenCalledWith('opening-balances');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="kayan-import-opening-balances.xlsx"',
      );
      expect(res.end).toHaveBeenCalledWith(body);
    });

    it('serves templates to a super administrator without explicit grants', async () => {
      const template = jest.fn().mockResolvedValue(Buffer.from('PK'));
      const controller = new ImportController({ template } as any);
      const res = response();
      await controller.template(
        { ...user, isSuperAdmin: true, permissions: [] },
        'opening-balances',
        res as any,
      );
      expect(res.end).toHaveBeenCalled();
    });

    it('rejects a user without the grant before generating any file, naming the permission', async () => {
      const template = jest.fn();
      const controller = new ImportController({ template } as any);
      const res = response();
      await expect(
        controller.template(
          { ...user, permissions: ['accounting.journal.read'] },
          'opening-balances',
          res as any,
        ),
      ).rejects.toThrow('accounting.openingbalances.manage');
      expect(template).not.toHaveBeenCalled();
      expect(res.end).not.toHaveBeenCalled();
    });
  });

  it('still rejects users without the create grant before parsing or writing', async () => {
    const run = jest.fn();
    const controller = new ImportController({ run } as any);
    await expect(controller.upload({ ...user, permissions: [] }, 'customers', file, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(run).not.toHaveBeenCalled();
  });

  it('lets a read-only viewer download the opening-balance template but not upload it', async () => {
    const template = jest.fn().mockResolvedValue(Buffer.from('xlsx-bytes'));
    const run = jest.fn();
    const controller = new ImportController({ template, run } as any);
    const response = { setHeader: jest.fn(), end: jest.fn() } as any;
    const reader: AuthUser = {
      ...user,
      permissions: ['accounting.openingbalances.read'],
    };

    await controller.template(reader, 'opening-balances', response);
    expect(template).toHaveBeenCalledWith('opening-balances');
    expect(response.end).toHaveBeenCalledWith(Buffer.from('xlsx-bytes'));

    await expect(controller.upload(reader, 'opening-balances', file, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps the template reachable for a manager and closed to everyone else', async () => {
    const template = jest.fn().mockResolvedValue(Buffer.from('xlsx-bytes'));
    const controller = new ImportController({ template, run: jest.fn() } as any);
    const response = { setHeader: jest.fn(), end: jest.fn() } as any;

    await controller.template(
      { ...user, permissions: ['accounting.openingbalances.manage'] },
      'opening-balances',
      response,
    );
    expect(template).toHaveBeenCalledTimes(1);

    const outsider = { ...user, permissions: ['cash.vouchers.read'] };
    await expect(controller.template(outsider, 'opening-balances', response)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
