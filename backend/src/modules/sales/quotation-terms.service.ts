import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CreateQuotationTermDto,
  UpdateQuotationTermDto,
} from './dto/quotation-term.dto';

type TermRow = {
  id: string;
  title: string;
  body: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/// The reusable terms library.
///
/// The table predates the current quotation screens (it was created by the
/// first quotation migration), so it is read through SQL rather than a Prisma
/// model: the generated client in an offline installation cannot be rebuilt,
/// and the shape is small and fixed. A term is copied onto a quotation when it
/// is chosen; editing the library never rewrites an issued document.
@Injectable()
export class QuotationTermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string) {
    const rows = await this.prisma.$queryRaw<TermRow[]>(Prisma.sql`
      SELECT id, title, body, "sortOrder", "isActive", "createdAt", "updatedAt"
        FROM quotation_term_templates
       WHERE "companyId" = ${companyId}::uuid
         AND "deletedAt" IS NULL
       ORDER BY "sortOrder", title
    `);
    return rows.map((row) => this.present(row));
  }

  async create(companyId: string, userId: string, dto: CreateQuotationTermDto) {
    const sortOrder =
      dto.sortOrder ??
      (
        await this.prisma.$queryRaw<Array<{ next: number }>>(Prisma.sql`
          SELECT COALESCE(MAX("sortOrder") + 10, 0)::int AS next
            FROM quotation_term_templates
           WHERE "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
        `)
      )[0]?.next ??
      0;

    const rows = await this.prisma.$queryRaw<TermRow[]>(Prisma.sql`
      INSERT INTO quotation_term_templates
        (id, "companyId", title, body, "sortOrder", "isActive",
         "createdAt", "updatedAt", "createdBy", "updatedBy")
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${dto.title.trim()},
              ${dto.body.trim()}, ${sortOrder}, true, now(), now(),
              ${userId}::uuid, ${userId}::uuid)
      RETURNING id, title, body, "sortOrder", "isActive", "createdAt", "updatedAt"
    `);
    const term = this.present(rows[0]);
    await this.audit.record({
      companyId,
      userId,
      action: 'create',
      entity: 'QuotationTerm',
      entityId: term.id,
      after: { title: term.title, sortOrder: term.sortOrder },
    });
    return term;
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateQuotationTermDto,
  ) {
    const existing = await this.findOne(companyId, id);
    const rows = await this.prisma.$queryRaw<TermRow[]>(Prisma.sql`
      UPDATE quotation_term_templates
         SET title = ${dto.title?.trim() ?? existing.title},
             body = ${dto.body?.trim() ?? existing.body},
             "sortOrder" = ${dto.sortOrder ?? existing.sortOrder},
             "isActive" = ${dto.isActive ?? existing.isActive},
             "updatedAt" = now(),
             "updatedBy" = ${userId}::uuid
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
         AND "deletedAt" IS NULL
      RETURNING id, title, body, "sortOrder", "isActive", "createdAt", "updatedAt"
    `);
    if (!rows[0]) throw new NotFoundException('Quotation term not found');
    const term = this.present(rows[0]);
    await this.audit.record({
      companyId,
      userId,
      action: 'update',
      entity: 'QuotationTerm',
      entityId: id,
      before: { title: existing.title, isActive: existing.isActive },
      after: { title: term.title, isActive: term.isActive },
    });
    return term;
  }

  /// A library entry is removed from the picker but not destroyed: quotations
  /// already printed with its text keep their own copy of that text.
  async remove(companyId: string, userId: string, id: string) {
    const existing = await this.findOne(companyId, id);
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE quotation_term_templates
         SET "isActive" = false, "deletedAt" = now(),
             "updatedAt" = now(), "updatedBy" = ${userId}::uuid
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
         AND "deletedAt" IS NULL
    `);
    await this.audit.record({
      companyId,
      userId,
      action: 'delete',
      entity: 'QuotationTerm',
      entityId: id,
      before: { title: existing.title },
    });
    return { id, deleted: true };
  }

  private async findOne(companyId: string, id: string) {
    const rows = await this.prisma.$queryRaw<TermRow[]>(Prisma.sql`
      SELECT id, title, body, "sortOrder", "isActive", "createdAt", "updatedAt"
        FROM quotation_term_templates
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
         AND "deletedAt" IS NULL
    `);
    if (!rows[0]) throw new NotFoundException('Quotation term not found');
    return rows[0];
  }

  private present(row: TermRow) {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      sortOrder: Number(row.sortOrder),
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
