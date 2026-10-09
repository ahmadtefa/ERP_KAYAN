import {
  BadRequestException,
  Controller,
  ForbiddenException,
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
import { ListTablesService } from './list-tables.service';
import {
  EXPORTABLE_REPORTS,
  ExportableReport,
  ReportTablesService,
} from './report-tables.service';
import { PdfService } from './pdf.service';
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
    private readonly pdf: PdfService,
    private readonly lists: ListTablesService,
  ) {}

  /// What this installation can produce, so the screen only offers buttons
  /// that work.
  ///
  /// xlsx and csv are written by the program itself and are always available.
  /// A PDF needs a browser on the machine to lay out Arabic; when there is
  /// none, the print button still works and saves the same file from the
  /// browser's own print dialogue.
  @Get('capabilities')
  async capabilities() {
    return {
      formats: this.pdf.available ? ['xlsx', 'csv', 'pdf'] : ['xlsx', 'csv'],
      pdfOnTheServer: this.pdf.available,
    };
  }

/// ───────────────────────────────── the everyday lists, as files

  /// Which lists can be downloaded, so the client can build a menu without
  /// hardcoding names that might change.
  @Get('lists')
  catalogue() {
    return { items: this.lists.catalogue() };
  }

  /// A list as a file: .xlsx by default, .csv on request.
  @Get('lists/:list/download')
  @AllowQueryToken()
  async listFile(
    @CurrentUser() user: AuthUser,
    @Param('list') list: string,
    @Query() query: ExportQueryDto & Record<string, string>,
    @Res() response: Response,
  ): Promise<void> {
    const spec = this.lists.known(list);
    this.allowed(user, spec.permission);

    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const table = await this.lists.build(list, user.companyId, query);
    const companyName = await this.companyName(user.companyId);
    const stamp = this.stamp();

    if (query.format === 'csv') {
      this.send(
        response,
        toCsv(table, lang, companyName),
        'text/csv; charset=utf-8',
        `${list}-${stamp}.csv`,
      );
      return;
    }
    if (query.format && query.format !== 'xlsx') {
      throw new BadRequestException(
        `Unknown format "${query.format}". Use format=xlsx or format=csv.`,
      );
    }

    this.send(
      response,
      await toXlsx(table, lang, companyName),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${list}-${stamp}.xlsx`,
    );
  }

  /// A list as a PDF, downloaded straight away.
  @Get('lists/:list/pdf')
  @AllowQueryToken()
  async listPdf(
    @CurrentUser() user: AuthUser,
    @Param('list') list: string,
    @Query() query: ExportQueryDto & Record<string, string>,
    @Res() response: Response,
  ): Promise<void> {
    const spec = this.lists.known(list);
    this.allowed(user, spec.permission);

    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const table = await this.lists.build(list, user.companyId, query);
    const companyName = await this.companyName(user.companyId);

    const html = toPrintHtml(table, lang, companyName, { autoPrint: false });
    this.send(response, await this.pdf.render(html), 'application/pdf', `${list}-${this.stamp()}.pdf`);
  }

  /// A list as a page to print.
  @Get('lists/:list/print')
  @AllowQueryToken()
  async listPrint(
    @CurrentUser() user: AuthUser,
    @Param('list') list: string,
    @Query() query: ExportQueryDto & Record<string, string>,
    @Res() response: Response,
  ): Promise<void> {
    const spec = this.lists.known(list);
    this.allowed(user, spec.permission);

    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const table = await this.lists.build(list, user.companyId, query);
    const companyName = await this.companyName(user.companyId);

    const html = toPrintHtml(table, lang, companyName, {
      autoPrint: query.auto === '1' || query.auto === 'true',
    });
    response.type('text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.send(html);
  }

  /// The permission a list needs is the one its own screen already requires.
  /// The controller checks it here because the list is chosen from the path.
  private allowed(user: AuthUser, permission: string): void {
    if (user.isSuperAdmin) return;
    if (!user.permissions.includes(permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
  }

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

  /// The report as a PDF file, downloaded straight away.
  ///
  /// The same page the print button opens, handed to a browser on the server
  /// and saved as a PDF. One click, no dialogue.
  @Get(':report/pdf')
  @AllowQueryToken()
  @RequirePermissions('reports.read')
  async pdfFile(
    @CurrentUser() user: AuthUser,
    @Param('report') report: string,
    @Query() query: ExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const slug = this.known(report);
    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const table = await this.tables.build(slug, user.companyId, query, lang);
    const companyName = await this.companyName(user.companyId);

    const html = toPrintHtml(table, lang, companyName, { autoPrint: false });
    const body = await this.pdf.render(html);

    this.send(response, body, 'application/pdf', `${slug}-${this.stamp()}.pdf`);
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
