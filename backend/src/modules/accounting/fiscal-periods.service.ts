import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PeriodStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CreateFiscalPeriodDto,
  ListFiscalPeriodsDto,
  UpdateFiscalPeriodDto,
} from './dto/fiscal-period.dto';

/// Accounting periods.
///
/// REQUIRES BUSINESS DECISION: the fiscal year start is a company decision.
/// The seed opens the calendar year, which is the common Egyptian default, and
/// nothing here forces that choice — a company that runs July to June creates
/// the periods it actually uses.
///
/// Closing a period is what freezes a year. Posting into a closed period is
/// refused, and there is no way to reopen one: if a closed year turns out to
/// be wrong, the correction belongs in the current year, the way an auditor
/// expects to find it.
@Injectable()
export class FiscalPeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string, query: ListFiscalPeriodsDto = {}) {
    const where: Record<string, unknown> = { companyId };
    if (query.status) where.status = query.status;
    if (query.year) {
      where.startDate = {
        gte: new Date(Date.UTC(query.year, 0, 1)),
        lte: new Date(Date.UTC(query.year, 11, 31)),
      };
    }
    const periods = await this.prisma.fiscalPeriod.findMany({
      where,
      orderBy: { startDate: 'desc' },
    });
    return { items: periods.map((period) => this.toResponse(period)) };
  }

  /** Serialize application-created/edited ranges for each company. */
  private async lockRanges(tx: Prisma.TransactionClient, companyId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT 1 AS locked FROM (
        SELECT pg_advisory_xact_lock(hashtextextended('kayan:fiscal-period:' || ${companyId}::text, 0))
      ) AS lock_row
    `);
  }

  /** The same row lock used by the posting triggers and year-end close. */
  private async lockPeriod(tx: Prisma.TransactionClient, companyId: string, id: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM fiscal_periods
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE
    `);
  }

  async create(companyId: string, userId: string, dto: CreateFiscalPeriodDto) {
    const code = dto.code.trim().toUpperCase();
    const startDate = this.date(dto.startDate, 'startDate');
    const endDate = this.date(dto.endDate, 'endDate');
    if (endDate < startDate) {
      throw new BadRequestException('The end date must be after the start date');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockRanges(tx, companyId);
      const existing = await tx.fiscalPeriod.findFirst({ where: { companyId, code } });
      if (existing) throw new ConflictException('A period with that code already exists');
      await this.assertNoOverlap(tx, companyId, startDate, endDate);
      const created = await tx.fiscalPeriod.create({
        data: { companyId, code, nameEn: dto.nameEn.trim(), nameAr: dto.nameAr.trim(),
          startDate, endDate, status: PeriodStatus.OPEN },
      });
      await this.audit.recordRequired({
        companyId, userId, action: 'fiscal_period.create', entity: 'fiscal_periods',
        entityId: created.id, after: { code, startDate: dto.startDate, endDate: dto.endDate },
      }, tx);
      return this.toResponse(created);
    });
  }

  async update(companyId: string, userId: string, id: string, dto: UpdateFiscalPeriodDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockRanges(tx, companyId);
      await this.lockPeriod(tx, companyId, id);
      const period = await tx.fiscalPeriod.findFirst({ where: { id, companyId } });
      if (!period) throw new NotFoundException('Fiscal period not found');
      if (period.status === PeriodStatus.CLOSED) {
        throw new BadRequestException('A closed period cannot be changed');
      }
      const startDate = dto.startDate ? this.date(dto.startDate, 'startDate') : period.startDate;
      const endDate = dto.endDate ? this.date(dto.endDate, 'endDate') : period.endDate;
      if (endDate < startDate) {
        throw new BadRequestException('The end date must be after the start date');
      }
      await this.assertNoOverlap(tx, companyId, startDate, endDate, id);
      const updated = await tx.fiscalPeriod.update({
        where: { id }, data: { nameEn: dto.nameEn?.trim(), nameAr: dto.nameAr?.trim(), startDate, endDate },
      });
      await this.audit.recordRequired({
        companyId, userId, action: 'fiscal_period.update', entity: 'fiscal_periods', entityId: id,
        before: { startDate: this.day(period.startDate), endDate: this.day(period.endDate) },
        after: { startDate: this.day(startDate), endDate: this.day(endDate) },
      }, tx);
      return this.toResponse(updated);
    });
  }

  private async assertNoOverlap(tx: Prisma.TransactionClient, companyId: string,
    startDate: Date, endDate: Date, excludeId?: string) {
    const overlapping = await tx.fiscalPeriod.findFirst({
      where: { companyId, ...(excludeId ? { id: { not: excludeId } } : {}),
        startDate: { lte: endDate }, endDate: { gte: startDate } },
    });
    if (overlapping) {
      throw new BadRequestException(
        `That range overlaps period ${overlapping.code} (${this.day(overlapping.startDate)} to ${this.day(overlapping.endDate)})`,
      );
    }
  }

  /// Close and its audit are atomic; draft insertion in all modules still
  /// requires a shared protocol and must not be assumed serialized here.
  async close(companyId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockPeriod(tx, companyId, id);
      const period = await tx.fiscalPeriod.findFirst({ where: { id, companyId } });
      if (!period) throw new NotFoundException('Fiscal period not found');
      if (period.status === PeriodStatus.CLOSED) {
        throw new BadRequestException('This period is already closed');
      }
      // Legacy data can contain overlapping periods from earlier releases.
      // The DB posting trigger locks only one matching row, so an ambiguous
      // range is not safe to close until the overlaps are corrected.
      const overlap = await tx.fiscalPeriod.findFirst({
        where: { companyId, id: { not: period.id },
          startDate: { lte: period.endDate }, endDate: { gte: period.startDate } },
        select: { id: true },
      });
      if (overlap) {
        throw new BadRequestException('This fiscal period overlaps another period; correct the ranges before closing.');
      }
      const date = { gte: period.startDate, lte: period.endDate };
      const [entries, sales, purchases, vouchers, transfers, stock, opening] = await Promise.all([
        tx.journalEntry.count({ where: { companyId, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] }, entryDate: date } }),
        tx.salesInvoice.count({ where: { companyId, deletedAt: null, status: 'DRAFT', invoiceDate: date } }),
        tx.purchaseInvoice.count({ where: { companyId, deletedAt: null, status: 'DRAFT', invoiceDate: date } }),
        tx.cashVoucher.count({ where: { companyId, deletedAt: null, status: 'DRAFT', voucherDate: date } }),
        tx.cashTransfer.count({ where: { companyId, deletedAt: null, status: 'DRAFT', transferDate: date } }),
        tx.stockDocument.count({ where: { companyId, deletedAt: null, status: 'DRAFT', documentDate: date } }),
        tx.openingBalance.count({ where: { companyId, deletedAt: null, status: 'DRAFT', asOfDate: date } }),
      ]);
      const drafts = entries + sales + purchases + vouchers + transfers + stock + opening;
      if (drafts > 0) {
        throw new BadRequestException(`${drafts} draft document(s) fall inside this period. Post or delete them before closing.`);
      }
      const closed = await tx.fiscalPeriod.update({
        where: { id }, data: { status: PeriodStatus.CLOSED, closedAt: new Date(), closedBy: userId },
      });
      await this.audit.recordRequired({
        companyId, userId, action: 'fiscal_period.close', entity: 'fiscal_periods', entityId: id,
        after: { status: 'CLOSED' },
      }, tx);
      return this.toResponse(closed);
    });
  }

  /// The period a date falls inside, or null when the date is outside every
  /// period.
  ///
  /// Posting outside any period is allowed: a company that has not created
  /// next year's period yet should not be unable to work on the first of
  /// January. Only a *closed* period blocks.
  async periodFor(tx: any, companyId: string, date: Date) {
    return tx.fiscalPeriod.findFirst({
      where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
    });
  }

  private date(value: string, field: string): Date {
    const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} is not a valid date`);
    }
    return parsed;
  }

  private day(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private toResponse(period: any) {
    return {
      id: period.id,
      companyId: period.companyId,
      code: period.code,
      nameEn: period.nameEn,
      nameAr: period.nameAr,
      startDate: this.day(period.startDate),
      endDate: this.day(period.endDate),
      status: period.status.toLowerCase(),
      closedAt: period.closedAt?.toISOString() ?? null,
      isClosed: period.status === PeriodStatus.CLOSED,
    };
  }
}
