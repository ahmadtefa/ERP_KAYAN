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
const RATE_SCALE = 4;

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    companyId: string,
    query: { q?: string; includeInactive?: boolean; page?: number; pageSize?: number },
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.ItemWhereInput = { companyId, deletedAt: null };
    if (!query.includeInactive) where.isActive = true;
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { nameEn: { contains: q, mode: 'insensitive' } },
        { nameAr: { contains: q } },
        { barcode: { contains: q } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.item.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.item.count({ where }),
    ]);

    return { items: items.map((i) => this.toResponse(i)), total, page, pageSize };
  }

  async findOne(companyId: string, id: string) {
    const item = await this.prisma.item.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Item not found');
    return this.toResponse(item);
  }

  async create(companyId: string, userId: string, body: object) {
    const dto = body as Record<string, any>;
    const code = String(dto.code ?? '').trim();
    if (!code) throw new BadRequestException('code is required');

    const existing = await this.prisma.item.findFirst({
      where: { companyId, code },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Item code ${code} is already used`);
    }

    const created = await this.prisma.item.create({
      data: {
        companyId,
        code,
        nameEn: dto.nameEn as string,
        nameAr: dto.nameAr as string,
        unit: (dto.unit as string) ?? 'unit',
        barcode: (dto.barcode as string) ?? null,
        salePrice: this.money(dto.salePrice, 'salePrice'),
        taxRate: this.rate(dto.taxRate, 'taxRate'),
        isStockTracked: (dto.isStockTracked as boolean) ?? true,
        notes: (dto.notes as string) ?? null,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'items',
      entityId: created.id,
      after: { code: created.code, nameEn: created.nameEn },
    });

    return this.toResponse(created);
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    body: object,
  ) {
    const dto = body as Record<string, any>;
    const before = await this.prisma.item.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Item not found');

    const data: Prisma.ItemUpdateInput = { updatedBy: userId };
    for (const key of ['nameEn', 'nameAr', 'unit', 'barcode', 'notes', 'isActive', 'isStockTracked'] as const) {
      if (dto[key] !== undefined) (data as any)[key] = dto[key];
    }
    if (dto.salePrice !== undefined) data.salePrice = this.money(dto.salePrice, 'salePrice');
    if (dto.taxRate !== undefined) data.taxRate = this.rate(dto.taxRate, 'taxRate');

    const updated = await this.prisma.item.update({ where: { id }, data });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'items',
      entityId: id,
      before: { nameEn: before.nameEn, salePrice: before.salePrice.toFixed(MONEY_SCALE) },
      after: { nameEn: updated.nameEn, salePrice: updated.salePrice.toFixed(MONEY_SCALE) },
    });

    return this.toResponse(updated);
  }

  /** An item that has moved through stock is never deleted, only deactivated. */
  async deactivate(companyId: string, userId: string, id: string) {
    const item = await this.prisma.item.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { stockBalances: true },
    });
    if (!item) throw new NotFoundException('Item not found');
    if (!item.isActive) return this.toResponse(item);

    const onHand = item.stockBalances.reduce(
      (sum, b) => sum.plus(b.quantity),
      new Prisma.Decimal(0),
    );
    if (!onHand.isZero()) {
      throw new BadRequestException(
        `This item still has ${onHand.toFixed(MONEY_SCALE)} in stock. ` +
          'Move it out before deactivating the item.',
      );
    }

    const updated = await this.prisma.item.update({
      where: { id },
      data: { isActive: false, updatedBy: userId },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'DEACTIVATE',
      entity: 'items',
      entityId: id,
      before: { isActive: true },
      after: { isActive: false },
    });

    return this.toResponse(updated);
  }

  private money(value: unknown, field: string): Prisma.Decimal {
    if (value === undefined || value === null || value === '') {
      return new Prisma.Decimal(0);
    }
    try {
      const d = new Prisma.Decimal(String(value)).toDecimalPlaces(MONEY_SCALE);
      if (d.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
      return d;
    } catch {
      throw new BadRequestException(`${field} is not a valid amount`);
    }
  }

  private rate(value: unknown, field: string): Prisma.Decimal {
    if (value === undefined || value === null || value === '') {
      return new Prisma.Decimal(0);
    }
    try {
      const d = new Prisma.Decimal(String(value)).toDecimalPlaces(RATE_SCALE);
      if (d.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
      if (d.greaterThan(100)) throw new BadRequestException(`${field} cannot exceed 100`);
      return d;
    } catch {
      throw new BadRequestException(`${field} is not a valid percentage`);
    }
  }

  private toResponse(item: {
    id: string;
    companyId: string;
    code: string;
    nameEn: string;
    nameAr: string;
    unit: string;
    barcode: string | null;
    salePrice: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    isStockTracked: boolean;
    isActive: boolean;
    notes: string | null;
    createdAt: Date;
  }) {
    return {
      id: item.id,
      companyId: item.companyId,
      code: item.code,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      unit: item.unit,
      barcode: item.barcode,
      salePrice: item.salePrice.toFixed(MONEY_SCALE),
      taxRate: item.taxRate.toFixed(RATE_SCALE),
      isStockTracked: item.isStockTracked,
      isActive: item.isActive,
      notes: item.notes,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
