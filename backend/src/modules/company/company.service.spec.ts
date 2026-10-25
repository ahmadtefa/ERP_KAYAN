import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import sharp from 'sharp';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InitialSetupDto } from './dto/company.dto';
import {
  CompanyService,
  LOGO_MAX_BYTES,
  logoDimensions,
  logoMimeForUpload,
  LOGO_UPLOAD_MAX_BYTES,
  normalizeLogo,
  validateLogo,
} from './company.service';

/// The logo rules protect the database from whatever someone uploads.
describe('validateLogo', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16),
  ]);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(16),
  ]);
  const webp = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP'),
    Buffer.alloc(8),
  ]);

  it('accepts a real PNG', () => {
    expect(validateLogo(png, 'image/png').mime).toBe('image/png');
  });

  it('accepts a real JPEG', () => {
    expect(validateLogo(jpeg, 'image/jpeg').mime).toBe('image/jpeg');
  });

  it('accepts a real WebP', () => {
    expect(validateLogo(webp, 'image/webp').mime).toBe('image/webp');
  });

  it('refuses a type outside the list', () => {
    expect(() => validateLogo(png, 'image/svg+xml')).toThrow(BadRequestException);
    expect(() => validateLogo(png, 'text/html')).toThrow(BadRequestException);
  });

  it('refuses bytes that do not match the claimed type', () => {
    const script = Buffer.from('<script>alert(1)</script>');
    expect(() => validateLogo(script, 'image/png')).toThrow(BadRequestException);
    expect(() => validateLogo(script, 'image/jpeg')).toThrow(BadRequestException);
  });

  it('refuses an empty file and an oversized one', () => {
    expect(() => validateLogo(Buffer.alloc(0), 'image/png')).toThrow(
      BadRequestException,
    );
    const big = Buffer.concat([png, Buffer.alloc(LOGO_MAX_BYTES)]);
    expect(() => validateLogo(big, 'image/png')).toThrow(BadRequestException);
  });

  it('refuses a RIFF container that is not really WebP', () => {
    const fake = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE'),
      Buffer.alloc(8),
    ]);
    expect(() => validateLogo(fake, 'image/webp')).toThrow(BadRequestException);
  });

  it('infers the multipart MIME from the supported filename extension when needed', () => {
    expect(logoMimeForUpload('application/octet-stream', 'logo.png')).toBe('image/png');
    expect(logoMimeForUpload('application/octet-stream', 'logo.jpeg')).toBe('image/jpeg');
    expect(logoMimeForUpload('image/webp', 'logo.png')).toBe('image/webp');
    expect(logoMimeForUpload('application/octet-stream', 'logo.svg')).toBe('application/octet-stream');
  });

  it('reads the pixel size of a PNG', () => {
    const header = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
    header.writeUInt32BE(64, 16);
    header.writeUInt32BE(48, 20);
    expect(logoDimensions(header, 'image/png')).toEqual({ width: 64, height: 48 });
  });
});

describe('normalizeLogo', () => {
  it('resizes a valid large-dimension PNG and stores a compact WebP', async () => {
    const source = await sharp({
      create: {
        width: 2048,
        height: 1024,
        channels: 4,
        background: { r: 24, g: 80, b: 140, alpha: 1 },
      },
    }).png().toBuffer();

    const normalized = await normalizeLogo(source, 'image/png');
    const metadata = await sharp(Buffer.from(normalized.data)).metadata();

    expect(normalized.mime).toBe('image/webp');
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBeLessThanOrEqual(1024);
    expect(metadata.height).toBeLessThanOrEqual(1024);
  });

  it('compresses a valid source larger than the persisted logo limit', async () => {
    const raw = randomBytes(1200 * 1200 * 3);
    const largePng = await sharp(raw, {
      raw: { width: 1200, height: 1200, channels: 3 },
    }).png({ compressionLevel: 0 }).toBuffer();
    expect(largePng.length).toBeGreaterThan(LOGO_MAX_BYTES);
    expect(largePng.length).toBeLessThanOrEqual(LOGO_UPLOAD_MAX_BYTES);

    const normalized = await normalizeLogo(largePng, 'image/png');

    expect(normalized.mime).toBe('image/webp');
    expect(normalized.data.length).toBeLessThanOrEqual(LOGO_MAX_BYTES);
    expect(normalized.data.length).toBeLessThan(largePng.length);
  });

  it('rejects invalid image bytes and uploads over the hard cap', async () => {
    await expect(normalizeLogo(Buffer.from('<script>'), 'image/png')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const overLimit = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(LOGO_UPLOAD_MAX_BYTES)]);
    await expect(normalizeLogo(overLimit, 'image/png')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('CompanyService', () => {
  const prisma = {
    company: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as PrismaService;

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const service = new CompanyService(prisma, audit);
  const updatedAt = new Date('2026-10-13T10:00:00Z');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProfile / profile', () => {
    it('returns the profile with no logo when none is stored', async () => {
      (prisma.company.findUnique as jest.Mock).mockResolvedValue({
        id: 'comp-1',
        code: 'KAYAN',
        nameEn: 'Kayan ERP',
        nameAr: 'كيان',
        taxId: null,
        commercialRegistration: null,
        addressEn: 'Minya',
        addressAr: null,
        phone: null,
        email: null,
        currency: 'EGP',
        timezone: 'Africa/Cairo',
        isActive: true,
        deletedAt: null,
        logoData: null,
        logoMime: null,
        logoPath: null,
        updatedAt,
      });

      const result = await service.getProfile('comp-1');

      expect(result).toMatchObject({
        id: 'comp-1',
        nameEn: 'Kayan ERP',
        address: 'Minya',
        hasLogo: false,
        logoUrl: null,
      });
    });

    it('points at the logo endpoint when a legacy file logo exists', async () => {
      (prisma.company.findUnique as jest.Mock).mockResolvedValue({
        id: 'comp-1',
        code: 'KAYAN',
        nameEn: 'Kayan ERP',
        nameAr: 'كيان',
        currency: 'EGP',
        timezone: 'Africa/Cairo',
        isActive: true,
        deletedAt: null,
        logoData: null,
        logoMime: null,
        logoPath: 'logo-1.png',
        updatedAt,
      });

      const result = await service.profile('comp-1');

      expect(result.hasLogo).toBe(true);
      expect(result.logoUrl).toBe(
        `/companies/logo/comp-1?v=${updatedAt.getTime()}`,
      );
    });

    it('throws NotFoundException when company does not exist', async () => {
      (prisma.company.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.profile('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('publicBranding', () => {
    it('returns default branding when no active company exists', async () => {
      (prisma.company.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.publicBranding();

      expect(result).toEqual({
        nameEn: 'KAYAN ERP',
        nameAr: 'نظام كيان',
        logoUrl: null,
      });
    });

    it('returns company branding when active company exists', async () => {
      (prisma.company.findFirst as jest.Mock).mockResolvedValue({
        id: 'comp-1',
        nameEn: 'Kayan Co',
        nameAr: 'شركة كيان',
        logoData: null,
        logoPath: 'logo.png',
        updatedAt,
      });

      const result = await service.publicBranding();

      expect(result).toEqual({
        nameEn: 'Kayan Co',
        nameAr: 'شركة كيان',
        logoUrl: `/companies/logo/comp-1?v=${updatedAt.getTime()}`,
      });
    });
  });

  describe('updateProfile', () => {
    const existing = {
      id: 'comp-1',
      code: 'KAYAN',
      nameEn: 'Old Name',
      nameAr: 'الاسم القديم',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      isActive: true,
      deletedAt: null,
      logoData: null,
      logoMime: null,
      logoPath: null,
      updatedAt,
    };

    it('rejects blank company names', async () => {
      (prisma.company.findUnique as jest.Mock).mockResolvedValue(existing);

      await expect(
        service.updateProfile('comp-1', 'user-1', { nameEn: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.company.update).not.toHaveBeenCalled();
    });

    it('updates the profile and audits it without any logo bytes', async () => {
      (prisma.company.findUnique as jest.Mock)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ ...existing, nameEn: 'New Name' });
      (prisma.company.update as jest.Mock).mockResolvedValue({
        ...existing,
        nameEn: 'New Name',
        logoData: new Uint8Array([1, 2, 3]),
      });

      await service.updateProfile('comp-1', 'user-1', { nameEn: 'New Name' });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          entity: 'companies',
          entityId: 'comp-1',
        }),
      );
      const call = (audit.record as jest.Mock).mock.calls[0][0];
      expect(JSON.stringify(call)).not.toContain('logoData');
    });

    it('maps the single-line address to addressEn', async () => {
      (prisma.company.findUnique as jest.Mock).mockResolvedValue(existing);
      (prisma.company.update as jest.Mock).mockResolvedValue(existing);

      await service.updateProfile('comp-1', 'user-1', { address: ' Minya ' });

      expect((prisma.company.update as jest.Mock).mock.calls[0][0].data.addressEn).toBe(
        'Minya',
      );
    });
  });
});

describe('InitialSetupDto', () => {
  function makeValidDto(): Record<string, unknown> {
    return {
      companyCode: 'ACME',
      companyNameAr: 'شركة أكمي',
      companyNameEn: 'Acme Corp',
      adminUsername: 'admin',
      adminPassword: 'password123',
    };
  }

  it('accepts valid setup with default (or no) facilityKind', async () => {
    const dto = plainToInstance(InitialSetupDto, makeValidDto());
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('accepts facilityKind as HEADQUARTERS or BRANCH', async () => {
    const hq = plainToInstance(InitialSetupDto, {
      ...makeValidDto(),
      facilityKind: 'HEADQUARTERS',
      unitCode: 'MAIN',
    });
    expect((await validate(hq)).length).toBe(0);

    const branch = plainToInstance(InitialSetupDto, {
      ...makeValidDto(),
      facilityKind: 'BRANCH',
      unitCode: 'BR01',
    });
    expect((await validate(branch)).length).toBe(0);
  });

  it('rejects an invalid facilityKind', async () => {
    const invalid = plainToInstance(InitialSetupDto, {
      ...makeValidDto(),
      facilityKind: 'WAREHOUSE',
    });
    const errors = await validate(invalid);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'facilityKind')).toBe(true);
  });

  it('accepts password of 8 characters and rejects shorter', async () => {
    const validPass = plainToInstance(InitialSetupDto, {
      ...makeValidDto(),
      adminPassword: '12345678',
    });
    expect((await validate(validPass)).length).toBe(0);

    const shortPass = plainToInstance(InitialSetupDto, {
      ...makeValidDto(),
      adminPassword: '1234567',
    });
    const errors = await validate(shortPass);
    expect(errors.some((e) => e.property === 'adminPassword')).toBe(true);
  });
});
