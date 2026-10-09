import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdateCompanyDto } from './company.dto';

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async profile(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    return this.toCompany(company);
  }

  async publicBranding() {
    const company = await this.prisma.company.findFirst({ where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    if (!company) return { nameEn: 'KAYAN ERP', nameAr: 'نظام كيان', logoUrl: null };
    return { nameEn: company.nameEn, nameAr: company.nameAr, logoUrl: company.logoPath ? `/companies/logo/${company.id}?v=${encodeURIComponent(company.logoPath)}` : null };
  }

  async brandingFor(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    return { nameEn: company.nameEn, nameAr: company.nameAr, logoUrl: company.logoPath ? `/companies/logo/${company.id}?v=${encodeURIComponent(company.logoPath)}` : null };
  }

  async updateProfile(companyId: string, userId: string, dto: UpdateCompanyDto) {
    const before = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!before) throw new NotFoundException('Company not found');
    if ((dto.nameEn !== undefined && !dto.nameEn.trim()) || (dto.nameAr !== undefined && !dto.nameAr.trim())) {
      throw new BadRequestException('Company names cannot be blank');
    }
    const data = Object.fromEntries(Object.entries(dto).map(([key, value]) => [key, typeof value === 'string' ? value.trim() || null : value])) as Prisma.CompanyUpdateInput;
    const updated = await this.prisma.company.update({ where: { id: companyId }, data: { ...data, updatedBy: userId } });
    await this.audit.record({ companyId, userId, action: 'UPDATE', entity: 'companies', entityId: companyId, before: this.auditProfile(before), after: this.auditProfile(updated) });
    return this.toCompany(updated);
  }

  async setLogo(companyId: string, userId: string, logoPath: string) {
    const before = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!before) throw new NotFoundException('Company not found');
    const updated = await this.prisma.company.update({ where: { id: companyId }, data: { logoPath, updatedBy: userId } });
    await this.removeOldLogo(before.logoPath, logoPath);
    await this.audit.record({ companyId, userId, action: 'UPDATE_LOGO', entity: 'companies', entityId: companyId });
    return this.toCompany(updated);
  }

  async removeLogo(companyId: string, userId: string) {
    const before = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!before) throw new NotFoundException('Company not found');
    const updated = await this.prisma.company.update({ where: { id: companyId }, data: { logoPath: null, updatedBy: userId } });
    await this.removeOldLogo(before.logoPath);
    await this.audit.record({ companyId, userId, action: 'DELETE_LOGO', entity: 'companies', entityId: companyId });
    return this.toCompany(updated);
  }

  async logoPath(companyId?: string): Promise<string | null> {
    const company = companyId
      ? await this.prisma.company.findUnique({ where: { id: companyId }, select: { logoPath: true } })
      : await this.prisma.company.findFirst({ where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { logoPath: true } });
    return company?.logoPath ?? null;
  }

  private async removeOldLogo(oldPath: string | null, nextPath?: string) {
    if (!oldPath || oldPath === nextPath) return;
    await unlink(join(process.env.KAYAN_UPLOAD_DIR ?? join(process.cwd(), 'uploads'), oldPath)).catch(() => {});
  }

  private auditProfile(company: object) {
    const { logoPath: _logoPath, ...safe } = company as Record<string, unknown>;
    return safe;
  }

  private toCompany<T extends { id: string; logoPath: string | null }>(company: T) {
    const { logoPath, ...profile } = company;
    return { ...profile, logoUrl: logoPath ? `/companies/logo/${company.id}?v=${encodeURIComponent(logoPath)}` : null };
  }
}

