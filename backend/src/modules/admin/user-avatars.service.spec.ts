import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AVATAR_LIMITS, UserAvatarsService } from './user-avatars.service';

/// A person's photo, pinned at the level that decides whether it is allowed.
///
/// The rules the brief asks for - a real image only, a size cap, and nobody
/// changing somebody else's face without the permission to manage accounts -
/// live in this service, so they are tested here against a fake database
/// rather than through a browser. A hidden button is not a rule; these are.

/// A PNG header with a real pixel size: magic, IHDR length and tag, then the
/// two dimensions `logoDimensions` reads. Enough for the validator, which
/// deliberately never decodes the image.
function pngHeader(width: number, height: number, padding = 0): Buffer {
  const buffer = Buffer.alloc(24 + padding);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const SELF = 'user-me';
const COLLEAGUE = 'user-them';
const COMPANY = 'company-1';

interface Harness {
  service: UserAvatarsService;
  prisma: {
    user: { findFirst: jest.Mock; update: jest.Mock };
  };
  audit: { record: jest.Mock };
}

function harness(options: { exists?: boolean } = {}): Harness {
  const prisma = {
    user: {
      findFirst: jest.fn(async (args: { where: { id?: string } }) =>
        (options.exists ?? true) && args.where.id
          ? { id: args.where.id, avatarData: null }
          : null,
      ),
      update: jest.fn(async () => ({ id: SELF })),
    },
  };
  const audit = { record: jest.fn(async () => undefined) };
  return {
    service: new UserAvatarsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    ),
    prisma,
    audit,
  };
}

const ME = { userId: SELF, permissions: [] as string[], isSuperAdmin: false };
const COLLEAGUE_EDITOR = {
  userId: SELF,
  permissions: ['admin.users.manage'],
  isSuperAdmin: false,
};
const SUPER = { userId: SELF, permissions: [] as string[], isSuperAdmin: true };

function upload(buffer: Buffer, name = 'me.png', mime = 'image/png') {
  return { buffer, originalname: name, mimetype: mime, size: buffer.length };
}

describe('a person’s photo', () => {
  describe('who may change it', () => {
    it('lets a person change their own photo', async () => {
      const { service, prisma } = harness();
      const result = await service.setAvatar(COMPANY, ME, SELF, upload(pngHeader(256, 256)));
      expect(result.hasAvatar).toBe(true);
      expect(result.mime).toBe('image/png');
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('refuses a colleague’s photo without the user-management permission', async () => {
      const { service, prisma } = harness();
      await expect(
        service.setAvatar(COMPANY, ME, COLLEAGUE, upload(pngHeader(256, 256))),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // The refusal happens before anything is written.
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('lets a user administrator change somebody else’s photo', async () => {
      const { service, prisma } = harness();
      await service.setAvatar(COMPANY, COLLEAGUE_EDITOR, COLLEAGUE, upload(pngHeader(128, 128)));
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('lets a super administrator change anybody’s photo', async () => {
      const { service, prisma } = harness();
      await service.setAvatar(COMPANY, SUPER, COLLEAGUE, upload(pngHeader(128, 128)));
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('will not touch an account of another company, or a deleted one', async () => {
      const { service } = harness({ exists: false });
      await expect(
        service.setAvatar(COMPANY, SUPER, 'someone-else', upload(pngHeader(64, 64))),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('what may be stored', () => {
    it('accepts a real PNG and stores the bytes in the row, not a path', async () => {
      const { service, prisma } = harness();
      await service.setAvatar(COMPANY, ME, SELF, upload(pngHeader(256, 256)));
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.avatarData).toBeInstanceOf(Uint8Array);
      expect(data.avatarMime).toBe('image/png');
      expect(data.avatarUpdatedAt).toBeInstanceOf(Date);
    });

    it('refuses a text file that was renamed to .png', async () => {
      const { service, prisma } = harness();
      await expect(
        service.setAvatar(
          COMPANY,
          ME,
          SELF,
          upload(Buffer.from('<svg onload="alert(1)"></svg>'), 'me.png', 'image/png'),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses an unsupported type even when the browser claims otherwise', async () => {
      const { service } = harness();
      await expect(
        service.setAvatar(COMPANY, ME, SELF, upload(pngHeader(64, 64), 'me.gif', 'image/gif')),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an empty upload', async () => {
      const { service } = harness();
      await expect(
        service.setAvatar(COMPANY, ME, SELF, upload(Buffer.alloc(0))),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a photo over the size limit', async () => {
      const { service } = harness();
      const tooBig = pngHeader(256, 256, AVATAR_LIMITS.maxBytes);
      await expect(
        service.setAvatar(COMPANY, ME, SELF, upload(tooBig)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a photo larger than the pixel budget', async () => {
      const { service } = harness();
      await expect(
        service.setAvatar(COMPANY, ME, SELF, upload(pngHeader(6000, 6000))),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('keeps the limits tight enough for a database row and a face', () => {
      expect(AVATAR_LIMITS.maxBytes).toBeLessThanOrEqual(1024 * 1024);
      expect(AVATAR_LIMITS.maxDimension).toBeLessThanOrEqual(2048);
      expect(AVATAR_LIMITS.maxPixels).toBeLessThanOrEqual(4_000_000);
    });

    it('never writes the image into the audit trail', async () => {
      const { service, audit } = harness();
      await service.setAvatar(COMPANY, ME, SELF, upload(pngHeader(256, 256)));
      const entry = audit.record.mock.calls[0][0];
      expect(JSON.stringify(entry.after)).not.toMatch(/base64|iVBOR/i);
      expect(Object.keys(entry.after).sort()).toEqual(['bytes', 'mime']);
    });
  });

  describe('removing it', () => {
    it('clears the columns and leaves the account alone', async () => {
      const { service, prisma } = harness();
      const result = await service.clearAvatar(COMPANY, ME, SELF);
      expect(result).toEqual({ hasAvatar: false });
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        avatarData: null,
        avatarMime: null,
        avatarUpdatedAt: null,
      });
    });

    it('refuses to remove a colleague’s photo without permission', async () => {
      const { service } = harness();
      await expect(
        service.clearAvatar(COMPANY, ME, COLLEAGUE),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('reading it back', () => {
    it('returns an image for a colleague, with the stored type', async () => {
      const { service, prisma } = harness();
      prisma.user.findFirst.mockResolvedValueOnce({
        avatarData: new Uint8Array([1, 2, 3]),
        avatarMime: 'image/png',
        avatarUpdatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      const file = await service.getAvatar(COMPANY, COLLEAGUE);
      expect(Buffer.isBuffer(file.data)).toBe(true);
      expect(file.mime).toBe('image/png');
    });

    it('says so plainly when there is no photo', async () => {
      const { service, prisma } = harness();
      prisma.user.findFirst.mockResolvedValueOnce({
        avatarData: null,
        avatarMime: null,
        avatarUpdatedAt: null,
      });
      await expect(service.getAvatar(COMPANY, COLLEAGUE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('says so plainly when the account is not in this company', async () => {
      const { service } = harness({ exists: false });
      await expect(service.getAvatar(COMPANY, COLLEAGUE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
