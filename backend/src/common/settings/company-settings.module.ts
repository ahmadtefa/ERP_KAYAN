import { BadRequestException, Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

/// Which valuation method this installation uses. One method per installation,
/// stored as a setting rather than assumed, because a report that values stock
/// differently from the ledger is worse than no report.
export const VALUATION_METHODS = ['WEIGHTED_AVERAGE'] as const;
export type ValuationMethod = (typeof VALUATION_METHODS)[number];

export interface CompanySettings {
  taxRate: string;
  pricesIncludeTax: boolean;
  allowNegativeStock: boolean;
  inventoryValuation: string;
  approvalRequiredForJournal: boolean;
  segregationOfDuties: boolean;
  backupRetentionCount: number;
  backupIntervalHours: number;
  maxDiscountPercent: string;
}

/// The company's own policies, in one place.
///
/// Everything that posting logic decides from a company choice reads it here,
/// so "may this company sell stock it does not have?" is answered by one
/// setting rather than by a condition buried in a service.
@Injectable()
export class CompanySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /// Reads the settings, creating the row with its defaults the first time.
  /// A company that has never opened the settings screen still has settings.
  async get(companyId: string): Promise<CompanySettings & { companyId: string }> {
    const row =
      (await this.prisma.companySetting.findUnique({ where: { companyId } })) ??
      (await this.prisma.companySetting.create({ data: { companyId } }));
    return this.toResponse(row);
  }

  async update(
    companyId: string,
    userId: string,
    dto: Record<string, unknown>,
  ): Promise<CompanySettings & { companyId: string }> {
    const before = await this.get(companyId);
    const data: Prisma.CompanySettingUpdateInput = { updatedBy: userId };

    if (dto.taxRate !== undefined) {
      data.taxRate = this.rate(dto.taxRate, 'taxRate', 0, 100);
    }
    if (dto.maxDiscountPercent !== undefined) {
      data.maxDiscountPercent = this.rate(dto.maxDiscountPercent, 'maxDiscountPercent', 0, 100);
    }
    if (dto.pricesIncludeTax !== undefined) {
      data.pricesIncludeTax = this.flag(dto.pricesIncludeTax, 'pricesIncludeTax');
    }
    if (dto.approvalRequiredForJournal !== undefined) {
      data.approvalRequiredForJournal = this.flag(
        dto.approvalRequiredForJournal,
        'approvalRequiredForJournal',
      );
    }
    if (dto.segregationOfDuties !== undefined) {
      data.segregationOfDuties = this.flag(dto.segregationOfDuties, 'segregationOfDuties');
    }
    if (dto.allowNegativeStock !== undefined) {
      const value = this.flag(dto.allowNegativeStock, 'allowNegativeStock');
      // Turning this on changes what the system guarantees about stock, so it
      // is written down loudly in the audit trail rather than silently saved.
      data.allowNegativeStock = value;
    }
    if (dto.inventoryValuation !== undefined) {
      const method = String(dto.inventoryValuation).toUpperCase();
      if (!VALUATION_METHODS.includes(method as ValuationMethod)) {
        throw new BadRequestException(
          `Unsupported valuation method "${dto.inventoryValuation}". This installation supports: ${VALUATION_METHODS.join(', ')}`,
        );
      }
      // Switching method on a company that already holds stock would make
      // every figure before today incomparable with every figure after it.
      if (method !== before.inventoryValuation) {
        const stock = await this.prisma.stockBalance.count({
          where: { companyId, quantity: { not: 0 } },
        });
        if (stock > 0) {
          throw new BadRequestException(
            'The valuation method cannot be changed while there is stock on hand: ' +
              'the figures before and after the change would not be comparable.',
          );
        }
      }
      data.inventoryValuation = method;
    }
    if (dto.backupRetentionCount !== undefined) {
      data.backupRetentionCount = this.count(dto.backupRetentionCount, 'backupRetentionCount', 0, 3650);
    }
    if (dto.backupIntervalHours !== undefined) {
      data.backupIntervalHours = this.count(dto.backupIntervalHours, 'backupIntervalHours', 0, 8760);
    }

    const updated = await this.prisma.companySetting.upsert({
      where: { companyId },
      create: { companyId, ...(data as Prisma.CompanySettingCreateInput) } as never,
      update: data,
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'company_settings',
      entityId: companyId,
      before,
      after: this.toResponse(updated),
    });

    return this.toResponse(updated);
  }

  private flag(value: unknown, field: string): boolean {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new BadRequestException(`${field} must be true or false`);
  }

  private rate(value: unknown, field: string, min: number, max: number): Prisma.Decimal {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(String(value)).toDecimalPlaces(4);
    } catch {
      throw new BadRequestException(`${field} is not a valid number`);
    }
    if (decimal.lessThan(min) || decimal.greaterThan(max)) {
      throw new BadRequestException(`${field} must be between ${min} and ${max}`);
    }
    return decimal;
  }

  private count(value: unknown, field: string, min: number, max: number): number {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
      throw new BadRequestException(`${field} must be a whole number between ${min} and ${max}`);
    }
    return number;
  }

  private toResponse(row: {
    companyId: string;
    taxRate: Prisma.Decimal;
    pricesIncludeTax: boolean;
    allowNegativeStock: boolean;
    inventoryValuation: string;
    approvalRequiredForJournal: boolean;
    segregationOfDuties: boolean;
    backupRetentionCount: number;
    backupIntervalHours: number;
    maxDiscountPercent: Prisma.Decimal;
  }): CompanySettings & { companyId: string } {
    return {
      companyId: row.companyId,
      taxRate: row.taxRate.toFixed(4),
      pricesIncludeTax: row.pricesIncludeTax,
      allowNegativeStock: row.allowNegativeStock,
      inventoryValuation: row.inventoryValuation,
      approvalRequiredForJournal: row.approvalRequiredForJournal,
      segregationOfDuties: row.segregationOfDuties,
      backupRetentionCount: row.backupRetentionCount,
      backupIntervalHours: row.backupIntervalHours,
      maxDiscountPercent: row.maxDiscountPercent.toFixed(4),
    };
  }
}

@Global()
@Module({
  imports: [PrismaModule],
  providers: [CompanySettingsService],
  exports: [CompanySettingsService],
})
export class CompanySettingsModule {}
