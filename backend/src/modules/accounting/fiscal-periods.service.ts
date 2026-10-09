import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PeriodStatus } from '@prisma/client';

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

  async create(companyId: string, userId: string, dto: CreateFiscalPeriodDto) {
    const code = dto.code.trim().toUpperCase();
    const startDate = this.date(dto.startDate, 'startDate');
    const endDate = this.date(dto.endDate, 'endDate');
    if (endDate < startDate) {
      throw new BadRequestException('The end date must be after the start date');
    }

    const existing = await this.prisma.fiscalPeriod.findFirst({
      where: { companyId, code },
    });
    if (existing) throw new ConflictException('A period with that code already exists');

    // Overlapping periods would make "which year is this entry in?"
    // unanswerable, so overlaps are refused outright.
    const overlapping = await this.prisma.fiscalPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        `That range overlaps period ${overlapping.code} (${this.day(overlapping.startDate)} to ${this.day(overlapping.endDate)})`,
      );
    }

    const created = await this.prisma.fiscalPeriod.create({
      data: {
        companyId,
        code,
        nameEn: dto.nameEn.trim(),
        nameAr: dto.nameAr.trim(),
        startDate,
        endDate,
        status: PeriodStatus.OPEN,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'fiscal_period.create',
      entity: 'fiscal_periods',
      entityId: created.id,
      after: { code, startDate: dto.startDate, endDate: dto.endDate },
    });
    return this.toResponse(created);
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateFiscalPeriodDto,
  ) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { id, companyId },
    });
    if (!period) throw new NotFoundException('Fiscal period not found');
    if (period.status === PeriodStatus.CLOSED) {
      throw new BadRequestException('A closed period cannot be changed');
    }

    const startDate = dto.startDate ? this.date(dto.startDate, 'startDate') : period.startDate;
    const endDate = dto.endDate ? this.date(dto.endDate, 'endDate') : period.endDate;
    if (endDate < startDate) {
      throw new BadRequestException('The end date must be after the start date');
    }

    const updated = await this.prisma.fiscalPeriod.update({
      where: { id },
      data: {
        nameEn: dto.nameEn?.trim(),
        nameAr: dto.nameAr?.trim(),
        startDate,
        endDate,
      },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'fiscal_period.update',
      entity: 'fiscal_periods',
      entityId: id,
      before: {
        startDate: this.day(period.startDate),
        endDate: this.day(period.endDate),
      },
      after: { startDate: this.day(startDate), endDate: this.day(endDate) },
    });
    return this.toResponse(updated);
  }

  /// Closes a period, and refuses if anything is still only a draft inside it.
  ///
  /// Closing a year while drafts are outstanding would leave figures that can
  /// never be posted, so the drafts are surfaced instead.
  async close(companyId: string, userId: string, id: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { id, companyId },
    });
    if (!period) throw new NotFoundException('Fiscal period not found');
    if (period.status === PeriodStatus.CLOSED) {
      throw new BadRequestException('This period is already closed');
    }

    const draftEntries = await this.prisma.journalEntry.count({
      where: {
        companyId,
        status: 'DRAFT',
        entryDate: { gte: period.startDate, lte: period.endDate },
      },
    });
    const draftSales = await this.prisma.salesInvoice.count({
      where: {
        companyId,
        deletedAt: null,
        status: 'DRAFT',
        invoiceDate: { gte: period.startDate, lte: period.endDate },
      },
    });
    const draftPurchases = await this.prisma.purchaseInvoice.count({
      where: {
        companyId,
        deletedAt: null,
        status: 'DRAFT',
        invoiceDate: { gte: period.startDate, lte: period.endDate },
      },
    });
    const drafts = draftEntries + draftSales + draftPurchases;
    if (drafts > 0) {
      throw new BadRequestException(
        `${drafts} draft document(s) fall inside this period. Post or delete them before closing.`,
      );
    }

    const closed = await this.prisma.fiscalPeriod.update({
      where: { id },
      data: { status: PeriodStatus.CLOSED, closedAt: new Date(), closedBy: userId },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'fiscal_period.close',
      entity: 'fiscal_periods',
      entityId: id,
      after: { status: 'CLOSED' },
    });
    return this.toResponse(closed);
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
