import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/// Cost centers: the answer to "whose cost is this?".
///
/// They are deliberately flat and deliberately few. A cost center is not a
/// second chart of accounts; it is a single dimension carried on a journal
/// line so the profit of a shop, a project or a vehicle can be read out of the
/// same ledger that reports the company's profit.
@Injectable()
export class CostCentersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(companyId: string, query: { includeInactive?: boolean } = {}) {
    const where: Prisma.CostCenterWhereInput = { companyId, deletedAt: null };
    if (!query.includeInactive) where.isActive = true;

    const items = await this.prisma.costCenter.findMany({
      where,
      orderBy: { code: 'asc' },
    });
    return { items: items.map((c) => this.toResponse(c)), total: items.length };
  }

  async findOne(companyId: string, id: string) {
    const costCenter = await this.prisma.costCenter.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!costCenter) throw new NotFoundException('Cost center not found');
    return this.toResponse(costCenter);
  }

  async create(companyId: string, userId: string, dto: Record<string, unknown>) {
    const code = this.text(dto.code, 'code');
    const nameEn = this.text(dto.nameEn, 'nameEn');
    const nameAr = this.text(dto.nameAr, 'nameAr');

    const existing = await this.prisma.costCenter.findFirst({
      where: { companyId, code },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Cost center code ${code} is already used`);
    }

    const created = await this.prisma.costCenter.create({
      data: { companyId, code, nameEn, nameAr, createdBy: userId, updatedBy: userId },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'cost_centers',
      entityId: created.id,
      after: { code, nameEn, nameAr },
    });

    return this.toResponse(created);
  }

  async update(companyId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const before = await this.prisma.costCenter.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Cost center not found');

    const data: Prisma.CostCenterUpdateInput = { updatedBy: userId };
    if (dto.nameEn !== undefined) data.nameEn = this.text(dto.nameEn, 'nameEn');
    if (dto.nameAr !== undefined) data.nameAr = this.text(dto.nameAr, 'nameAr');
    if (dto.isActive !== undefined) data.isActive = Boolean(dto.isActive);

    const updated = await this.prisma.costCenter.update({ where: { id }, data });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'cost_centers',
      entityId: id,
      before: this.toResponse(before),
      after: this.toResponse(updated),
    });

    return this.toResponse(updated);
  }

  /// A cost center that has been used is never deleted: the lines that carry
  /// it would lose the only thing that explains them. Deactivating is offered
  /// instead, and the refusal says so.
  async remove(companyId: string, userId: string, id: string) {
    const costCenter = await this.prisma.costCenter.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!costCenter) throw new NotFoundException('Cost center not found');

    const used = await this.prisma.journalLine.count({ where: { costCenterId: id } });
    if (used > 0) {
      throw new BadRequestException(
        `This cost center carries ${used} journal line(s), so it cannot be deleted. Deactivate it instead.`,
      );
    }

    await this.prisma.costCenter.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'DELETE',
      entity: 'cost_centers',
      entityId: id,
      before: this.toResponse(costCenter),
    });

    return { id, deleted: true };
  }

  private text(value: unknown, field: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException(`${field} is required`);
    return text;
  }

  private toResponse(row: {
    id: string;
    companyId: string;
    code: string;
    nameEn: string;
    nameAr: string;
    isActive: boolean;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
