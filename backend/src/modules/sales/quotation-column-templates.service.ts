import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QuotationColumnTemplateDto } from './dto/quotation.dto';
import { normalizeColumns, QuotationColumn } from './quotation-columns';

type TemplateRow = {
  id: string;
  name: string;
  columns: unknown;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/// Named line-column layouts ("Cabinets", "Service") that an offer can start
/// from.
///
/// Read and written through SQL for the same reason as the terms library: the
/// table is small and fixed, and a shipped client can talk to it without being
/// rebuilt. A quotation copies the columns it uses, so editing or deleting a
/// template never rewrites an offer that was already sent.
@Injectable()
export class QuotationColumnTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string) {
    const rows = await this.prisma.$queryRaw<TemplateRow[]>(Prisma.sql`
      SELECT id, name, columns, "isDefault", "isActive", "createdAt", "updatedAt"
        FROM quotation_column_templates
       WHERE "companyId" = ${companyId}::uuid
         AND "deletedAt" IS NULL
       ORDER BY "isDefault" DESC, name
    `);
    return rows.map((row) => this.present(row));
  }

  async create(companyId: string, userId: string, dto: QuotationColumnTemplateDto) {
    const columns = normalizeColumns(dto.columns);
    const rows = await this.prisma.$queryRaw<TemplateRow[]>(Prisma.sql`
      INSERT INTO quotation_column_templates
        (id, "companyId", name, columns, "isDefault", "isActive",
         "createdAt", "updatedAt", "createdBy", "updatedBy")
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${dto.name.trim()},
              ${JSON.stringify(columns)}::jsonb, ${dto.isDefault === true}, true,
              now(), now(), ${userId}::uuid, ${userId}::uuid)
      RETURNING id, name, columns, "isDefault", "isActive", "createdAt", "updatedAt"
    `);
    if (dto.isDefault === true) {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE quotation_column_templates
           SET "isDefault" = false, "updatedAt" = now()
         WHERE "companyId" = ${companyId}::uuid
           AND id <> ${rows[0].id}::uuid
           AND "deletedAt" IS NULL
      `);
    }
    const template = this.present(rows[0]);
    await this.audit.record({
      companyId,
      userId,
      action: 'create',
      entity: 'QuotationColumnTemplate',
      entityId: template.id,
      after: { name: template.name, columns: template.columns.map((column) => column.key) },
    });
    return template;
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: Partial<QuotationColumnTemplateDto>,
  ) {
    const existing = await this.findOne(companyId, id);
    const columns = dto.columns ? normalizeColumns(dto.columns) : existing.columns;
    const rows = await this.prisma.$queryRaw<TemplateRow[]>(Prisma.sql`
      UPDATE quotation_column_templates
         SET name = ${dto.name?.trim() ?? existing.name},
             columns = ${JSON.stringify(columns)}::jsonb,
             "isDefault" = ${dto.isDefault ?? existing.isDefault},
             "updatedAt" = now(),
             "updatedBy" = ${userId}::uuid
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
         AND "deletedAt" IS NULL
      RETURNING id, name, columns, "isDefault", "isActive", "createdAt", "updatedAt"
    `);
    if (!rows[0]) throw new NotFoundException('Quotation column template not found');
    if (dto.isDefault === true) {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE quotation_column_templates
           SET "isDefault" = false, "updatedAt" = now()
         WHERE "companyId" = ${companyId}::uuid
           AND id <> ${id}::uuid
           AND "deletedAt" IS NULL
      `);
    }
    const template = this.present(rows[0]);
    await this.audit.record({
      companyId,
      userId,
      action: 'update',
      entity: 'QuotationColumnTemplate',
      entityId: id,
      before: { name: existing.name },
      after: { name: template.name, columns: template.columns.map((column) => column.key) },
    });
    return template;
  }

  /// Soft delete: offers that were built from this layout keep their own copy
  /// of the columns.
  async remove(companyId: string, userId: string, id: string) {
    const existing = await this.findOne(companyId, id);
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE quotation_column_templates
         SET "isActive" = false, "deletedAt" = now(),
             "updatedAt" = now(), "updatedBy" = ${userId}::uuid
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
         AND "deletedAt" IS NULL
    `);
    await this.audit.record({
      companyId,
      userId,
      action: 'delete',
      entity: 'QuotationColumnTemplate',
      entityId: id,
      before: { name: existing.name },
    });
    return { id, deleted: true };
  }

  private async findOne(companyId: string, id: string) {
    const rows = await this.prisma.$queryRaw<TemplateRow[]>(Prisma.sql`
      SELECT id, name, columns, "isDefault", "isActive", "createdAt", "updatedAt"
        FROM quotation_column_templates
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
         AND "deletedAt" IS NULL
    `);
    if (!rows[0]) throw new NotFoundException('Quotation column template not found');
    return {
      ...rows[0],
      columns: normalizeColumns(rows[0].columns),
    } as TemplateRow & { columns: QuotationColumn[] };
  }

  private present(row: TemplateRow) {
    return {
      id: row.id,
      name: row.name,
      columns: normalizeColumns(row.columns),
      isDefault: row.isDefault,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
