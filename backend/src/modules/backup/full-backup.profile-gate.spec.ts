/**
 * Full-database archives are desktop-only.
 *
 * One pg_dump archive contains EVERY company in the database. In the cloud
 * (multi-tenant) profile that is a cross-tenant leak by construction - taking,
 * downloading, or restoring such an archive crosses every company - so the
 * feature refuses to run there BY PROFILE, not by accident because a binary is
 * missing. The Windows Offline / local profile is unchanged: it keeps the full
 * desktop backup behaviour.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import {
  FullBackupService,
  fullArchiveAllowedForProfile,
  FULL_ARCHIVE_CLOUD_REFUSAL,
} from './full-backup.service';

function makeService(): FullBackupService {
  return new FullBackupService(
    { $queryRaw: jest.fn(async () => [{ v: '17.0' }]) } as any,
    { record: async () => {} } as any,
    { begin() {}, end() {}, isActive: false, status: {} } as any,
    {} as any,
  );
}

describe('full-database archive profile gate', () => {
  const original = process.env.DATABASE_PROFILE;
  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_PROFILE;
    else process.env.DATABASE_PROFILE = original;
  });

  it('allows the local (default, Windows Offline) profile and refuses supabase', () => {
    delete process.env.DATABASE_PROFILE;
    expect(fullArchiveAllowedForProfile()).toBe(true);
    process.env.DATABASE_PROFILE = 'local';
    expect(fullArchiveAllowedForProfile()).toBe(true);
    process.env.DATABASE_PROFILE = 'supabase';
    expect(fullArchiveAllowedForProfile()).toBe(false);
    process.env.DATABASE_PROFILE = ' Supabase ';
    expect(fullArchiveAllowedForProfile()).toBe(false);
  });

  it('capabilities() reports the cloud refusal instead of searching for tools', async () => {
    process.env.DATABASE_PROFILE = 'supabase';
    const caps = await makeService().capabilities();
    expect(caps.available).toBe(false);
    expect(caps.reason).toBe(FULL_ARCHIVE_CLOUD_REFUSAL);
    expect(caps.fullBackupSupported).toBe(false);
    expect(caps.fullRestoreSupported).toBe(false);
  });

  it('createFull and restore refuse in the cloud profile before touching anything', async () => {
    process.env.DATABASE_PROFILE = 'supabase';
    const service = makeService();
    await expect(service.createFull('user-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(service.createFull('user-1')).rejects.toThrow(
      /external backup mechanism/,
    );
    await expect(
      service.restore({ confirm: true } as never, 'user-1'),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('the local profile is not affected by the gate', async () => {
    process.env.DATABASE_PROFILE = 'local';
    const caps = await makeService().capabilities();
    // Without tool binaries on this machine the honest answer is still
    // "unavailable", but with the desktop tooling message - never the cloud
    // refusal. That proves the gate is profile-based and Windows behaviour
    // (tools found -> backups work) is untouched.
    expect(caps.reason === FULL_ARCHIVE_CLOUD_REFUSAL).toBe(false);
  });
});
