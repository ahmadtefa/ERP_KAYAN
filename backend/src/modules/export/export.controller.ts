import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { AllowQueryToken } from '../../common/decorators/allow-query-token.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ExportQueryDto } from './dto/export-query.dto';
import {
  EXPORTABLE_REPORTS,
  ExportableReport,
  ReportTablesService,
} from './report-tables.service';
import { Lang, toCsv, toPrintHtml, toXlsx } from './writers';

/// Downloadable files and a printable page for every report.
///
/// Kept apart from the reports controller on purpose: that one answers with
/// JSON to be read on screen, this one answers with a file to be kept or
/// printed. Same numbers, different wrapping.
///
/// The path is `exports/...` rather than `reports/.../export` because the
/// reports controller already owns `/reports/account-ledger/:accountId` and,
/// being registered first, it would swallow `/reports/account-ledger/export`
/// and answer with a validation error for the ledger.
@Controller('exports')
export class ExportController {
  constructor(
    private readonly tables: ReportTablesService,
    private readonly prisma: PrismaService,
  ) {}

  /// The spreadsheet: a real .xlsx that opens in Excel and in Google Sheets.
  @Get(':report/download')
  @AllowQueryToken()
  @RequirePermissions('reports.read')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('report') report: string,
    @Query() query: ExportQueryDto,
    @Res() response: Response,
  ) {
    const slug = this.known(report);
    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const wanted = (query as { format?: string }).format ?? 'xlsx';

    const table = await this.tables.build(slug, user.companyId, query, lang);
    const companyName = await this.companyName(user.companyId);

    if (wanted === 'csv') {
      const body = toCsv(table, lang, companyName);
      this.send(response, body, 'text/csv; charset=utf-8', `${slug}-${this.stamp()}.csv`);
      return;
    }

    if (wanted !== 'xlsx') {
      throw new BadRequestException(
        `Unknown format "${wanted}". Use format=xlsx or format=csv.`,
      );
    }

    const body = await toXlsx(table, lang, companyName);
    this.send(
      response,
      body,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${slug}-${this.stamp()}.xlsx`,
    );
  }

  /// The printable page: opens in a tab, and the browser turns it into a PDF.
  ///
  /// `auto=1` makes the print dialogue open by itself, so the whole thing is
  /// one click from the button in the app.
  @Get(':report/print')
  @AllowQueryToken()
  @RequirePermissions('reports.read')
  async print(
    @CurrentUser() user: AuthUser,
    @Param('report') report: string,
    @Query() query: ExportQueryDto,
    @Res() response: Response,
  ) {
    const slug = this.known(report);
    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const table = await this.tables.build(slug, user.companyId, query, lang);
    const companyName = await this.companyName(user.companyId);

    const html = toPrintHtml(table, lang, companyName, {
      autoPrint: query.auto === '1' || query.auto === 'true',
    });

    response.type('text/html; charset=utf-8');
    // The page is built from the company's own data and never cached.
    response.setHeader('Cache-Control', 'no-store');
    response.send(html);
  }

  private known(report: string): ExportableReport {
    if (!EXPORTABLE_REPORTS.includes(report as ExportableReport)) {
      throw new BadRequestException(
        `Unknown report "${report}". Known reports: ${EXPORTABLE_REPORTS.join(', ')}.`,
      );
    }
    return report as ExportableReport;
  }

  private async companyName(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { nameEn: true, nameAr: true },
    });
    return company?.nameAr ?? company?.nameEn ?? 'KAYAN';
  }

  private send(
    response: Response,
    body: Buffer,
    contentType: string,
    filename: string,
  ) {
    response.setHeader('Content-Type', contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.end(body);
  }

  private stamp(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
