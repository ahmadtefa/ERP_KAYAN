import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SuperAdminGuard } from './super-admin.guard';
import { FullBackupController } from '../../modules/backup/full-backup.controller';
import { GUARDS_METADATA } from '@nestjs/common/constants';

const context = (user?: unknown) => ({
  switchToHttp: () => ({ getRequest: () => ({ user }) }),
}) as ExecutionContext;

describe('machine-wide backup authorization', () => {
  it('rejects a tenant backup operator, even with the backup permission', () => {
    expect(() => new SuperAdminGuard().canActivate(context({ isSuperAdmin: false, permissions: ['admin.backup'] }))).toThrow(ForbiddenException);
    expect(() => new SuperAdminGuard().canActivate(context())).toThrow(ForbiddenException);
  });
  it('accepts a live super administrator', () => {
    expect(new SuperAdminGuard().canActivate(context({ isSuperAdmin: true }))).toBe(true);
  });
  it('protects the entire full-database controller, including downloads and restores', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FullBackupController)).toContain(SuperAdminGuard);
  });
});
