import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyService } from './company.service';

describe('CompanyService', () => {
  const prisma = {
    company: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as PrismaService;

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const service = new CompanyService(prisma, audit);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('profile', () => {
    it('returns formatted company profile with logo URL', async () => {
      (prisma.company.findUnique as jest.Mock).mockResolvedValue({
        id: 'comp-1',
        nameEn: 'Kayan ERP',
        nameAr: 'كيان',
        logoPath: 'logo-1.png',
      });

      const result = await service.profile('comp-1');

      expect(result).toEqual({
        id: 'comp-1',
        nameEn: 'Kayan ERP',
        nameAr: 'كيان',
        logoUrl: '/companies/logo/comp-1?v=logo-1.png',
      });
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
        logoPath: 'logo.png',
      });

      const result = await service.publicBranding();

      expect(result).toEqual({
        nameEn: 'Kayan Co',
        nameAr: 'شركة كيان',
        logoUrl: '/companies/logo/comp-1?v=logo.png',
      });
    });
  });

  describe('updateProfile', () => {
    it('rejects blank company names', async () => {
      (prisma.company.findUnique as jest.Mock).mockResolvedValue({
        id: 'comp-1',
        nameEn: 'Old Name',
        nameAr: 'الاسم القديم',
        logoPath: null,
      });

      await expect(
        service.updateProfile('comp-1', 'user-1', { nameEn: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates company profile and logs audit record', async () => {
      const before = {
        id: 'comp-1',
        nameEn: 'Old Name',
        nameAr: 'الاسم القديم',
        logoPath: null,
      };
      const after = {
        id: 'comp-1',
        nameEn: 'New Name',
        nameAr: 'الاسم الجديد',
        logoPath: null,
      };

      (prisma.company.findUnique as jest.Mock).mockResolvedValue(before);
      (prisma.company.update as jest.Mock).mockResolvedValue(after);

      const result = await service.updateProfile('comp-1', 'user-1', {
        nameEn: 'New Name',
        nameAr: 'الاسم الجديد',
      });

      expect(result.nameEn).toBe('New Name');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          entity: 'companies',
          entityId: 'comp-1',
        }),
      );
    });
  });
});
