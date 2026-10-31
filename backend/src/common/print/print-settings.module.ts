import { BadRequestException, Global, Injectable, Module } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrintSettingsController } from './print-settings.controller';
import type { CostVisibilityCaller } from '../auth/cost-visibility';
import {
  DEFAULT_PRINT_TYPE,
  PRINT_TYPES,
  type PrintPriceSetting,
  type RequestedVisibility,
  type ResolvedPrintVisibility,
  isPrintType,
  resolvePrintVisibility,
} from './print-settings';

export interface PrintSettingsResponse {
  /// The types the program can print, with the label each screen shows.
  types: (typeof PRINT_TYPES)[number][];
  /// Only the types the company has actually configured. A missing key means
  /// "use the default", which is not the same as "saved as visible".
  settings: PrintPriceSetting[];
  /// What the company decided for everything not configured.
  default: PrintPriceSetting;
}

/// The saved answer to "what does a printed copy show?", per print type.
///
/// Stored in the database rather than on the machine, because it is a company
/// policy: it has to survive a reinstall, follow the company into a backup and
/// mean the same thing for every operator at every station. It never touches
/// the prices themselves - redaction happens to the rendered copy on its way
/// out, so the invoice in the database keeps every figure it always had.
@Injectable()
export class PrintSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(companyId: string): Promise<PrintSettingsResponse> {
    const rows = await this.prisma.printPriceSetting.findMany({
      where: { companyId },
      orderBy: { documentType: 'asc' },
    });
    const settings = rows.map((row) => ({
      documentType: row.documentType,
      showSalePrice: row.showSalePrice,
      showCost: row.showCost,
    }));
    return {
      types: [...PRINT_TYPES],
      settings,
      default:
        settings.find((row) => row.documentType === DEFAULT_PRINT_TYPE) ?? {
          documentType: DEFAULT_PRINT_TYPE,
          showSalePrice: true,
          showCost: true,
        },
    };
  }

  /// Saves one or more types in one transaction, and records what changed.
  /// A type that is not on the catalogue is refused: a setting nothing prints
  /// by is a setting nobody can verify.
  async save(
    companyId: string,
    userId: string,
    entries: Array<{ documentType: string; showSalePrice: boolean; showCost: boolean }>,
  ): Promise<PrintSettingsResponse> {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new BadRequestException(
        'لا توجد إعدادات للحفظ. / There are no settings to save.',
      );
    }
    if (entries.length > PRINT_TYPES.length + 1) {
      throw new BadRequestException('Too many print settings in one request');
    }
    const seen = new Set<string>();
    for (const entry of entries) {
      const type = String(entry?.documentType ?? '').trim();
      if (type !== DEFAULT_PRINT_TYPE && !isPrintType(type)) {
        throw new BadRequestException(
          `نوع طباعة غير معروف: ${type} / Unknown print type: ${type}`,
        );
      }
      if (seen.has(type)) {
        throw new BadRequestException(`Duplicate print type: ${type}`);
      }
      seen.add(type);
      if (typeof entry.showSalePrice !== 'boolean' || typeof entry.showCost !== 'boolean') {
        throw new BadRequestException(
          `إعداد غير صالح للنوع ${type}: يجب أن تكون القيم true أو false. / ` +
            `Invalid setting for ${type}: both values must be true or false.`,
        );
      }
    }

    const before = (await this.get(companyId)).settings;
    await this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.printPriceSetting.upsert({
          where: {
            companyId_documentType: {
              companyId,
              documentType: entry.documentType.trim(),
            },
          },
          create: {
            companyId,
            documentType: entry.documentType.trim(),
            showSalePrice: entry.showSalePrice,
            showCost: entry.showCost,
            updatedBy: userId,
          },
          update: {
            showSalePrice: entry.showSalePrice,
            showCost: entry.showCost,
            updatedBy: userId,
          },
        }),
      ),
    );

    const after = (await this.get(companyId)).settings;
    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'print_price_settings',
      entityId: companyId,
      before: { settings: before },
      after: { settings: after },
    });
    return this.get(companyId);
  }

  /// The effective answer for one print. Used by every PDF and print route.
  async resolve(
    companyId: string,
    caller: CostVisibilityCaller,
    requested: RequestedVisibility,
    typeKey?: string | null,
  ): Promise<ResolvedPrintVisibility> {
    const stored = await this.prisma.printPriceSetting.findMany({
      where: { companyId },
      select: { documentType: true, showSalePrice: true, showCost: true },
    });
    return resolvePrintVisibility(caller, requested, stored, typeKey);
  }
}

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [PrintSettingsController],
  providers: [PrintSettingsService],
  exports: [PrintSettingsService],
})
export class PrintSettingsModule {}
