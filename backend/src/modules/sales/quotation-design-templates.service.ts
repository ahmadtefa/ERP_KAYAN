import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

type DesignTemplateRow = {
  id: string;
  name: string;
  design: unknown;
  backgroundId: string | null;
  background: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export interface DesignTemplateInput {
  name: string;
  design: Record<string, unknown>;
  /// The artwork the offer prints on, if the company attached one, and how its
  /// pages are used. Null keeps the drawn design - which is what every
  /// template created before this existed keeps.
  backgroundId?: string | null;
  background?: Record<string, unknown> | null;
}

@Injectable()
export class QuotationDesignTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string) {
    const rows = await this.prisma.$queryRaw<DesignTemplateRow[]>(Prisma.sql`
      SELECT id, name, design, "backgroundId", "background", "isActive", "createdAt", "updatedAt"
        FROM quotation_design_templates
       WHERE "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
       ORDER BY name
    `);
    return rows.map((row) => this.present(row));
  }

  async create(companyId: string, userId: string, dto: DesignTemplateInput) {
    const name = dto.name.trim();
    const design = this.validateDesign(dto.design);
    const artwork = this.validateBackground(dto.background);
    const backgroundId = await this.backgroundIdOf(dto.backgroundId);
    const rows = await this.prisma.$queryRaw<DesignTemplateRow[]>(Prisma.sql`
      INSERT INTO quotation_design_templates
        (id, "companyId", name, design, "backgroundId", "background",
         "isActive", "createdAt", "updatedAt", "createdBy", "updatedBy")
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${name},
              ${JSON.stringify(design)}::jsonb,
              ${backgroundId}::uuid,
              ${artwork === null ? null : JSON.stringify(artwork)}::jsonb,
              true, now(), now(), ${userId}::uuid, ${userId}::uuid)
      RETURNING id, name, design, "backgroundId", "background", "isActive", "createdAt", "updatedAt"
    `);
    const template = this.present(rows[0]);
    await this.audit.record({
      companyId, userId, action: 'create', entity: 'QuotationDesignTemplate',
      entityId: template.id, after: { name: template.name },
    });
    return template;
  }

  async update(companyId: string, userId: string, id: string, dto: Partial<DesignTemplateInput>) {
    const existing = await this.findOne(companyId, id);
    const name = dto.name?.trim() || existing.name;
    const design = dto.design ? this.validateDesign(dto.design) : existing.design;
    const artwork =
      dto.background !== undefined
        ? this.validateBackground(dto.background)
        : (existing.background as Record<string, unknown> | null);
    const backgroundId =
      dto.backgroundId !== undefined
        ? await this.backgroundIdOf(dto.backgroundId)
        : existing.backgroundId;
    const rows = await this.prisma.$queryRaw<DesignTemplateRow[]>(Prisma.sql`
      UPDATE quotation_design_templates
         SET name = ${name}, design = ${JSON.stringify(design)}::jsonb,
             "backgroundId" = ${backgroundId}::uuid,
             "background" = ${artwork === null ? null : JSON.stringify(artwork)}::jsonb,
             "updatedAt" = now(), "updatedBy" = ${userId}::uuid
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
      RETURNING id, name, design, "backgroundId", "background", "isActive", "createdAt", "updatedAt"
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
      SELECT id, name, design, "backgroundId", "background", "isActive", "createdAt", "updatedAt"
        FROM quotation_design_templates
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
       LIMIT 1
    `);
    if (!rows[0]) throw new NotFoundException('Quotation design template not found');
    return this.present(rows[0]);
  }

  private validateDesign(value: Record<string, unknown>) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Quotation design must be an object');
    }
    const encoded = JSON.stringify(value);
    if (encoded.length > 50000) {
      throw new BadRequestException('Quotation design is too large');
    }
    return JSON.parse(encoded) as Record<string, unknown>;
  }

  /// The artwork settings are stored as JSON and read back as JSON. A template
  /// keeps its own copy of them, so replacing the file later never changes a
  /// sheet an operator already approved - re-binding is an explicit act.
  private validateBackground(value: Record<string, unknown> | null | undefined) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Quotation background settings must be an object');
    }
    const encoded = JSON.stringify(value);
    if (encoded.length > 4000) {
      throw new BadRequestException('Quotation background settings are too large');
    }
    return JSON.parse(encoded) as Record<string, unknown>;
  }

  /// A template may only point at a file that exists. The print path checks
  /// the company again, against the company that is printing.
  private async backgroundIdOf(id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    const row = await this.prisma.quotationBackground.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!row) {
      throw new BadRequestException(
        'ملف الخلفية غير موجود. / The background file does not exist.',
      );
    }
    return row.id;
  }

  private present(row: DesignTemplateRow) {
    return {
      id: row.id, name: row.name,
      design: row.design && typeof row.design === 'object' ? row.design : {},
      backgroundId: row.backgroundId ?? null,
      background: row.background && typeof row.background === 'object' ? row.background : null,
      isActive: row.isActive,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }
}
