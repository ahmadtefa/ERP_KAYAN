import { RoleCatalogueBootstrap } from './role-catalogue.bootstrap';

describe('retireWildcardAdminReads', () => {
  it('only touches standard READ_ONLY/REPORT_USER of the given company and the two codes', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'r1', code: 'READ_ONLY' }]);
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = { role: { findMany }, rolePermission: { deleteMany } };
    const svc = new RoleCatalogueBootstrap(prisma as never);
    const out = await svc.retireWildcardAdminReads('c1');
    expect(findMany.mock.calls[0][0].where).toEqual({
      companyId: 'c1', isSystem: true, deletedAt: null, code: { in: ['READ_ONLY', 'REPORT_USER'] },
    });
    expect(deleteMany.mock.calls[0][0].where.permission.code.in).toEqual(['admin.audit.read', 'admin.approvals.read']);
    expect(out).toEqual({ removed: 2, roles: ['READ_ONLY'] });
  });
});
