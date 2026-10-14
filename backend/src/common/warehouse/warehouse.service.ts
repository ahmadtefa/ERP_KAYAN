import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const MONEY_SCALE = 4;

/**
 * The places inside a branch where goods sit.
 *
 * Two jobs live here, and they are deliberately in one place:
 *
 *   1. the master data a person edits (create, rename, deactivate, choose the
 *      branch default);
 *   2. `resolve()`, which every posting path calls to answer "which warehouse
 *      did this actually happen in?". It never invents an answer: it either
 *      uses the warehouse named on the document, or the branch's default, and
 *      it refuses a warehouse that belongs to another company or another
 *      branch, because a movement between the wrong two piles is worse than a
 *      refused posting.
 */
@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    companyId: string,
    query: { branchId?: string; includeInactive?: boolean } = {},
  ) {
    const where: Prisma.WarehouseWhereInput = { companyId, deletedAt: null };
    if (!query.includeInactive) where.isActive = true;
    if (query.branchId) where.branchId = query.branchId;

    const items = await this.prisma.warehouse.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
      include: { branch: { select: { code: true, nameEn: true, nameAr: true } } },
    });

    return { items: items.map((row) => this.toResponse(row)), total: items.length };
  }

  async findOne(companyId: string, id: string) {
    const row = await this.prisma.warehouse.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { branch: { select: { code: true, nameEn: true, nameAr: true } } },
    });
    if (!row) throw new NotFoundException('Warehouse not found');
    return this.toResponse(row);
  }

  async create(companyId: string, userId: string, dto: Record<string, unknown>) {
    const code = this.text(dto.code, 'code');
    const nameEn = this.text(dto.nameEn, 'nameEn');
    const nameAr = this.text(dto.nameAr, 'nameAr');
    const branchId = await this.branch(companyId, this.text(dto.branchId, 'branchId'));

    const existing = await this.prisma.warehouse.findFirst({
      where: { companyId, code },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Warehouse code ${code} is already used`);
    }

    // The first warehouse of a branch is its default without being asked:
    // a branch with none would leave documents with nowhere to post.
    const count = await this.prisma.warehouse.count({
      where: { companyId, branchId, deletedAt: null },
    });
    const isDefault = dto.isDefault === true || count === 0;

    const created = await this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.warehouse.updateMany({
          where: { companyId, branchId, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        });
      }
      return tx.warehouse.create({
        data: {
          companyId,
          branchId,
          code,
          nameEn,
          nameAr,
          address: (dto.address as string) ?? null,
          isDefault,
          isActive: dto.isActive === false ? false : true,
          createdBy: userId,
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'warehouses',
      entityId: created.id,
      after: { code, nameEn, nameAr, branchId, isDefault },
    });

    return this.findOne(companyId, created.id);
  }

  async update(companyId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const before = await this.prisma.warehouse.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Warehouse not found');

    const data: Prisma.WarehouseUpdateInput = {};
    if (dto.nameEn !== undefined) data.nameEn = this.text(dto.nameEn, 'nameEn');
    if (dto.nameAr !== undefined) data.nameAr = this.text(dto.nameAr, 'nameAr');
    if (dto.address !== undefined) data.address = (dto.address as string) ?? null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive === true;
    if (dto.branchId !== undefined) {
      data.branch = {
        connect: { id: await this.branch(companyId, this.text(dto.branchId, 'branchId')) },
      };
    }

    const makeDefault = dto.isDefault === true;
    if (before.isDefault && dto.isDefault === false) {
      throw new BadRequestException(
        'A branch must keep a default warehouse; name another one instead',
      );
    }
    if (dto.isActive === false && before.isDefault) {
      throw new BadRequestException(
        'The default warehouse of a branch cannot be deactivated; make another one the default first',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.warehouse.updateMany({
          where: {
            companyId,
            branchId: before.branchId,
            isDefault: true,
            deletedAt: null,
            NOT: { id },
          },
          data: { isDefault: false },
        });
        data.isDefault = true;
      }
      return tx.warehouse.update({ where: { id }, data });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'warehouses',
      entityId: id,
      before: { nameEn: before.nameEn, isActive: before.isActive, isDefault: before.isDefault },
      after: { nameEn: updated.nameEn, isActive: updated.isActive, isDefault: updated.isDefault },
    });

    return this.findOne(companyId, id);
  }

  async deactivate(companyId: string, userId: string, id: string) {
    const before = await this.prisma.warehouse.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Warehouse not found');
    if (before.isDefault) {
      throw new BadRequestException(
        'The default warehouse of a branch cannot be deactivated; make another one the default first',
      );
    }

    await this.prisma.warehouse.update({ where: { id }, data: { isActive: false } });
    await this.audit.record({
      companyId,
      userId,
      action: 'DEACTIVATE',
      entity: 'warehouses',
      entityId: id,
      before: { isActive: true },
      after: { isActive: false },
    });

    return this.findOne(companyId, id);
  }

  /**
   * The warehouse a document happened in.
   *
   * Called inside the posting transaction, so a movement and the claim on the
   * warehouse are written or rolled back together. When the document names
   * none, the branch's default is used - and created on the spot if the branch
   * somehow has none, because refusing to post a sale over a missing master
   * record would be the wrong answer.
   */
  async resolve(
    tx: Prisma.TransactionClient,
    companyId: string,
    branchId: string,
    warehouseId?: string | null,
  ): Promise<string | null> {
    if (warehouseId) {
      const named = await tx.warehouse.findFirst({
        where: { id: warehouseId, companyId, deletedAt: null },
        select: { id: true, branchId: true, isActive: true, code: true },
      });
      if (!named) throw new BadRequestException('The warehouse does not exist in this company');
      if (named.branchId !== branchId) {
        throw new BadRequestException(
          `Warehouse ${named.code} belongs to another branch; a document cannot move goods across branches`,
        );
      }
      if (!named.isActive) {
        throw new BadRequestException(`Warehouse ${named.code} is inactive`);
      }
      return named.id;
    }

    const fallback = await tx.warehouse.findFirst({
      where: { companyId, branchId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
      select: { id: true },
    });
    if (fallback) return fallback.id;

    // A branch with nowhere to put goods cannot be allowed to stop a posting.
    // The customer's delivery has already happened; refusing the invoice over
    // a missing master record would be the wrong answer, so the warehouse is
    // created here, once, and named after the branch.
    const branch = await tx.branch.findFirst({
      where: { id: branchId, companyId, deletedAt: null },
      select: { code: true, nameEn: true, nameAr: true },
    });
    if (!branch) return null;

    const created = await tx.warehouse.create({
      data: {
        companyId,
        branchId,
        code: `${branch.code}-MAIN`,
        nameEn: `${branch.nameEn} main store`,
        nameAr: `${branch.nameAr} - المخزن الرئيسي`,
        isDefault: true,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** What one warehouse holds, read from the movements that put it there. */
  async stock(
    companyId: string,
    warehouseId: string,
    query: { asOf?: string; itemId?: string } = {},
  ) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, companyId, deletedAt: null },
      include: { branch: { select: { code: true, nameEn: true, nameAr: true } } },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const asOf = query.asOf ? new Date(`${query.asOf.slice(0, 10)}T23:59:59.999Z`) : new Date();
    const rows = await this.prisma.$queryRaw<
      Array<{
        itemId: string;
        code: string;
        nameEn: string;
        nameAr: string;
        unit: string;
        quantity: Prisma.Decimal;
        value: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT i.id AS "itemId", i.code, i."nameEn", i."nameAr", i.unit,
             COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m.quantity ELSE -m.quantity END), 0) AS quantity,
             COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m."totalCost" ELSE -m."totalCost" END), 0) AS value
        FROM stock_movements m
        JOIN items i ON i.id = m."itemId"
       WHERE m."companyId" = ${companyId}::uuid
         AND m."warehouseId" = ${warehouseId}::uuid
         AND m."movementDate" <= ${asOf}::date
         ${query.itemId ? Prisma.sql`AND m."itemId" = ${query.itemId}::uuid` : Prisma.empty}
       GROUP BY i.id, i.code, i."nameEn", i."nameAr", i.unit
      HAVING COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m.quantity ELSE -m.quantity END), 0) <> 0
          OR COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m."totalCost" ELSE -m."totalCost" END), 0) <> 0
       ORDER BY i.code
    `);

    return {
      warehouse: this.toResponse(warehouse),
      asOf: asOf.toISOString().slice(0, 10),
      rows: rows.map((row) => ({
        itemId: row.itemId,
        code: row.code,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        unit: row.unit,
        quantity: new Prisma.Decimal(row.quantity).toFixed(MONEY_SCALE),
        value: new Prisma.Decimal(row.value).toFixed(MONEY_SCALE),
      })),
      totals: {
        value: rows
          .reduce((sum, row) => sum.plus(new Prisma.Decimal(row.value)), new Prisma.Decimal(0))
          .toFixed(MONEY_SCALE),
      },
    };
  }

  private async branch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('The branch does not exist in this company');
    return branch.id;
  }

  private text(value: unknown, field: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException(`${field} is required`);
    return text;
  }

  private toResponse(row: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    address?: string | null;
    isDefault: boolean;
    isActive: boolean;
    branchId: string;
    branch?: { code: string; nameEn: string; nameAr: string } | null;
  }) {
    return {
      id: row.id,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      address: row.address ?? null,
      isDefault: row.isDefault,
      isActive: row.isActive,
      branchId: row.branchId,
      branchCode: row.branch?.code ?? null,
      branchNameEn: row.branch?.nameEn ?? null,
      branchNameAr: row.branch?.nameAr ?? null,
    };
  }
}
