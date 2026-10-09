import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const MONEY_SCALE = 4;
export type PartyKind = 'customer' | 'supplier';

/**
 * Customers and suppliers differ only in a credit limit, so they share one
 * service and are separated by which table is addressed. Keeping the two code
 * paths identical avoids the classic bug where one learns a fix and the other
 * does not.
 */
@Injectable()
export class PartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private model(kind: PartyKind) {
    return kind === 'customer' ? this.prisma.customer : this.prisma.supplier;
  }

  async findAll(
    companyId: string,
    kind: PartyKind,
    query: { q?: string; includeInactive?: boolean; page?: number; pageSize?: number },
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.CustomerWhereInput = { companyId, deletedAt: null };
    if (!query.includeInactive) where.isActive = true;
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { nameEn: { contains: q, mode: 'insensitive' } },
        { nameAr: { contains: q } },
        { phone: { contains: q } },
      ];
    }

    const model = this.model(kind) as any;
    const [items, total] = await this.prisma.$transaction([
      model.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      model.count({ where }),
    ]);

    return {
      items: items.map((i: any) => this.toResponse(i)),
      total,
      page,
      pageSize,
    };
  }

  async findOne(companyId: string, kind: PartyKind, id: string) {
    const model = this.model(kind) as any;
    const row = await model.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!row) throw new NotFoundException(`${kind} not found`);
    return this.toResponse(row);
  }

  async create(
    companyId: string,
    userId: string,
    kind: PartyKind,
    body: object,
  ) {
    const dto = body as Record<string, any>;
    const code = String(dto.code ?? '').trim();
    if (!code) throw new BadRequestException('code is required');

    const model = this.model(kind) as any;
    const existing = await model.findFirst({
      where: { companyId, code },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`${kind} code ${code} is already used`);
    }

    const data: Record<string, unknown> = {
      companyId,
      code,
      nameEn: dto.nameEn,
      nameAr: dto.nameAr,
      phone: (dto.phone as string) ?? null,
      email: (dto.email as string) ?? null,
      taxNumber: (dto.taxNumber as string) ?? null,
      address: (dto.address as string) ?? null,
      notes: (dto.notes as string) ?? null,
      createdBy: userId,
      updatedBy: userId,
    };
    if (kind === 'customer' && dto.creditLimit !== undefined) {
      data.creditLimit = this.money(dto.creditLimit, 'creditLimit');
    }

    const created = await model.create({ data });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: kind === 'customer' ? 'customers' : 'suppliers',
      entityId: created.id,
      after: { code: created.code, nameEn: created.nameEn },
    });

    return this.toResponse(created);
  }

  async update(
    companyId: string,
    userId: string,
    kind: PartyKind,
    id: string,
    body: object,
  ) {
    const dto = body as Record<string, any>;
    const model = this.model(kind) as any;
    const before = await model.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!before) throw new NotFoundException(`${kind} not found`);

    const data: Record<string, unknown> = { updatedBy: userId };
    for (const key of [
      'nameEn',
      'nameAr',
      'phone',
      'email',
      'taxNumber',
      'address',
      'notes',
      'isActive',
    ]) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (kind === 'customer' && dto.creditLimit !== undefined) {
      data.creditLimit = this.money(dto.creditLimit, 'creditLimit');
    }

    const updated = await model.update({ where: { id }, data });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: kind === 'customer' ? 'customers' : 'suppliers',
      entityId: id,
      before: { nameEn: before.nameEn, isActive: before.isActive },
      after: { nameEn: updated.nameEn, isActive: updated.isActive },
    });

    return this.toResponse(updated);
  }

  /**
   * Deactivates rather than deletes. A partner that has been invoiced must
   * stay readable forever, otherwise old documents lose their counterparty.
   */
  async deactivate(
    companyId: string,
    userId: string,
    kind: PartyKind,
    id: string,
  ) {
    const model = this.model(kind) as any;
    const row = await model.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!row) throw new NotFoundException(`${kind} not found`);
    if (!row.isActive) return this.toResponse(row);

    const updated = await model.update({
      where: { id },
      data: { isActive: false, updatedBy: userId },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'DEACTIVATE',
      entity: kind === 'customer' ? 'customers' : 'suppliers',
      entityId: id,
      before: { isActive: true },
      after: { isActive: false },
    });

    return this.toResponse(updated);
  }

  private money(value: unknown, field: string): Prisma.Decimal {
    try {
      const d = new Prisma.Decimal(String(value)).toDecimalPlaces(MONEY_SCALE);
      if (d.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
      return d;
    } catch {
      throw new BadRequestException(`${field} is not a valid amount`);
    }
  }

  private toResponse(row: any) {
    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      phone: row.phone,
      email: row.email,
      taxNumber: row.taxNumber,
      address: row.address,
      creditLimit:
        row.creditLimit !== undefined && row.creditLimit !== null
          ? row.creditLimit.toFixed(MONEY_SCALE)
          : undefined,
      isActive: row.isActive,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
