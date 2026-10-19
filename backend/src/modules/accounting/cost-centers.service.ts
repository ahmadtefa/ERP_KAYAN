import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CostCenterType, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const MONEY_SCALE = 4;
const MAX_DEPTH = 12;

const TYPES = new Set<string>([
  CostCenterType.DEPARTMENT,
  CostCenterType.ADMINISTRATIVE_UNIT,
  CostCenterType.PROJECT,
]);

/// Cost centers: the answer to "whose cost is this?".
///
/// They are deliberately not a second chart of accounts; a cost centre is one
/// dimension carried on a journal line so the profit of a shop, a project or a
/// department can be read out of the same ledger that reports the company's
/// profit. One centre may sit under another, and the rules that keep that
/// hierarchy a tree (no self-parent, no cycles, no orphan parents) live here
/// because they need to look at more than one row.
@Injectable()
export class CostCentersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    companyId: string,
    query: {
      includeInactive?: boolean;
      q?: string;
      type?: string;
      parentId?: string | null;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const where: Prisma.CostCenterWhereInput = { companyId, deletedAt: null };
    if (!query.includeInactive) where.isActive = true;
    if (query.type) {
      if (!TYPES.has(query.type)) {
        throw new BadRequestException(
          `type must be one of ${[...TYPES].join(', ')}`,
        );
      }
      where.type = query.type as CostCenterType;
    }
    // `parentId === null` asks for the roots only; a string asks for the
    // children of that centre. Absent means "everything".
    if (query.parentId === null) where.parentId = null;
    else if (typeof query.parentId === 'string' && query.parentId) {
      where.parentId = query.parentId;
    }
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { nameEn: { contains: q, mode: 'insensitive' } },
        { nameAr: { contains: q } },
        { responsiblePerson: { contains: q, mode: 'insensitive' } },
      ];
    }

    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 500);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.costCenter.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.costCenter.count({ where }),
    ]);

    return {
      items: items.map((c) => this.toResponse(c)),
      total,
      page,
      pageSize,
    };
  }

  /// The whole tree, flattened in display order. A screen that shows a parent
  /// selector needs every centre; a screen that shows a tree needs depth, which
  /// is computed here rather than guessed by the caller.
  async tree(companyId: string, query: { includeInactive?: boolean } = {}) {
    const rows = await this.prisma.costCenter.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { code: 'asc' },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const depthOf = (id: string): number => {
      let depth = 0;
      let current = byId.get(id);
      const seen = new Set<string>();
      while (current?.parentId && byId.has(current.parentId)) {
        if (seen.has(current.parentId)) break;
        seen.add(current.parentId);
        depth++;
        current = byId.get(current.parentId);
      }
      return depth;
    };
    const items = rows
      .map((row) => ({ ...this.toResponse(row), depth: depthOf(row.id) }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return { items, total: items.length };
  }

  async findOne(companyId: string, id: string) {
    const costCenter = await this.prisma.costCenter.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!costCenter) throw new NotFoundException('Cost center not found');

    const [children, usage] = await Promise.all([
      this.prisma.costCenter.findMany({
        where: { companyId, parentId: id, deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true, isActive: true },
        orderBy: { code: 'asc' },
      }),
      this.usage(companyId, id),
    ]);

    return {
      ...this.toResponse(costCenter),
      children,
      usage,
    };
  }

  async create(companyId: string, userId: string, dto: Record<string, unknown>) {
    const code = this.text(dto.code, 'code');
    const nameEn = this.text(dto.nameEn, 'nameEn');
    const nameAr = this.text(dto.nameAr, 'nameAr');
    const type = this.type(dto.type);
    const parentId = await this.parent(companyId, dto.parentId, null);
    const dates = this.dates(dto);

    const existing = await this.prisma.costCenter.findFirst({
      where: { companyId, code },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Cost center code ${code} is already used`);
    }

    const created = await this.prisma.costCenter.create({
      data: {
        companyId,
        code,
        nameEn,
        nameAr,
        type,
        parentId,
        description: this.optionalText(dto.description),
        responsiblePerson: this.optionalText(dto.responsiblePerson),
        ...dates,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'cost_centers',
      entityId: created.id,
      after: this.toResponse(created),
    });

    return this.toResponse(created);
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: Record<string, unknown>,
  ) {
    const before = await this.prisma.costCenter.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Cost center not found');

    const data: Prisma.CostCenterUncheckedUpdateInput = { updatedBy: userId };
    if (dto.nameEn !== undefined) data.nameEn = this.text(dto.nameEn, 'nameEn');
    if (dto.nameAr !== undefined) data.nameAr = this.text(dto.nameAr, 'nameAr');
    if (dto.type !== undefined) data.type = this.type(dto.type);
    if (dto.description !== undefined) {
      data.description = this.optionalText(dto.description);
    }
    if (dto.responsiblePerson !== undefined) {
      data.responsiblePerson = this.optionalText(dto.responsiblePerson);
    }
    if (dto.startDate !== undefined || dto.endDate !== undefined) {
      Object.assign(data, this.dates(dto, before));
    }
    // Moving a centre is the operation that can break a tree, so it is checked
    // against the centre's own descendants, not only against itself.
    if (dto.parentId !== undefined) {
      data.parentId = await this.parent(companyId, dto.parentId, id);
    }
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

    const children = await this.prisma.costCenter.count({
      where: { companyId, parentId: id, deletedAt: null },
    });
    if (children > 0) {
      throw new BadRequestException(
        `This cost center has ${children} child centre(s). Move or deactivate them first.`,
      );
    }

    const used = await this.usage(companyId, id);
    if (used.journalLines > 0 || used.allocatedLines > 0) {
      throw new BadRequestException(
        `This cost center is used by ${used.journalLines} journal line(s) and ` +
          `${used.allocatedLines} allocation(s), so it cannot be deleted. Deactivate it instead.`,
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

  async usage(companyId: string, id: string) {
    const [journalLines, allocatedLines] = await Promise.all([
      this.prisma.journalLine.count({
        where: { costCenterId: id, entry: { companyId } },
      }),
      this.prisma.journalLineAllocation.count({
        where: { costCenterId: id, line: { entry: { companyId } } },
      }),
    ]);
    return { journalLines, allocatedLines };
  }

  // ------------------------------------------------------------- validation

  private text(value: unknown, field: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException(`${field} is required`);
    return text;
  }

  private optionalText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  }

  private type(value: unknown): CostCenterType {
    if (value === undefined || value === null || value === '') {
      return CostCenterType.DEPARTMENT;
    }
    const raw = String(value).trim().toUpperCase();
    if (!TYPES.has(raw)) {
      throw new BadRequestException(
        `type must be one of ${[...TYPES].join(', ')}`,
      );
    }
    return raw as CostCenterType;
  }

  private dates(
    dto: Record<string, unknown>,
    existing?: { startDate: Date | null; endDate: Date | null },
  ): { startDate: Date | null; endDate: Date | null } {
    const parse = (value: unknown, field: string): Date | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null || value === '') return null;
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException(`${field} is not a valid date`);
      }
      return new Date(date.toISOString().slice(0, 10));
    };

    const startDate =
      parse(dto.startDate, 'startDate') ?? existing?.startDate ?? null;
    const endDate = parse(dto.endDate, 'endDate') ?? existing?.endDate ?? null;
    if (dto.startDate === null) {
      // An explicit clear must survive the `?? existing` above.
      return { startDate: null, endDate };
    }
    if (startDate && endDate && endDate < startDate) {
      throw new BadRequestException('endDate cannot be before startDate');
    }
    return { startDate, endDate };
  }

  /// Resolves and validates the parent of a centre.
  ///
  /// `id` is the centre being edited (null while creating). A centre may not be
  /// its own parent, may not be moved under one of its descendants, and may not
  /// sit below the depth the reports can walk.
  private async parent(
    companyId: string,
    value: unknown,
    id: string | null,
  ): Promise<string | null> {
    if (value === undefined || value === null || value === '') return null;
    const parentId = String(value);
    if (id && parentId === id) {
      throw new BadRequestException('A cost center cannot be its own parent');
    }

    const parent = await this.prisma.costCenter.findFirst({
      where: { id: parentId, companyId, deletedAt: null },
      select: { id: true, parentId: true, isActive: true },
    });
    if (!parent) {
      throw new BadRequestException('The parent cost center does not exist');
    }
    if (!parent.isActive) {
      throw new BadRequestException(
        'The parent cost center is inactive; activate it or choose another parent',
      );
    }

    if (id) {
      // Walk up from the proposed parent: meeting the centre itself means the
      // move would create a cycle.
      let cursor: string | null = parent.parentId;
      const seen = new Set<string>();
      let depth = 1;
      while (cursor) {
        if (cursor === id) {
          throw new BadRequestException(
            'That parent is a descendant of this cost center, so the move would create a cycle',
          );
        }
        if (seen.has(cursor)) {
          throw new BadRequestException(
            'The existing cost center hierarchy already contains a cycle and must be repaired first',
          );
        }
        seen.add(cursor);
        if (++depth > MAX_DEPTH) {
          throw new BadRequestException(
            `Cost centers can be nested at most ${MAX_DEPTH} levels deep`,
          );
        }
        const next: { parentId: string | null } | null =
          await this.prisma.costCenter.findFirst({
            where: { id: cursor, companyId },
            select: { parentId: true },
          });
        cursor = next?.parentId ?? null;
      }
    }

    return parentId;
  }

  toResponse(row: {
    id: string;
    companyId: string;
    code: string;
    nameEn: string;
    nameAr: string;
    type: CostCenterType;
    parentId: string | null;
    isActive: boolean;
    description: string | null;
    responsiblePerson: string | null;
    startDate: Date | null;
    endDate: Date | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      type: row.type,
      parentId: row.parentId,
      isActive: row.isActive,
      description: row.description,
      responsiblePerson: row.responsiblePerson,
      startDate: row.startDate ? row.startDate.toISOString().slice(0, 10) : null,
      endDate: row.endDate ? row.endDate.toISOString().slice(0, 10) : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------- allocations

  /// Validates a set of allocations for a line whose amount is known.
  ///
  /// Rules, in the order a user would hit them:
  ///   * every centre exists, belongs to this company, is active and is inside
  ///     its validity window on the entry date;
  ///   * no centre appears twice;
  ///   * every amount is positive at the ledger's four decimal places;
  ///   * the total equals the line amount exactly - a split that loses a
  ///     fraction of a piastre is refused rather than rounded, because the
  ///     ledger would then no longer add up to the document.
  static validateAllocations(
    lineAmount: Prisma.Decimal,
    allocations: Array<{ costCenterId: string; amount: string | number | Prisma.Decimal }>,
  ): Array<{ costCenterId: string; amount: Prisma.Decimal }> {
    const normalised: Array<{ costCenterId: string; amount: Prisma.Decimal }> = [];
    const seen = new Set<string>();
    let total = new Prisma.Decimal(0);

    for (const allocation of allocations) {
      const costCenterId = String(allocation.costCenterId ?? '').trim();
      if (!costCenterId) {
        throw new BadRequestException('Every allocation needs a cost center');
      }
      if (seen.has(costCenterId)) {
        throw new BadRequestException(
          'The same cost center appears twice in one line; combine the two amounts',
        );
      }
      seen.add(costCenterId);

      let amount: Prisma.Decimal;
      try {
        amount = new Prisma.Decimal(
          typeof allocation.amount === 'string'
            ? allocation.amount
            : allocation.amount?.toString() ?? '0',
        );
      } catch {
        throw new BadRequestException('An allocation amount is not a number');
      }
      if (amount.decimalPlaces() > MONEY_SCALE) {
        throw new BadRequestException(
          `Allocation amounts carry at most ${MONEY_SCALE} decimal places`,
        );
      }
      if (!amount.greaterThan(0)) {
        throw new BadRequestException('Allocation amounts must be greater than zero');
      }
      total = total.plus(amount);
      normalised.push({ costCenterId, amount });
    }

    if (!total.equals(lineAmount)) {
      throw new BadRequestException({
        message: 'The allocations do not add up to the line amount',
        errors: {
          lineAmount: lineAmount.toFixed(MONEY_SCALE),
          allocated: total.toFixed(MONEY_SCALE),
          difference: total.minus(lineAmount).toFixed(MONEY_SCALE),
        },
      });
    }

    return normalised.sort((a, b) => b.amount.comparedTo(a.amount));
  }

  /// Checks that every named centre is one this company may post to today.
  async assertPostable(
    tx: Prisma.TransactionClient | PrismaService,
    companyId: string,
    ids: string[],
    entryDate: Date,
  ): Promise<void> {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return;
    const rows = await tx.costCenter.findMany({
      where: { id: { in: unique }, companyId, deletedAt: null },
      select: {
        id: true,
        code: true,
        isActive: true,
        startDate: true,
        endDate: true,
      },
    });
    if (rows.length !== unique.length) {
      throw new BadRequestException(
        'One or more cost centers do not exist in this company',
      );
    }
    const day = entryDate.toISOString().slice(0, 10);
    for (const row of rows) {
      if (!row.isActive) {
        throw new BadRequestException(
          `Cost center ${row.code} is inactive and cannot receive new postings`,
        );
      }
      const start = row.startDate ? row.startDate.toISOString().slice(0, 10) : null;
      const end = row.endDate ? row.endDate.toISOString().slice(0, 10) : null;
      if ((start && day < start) || (end && day > end)) {
        throw new BadRequestException(
          `Cost center ${row.code} is not valid on ${day}`,
        );
      }
    }
  }
}
