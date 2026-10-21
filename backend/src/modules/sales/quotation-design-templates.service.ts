import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

type DesignTemplateRow = {
  id: string;
  name: string;
  design: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class QuotationDesignTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string) {
    const rows = await this.prisma.$queryRaw<DesignTemplateRow[]>(Prisma.sql`
      SELECT id, name, design, "isActive", "createdAt", "updatedAt"
        FROM quotation_design_templates
       WHERE "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
       ORDER BY name
    `);
    return rows.map((row) => this.present(row));
  }

  async create(companyId: string, userId: string, dto: { name: string; design: Record<string, unknown> }) {
    const name = dto.name.trim();
    const design = this.validateDesign(dto.design);
    const rows = await this.prisma.$queryRaw<DesignTemplateRow[]>(Prisma.sql`
      INSERT INTO quotation_design_templates
        (id, "companyId", name, design, "isActive", "createdAt", "updatedAt", "createdBy", "updatedBy")
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${name},
              ${JSON.stringify(design)}::jsonb, true, now(), now(), ${userId}::uuid, ${userId}::uuid)
      RETURNING id, name, design, "isActive", "createdAt", "updatedAt"
    `);
    const template = this.present(rows[0]);
    await this.audit.record({
      companyId, userId, action: 'create', entity: 'QuotationDesignTemplate',
      entityId: template.id, after: { name: template.name },
    });
    return template;
  }

  async update(companyId: string, userId: string, id: string, dto: { name?: string; design?: Record<string, unknown> }) {
    const existing = await this.findOne(companyId, id);
    const name = dto.name?.trim() || existing.name;
    const design = dto.design ? this.validateDesign(dto.design) : existing.design;
    const rows = await this.prisma.$queryRaw<DesignTemplateRow[]>(Prisma.sql`
      UPDATE quotation_design_templates
         SET name = ${name}, design = ${JSON.stringify(design)}::jsonb,
             "updatedAt" = now(), "updatedBy" = ${userId}::uuid
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
      RETURNING id, name, design, "isActive", "createdAt", "updatedAt"
    `);
    if (!rows[0]) throw new NotFoundException('Quotation design template not found');
    const template = this.present(rows[0]);
    await this.audit.record({
      companyId, userId, action: 'update', entity: 'QuotationDesignTemplate',
      entityId: id, before: { name: existing.name }, after: { name: template.name },
    });
    return template;
  }

  async remove(companyId: string, userId: string, id: string) {
    const existing = await this.findOne(companyId, id);
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE quotation_design_templates
         SET "isActive" = false, "deletedAt" = now(), "updatedAt" = now(), "updatedBy" = ${userId}::uuid
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
    `);
    await this.audit.record({
      companyId, userId, action: 'delete', entity: 'QuotationDesignTemplate',
      entityId: id, before: { name: existing.name },
    });
    return { id, deleted: true };
  }

  private async findOne(companyId: string, id: string) {
    const rows = await this.prisma.$queryRaw<DesignTemplateRow[]>(Prisma.sql`
      SELECT id, name, design, "isActive", "createdAt", "updatedAt"
        FROM quotation_design_templates
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
       LIMIT 1
    `);
    if (!rows[0]) throw new NotFoundException('Quotation design template not found');
    return this.present(rows[0]);
  }

  private validateDesign(value: Record<string, unknown>) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Quotation design must be an object');
    }
    const encoded = JSON.stringify(value);
    if (encoded.length > 50000) throw new TypeError('Quotation design is too large');
    return JSON.parse(encoded) as Record<string, unknown>;
  }

  private present(row: DesignTemplateRow) {
    return {
      id: row.id, name: row.name,
      design: row.design && typeof row.design === 'object' ? row.design : {},
      isActive: row.isActive,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }
}
