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
import { CompanyService } from '../company/company.service';
import { ExportQueryDto } from './dto/export-query.dto';
import { ListTablesService } from './list-tables.service';
import {
  EXPORTABLE_REPORTS,
  ExportableReport,
  ReportTablesService,
} from './report-tables.service';
import { DocumentsService } from './documents.service';
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
    private readonly company: CompanyService,
    private readonly documents: DocumentsService,
  ) {}

  /// The company's name and logo for the file header. The logo is optional and
  /// only fetched when the company has one.
  private async companyHeader(companyId: string, lang: Lang): Promise<{
    name: string;
    logo: { data: Buffer; mime: string } | null;
    details: Array<{ labelEn: string; labelAr: string; value: string }>;
  }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        code: true,
        nameEn: true,
        nameAr: true,
        timezone: true,
        taxId: true,
        commercialRegistration: true,
        phone: true,
        email: true,
        address: true,
        addressEn: true,
        addressAr: true,
        currency: true,
      },
    });
    const name = lang === 'ar'
      ? company?.nameAr || company?.nameEn || 'كيان'
      : company?.nameEn || company?.nameAr || 'KAYAN';
    const address = lang === 'ar'
      ? company?.addressAr || company?.address || company?.addressEn
      : company?.addressEn || company?.address || company?.addressAr;
    const details = [
      { labelEn: 'Company code', labelAr: 'كود الشركة', value: company?.code ?? '' },
      { labelEn: 'Tax ID', labelAr: 'الرقم الضريبي', value: company?.taxId ?? '' },
      {
        labelEn: 'Commercial registration',
        labelAr: 'السجل التجاري',
        value: company?.commercialRegistration ?? '',
      },
      { labelEn: 'Phone', labelAr: 'الهاتف', value: company?.phone ?? '' },
      { labelEn: 'Email', labelAr: 'البريد الإلكتروني', value: company?.email ?? '' },
      { labelEn: 'Address', labelAr: 'العنوان', value: address ?? '' },
      { labelEn: 'Currency', labelAr: 'العملة', value: company?.currency ?? '' },
      { labelEn: 'Time zone', labelAr: 'المنطقة الزمنية', value: company?.timezone ?? '' },
    ].filter((item) => item.value.trim().length > 0);
    const logo = await this.company.getLogo(companyId);
    return { name, logo, details };
  }

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

  @Get('documents/:kind/:id/download')
  @AllowQueryToken()
  async documentFile(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query() query: ExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const spec = this.documents.spec(kind);
    this.allowedExport(user, spec.readPermission, spec.exportPermission);
    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const table = await this.documents.build(spec.kind, user.companyId, id, lang);
    const header = await this.companyHeader(user.companyId, lang);
    const stamp = this.stamp();
    if (query.format === 'csv') {
      this.send(response, toCsv(table, lang, header.name, header.details), 'text/csv; charset=utf-8', `${kind}-${stamp}.csv`);
      return;
    }
    this.send(
      response,
      await toXlsx(table, lang, header.name, { logo: header.logo, companyDetails: header.details }),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${kind}-${stamp}.xlsx`,
    );
  }

  @Get('documents/:kind/:id/pdf')
  @AllowQueryToken()
  async documentPdf(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query() query: ExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const spec = this.documents.spec(kind);
    this.allowedExport(user, spec.readPermission, spec.exportPermission);
    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const table = await this.documents.build(spec.kind, user.companyId, id, lang);
    const header = await this.companyHeader(user.companyId, lang);
    const html = toPrintHtml(table, lang, header.name, {
      autoPrint: false,
      logo: header.logo,
      companyDetails: header.details,
    });
    this.send(response, await this.pdf.render(html), 'application/pdf', `${kind}-${this.stamp()}.pdf`);
  }

  @Get('documents/:kind/:id/print')
  @AllowQueryToken()
  async documentPrint(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query() query: ExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const spec = this.documents.spec(kind);
    this.allowed(user, spec.readPermission);
    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const table = await this.documents.build(spec.kind, user.companyId, id, lang);
    const header = await this.companyHeader(user.companyId, lang);
    const html = toPrintHtml(table, lang, header.name, {
      autoPrint: query.auto === '1' || query.auto === 'true',
      logo: header.logo,
      companyDetails: header.details,
    });
    response.type('text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.send(html);
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
    const header = await this.companyHeader(user.companyId, lang);
    const stamp = this.stamp();

    if (query.format === 'csv') {
      this.send(
        response,
        toCsv(table, lang, header.name, header.details),
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
      await toXlsx(table, lang, header.name, { logo: header.logo, companyDetails: header.details }),
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
    const header = await this.companyHeader(user.companyId, lang);

    const html = toPrintHtml(table, lang, header.name, {
      autoPrint: false,
      logo: header.logo,
      companyDetails: header.details,
    });
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
    const header = await this.companyHeader(user.companyId, lang);

    const html = toPrintHtml(table, lang, header.name, {
      autoPrint: query.auto === '1' || query.auto === 'true',
      logo: header.logo,
      companyDetails: header.details,
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

  /// A file needs the export permission when the user has it assigned anywhere
  /// in the catalogue of their roles; otherwise the matching read permission
  /// still opens the same file so existing accounts keep working.
  private allowedExport(user: AuthUser, read: string, exportPermission: string): void {
    if (user.isSuperAdmin) return;
    if (user.permissions.includes(exportPermission)) return;
    if (user.permissions.includes(read)) return;
    throw new ForbiddenException(`Missing permission: ${exportPermission}`);
  }

  /// The spreadsheet: a real .xlsx that opens in Excel and in Google Sheets.
  @Get(':report/download')
  @AllowQueryToken()
  async export(
    @CurrentUser() user: AuthUser,
    @Param('report') report: string,
    @Query() query: ExportQueryDto,
    @Res() response: Response,
  ) {
    this.allowedExport(user, 'reports.read', 'reports.export');
    const slug = this.known(report);
    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const wanted = (query as { format?: string }).format ?? 'xlsx';

    const table = await this.tables.build(slug, user.companyId, query, lang);
    const header = await this.companyHeader(user.companyId, lang);

    if (wanted === 'csv') {
      const body = toCsv(table, lang, header.name, header.details);
      this.send(response, body, 'text/csv; charset=utf-8', `${slug}-${this.stamp()}.csv`);
      return;
    }

    if (wanted !== 'xlsx') {
      throw new BadRequestException(
        `Unknown format "${wanted}". Use format=xlsx or format=csv.`,
      );
    }

    const body = await toXlsx(table, lang, header.name, { logo: header.logo, companyDetails: header.details });
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
  async pdfFile(
    @CurrentUser() user: AuthUser,
    @Param('report') report: string,
    @Query() query: ExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    this.allowedExport(user, 'reports.read', 'reports.export');
    const slug = this.known(report);
    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const table = await this.tables.build(slug, user.companyId, query, lang);
    const header = await this.companyHeader(user.companyId, lang);

    const html = toPrintHtml(table, lang, header.name, {
      autoPrint: false,
      logo: header.logo,
      companyDetails: header.details,
    });
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
    const header = await this.companyHeader(user.companyId, lang);

    const html = toPrintHtml(table, lang, header.name, {
      autoPrint: query.auto === '1' || query.auto === 'true',
      logo: header.logo,
      companyDetails: header.details,
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

  private send(
    response: Response,
    body: Buffer,
    contentType: string,
    filename: string,
  ) {
    response.setHeader('Content-Type', contentType);
    // Two names, because a browser and Excel do not agree: the plain one for
    // anything that only reads the first form, and the RFC 5987 one, which is
    // the only form that can carry an Arabic name. Anything past the last
    // slash is dropped — a name in a header is either a mistake or an
    // attempt, and neither belongs in a save dialogue.
    const bare = filename.split(/[\\/]/).pop() ?? 'download';
    response.setHeader(
      'Content-Disposition',
      /[\u0080-\uffff]/.test(bare)
        ? `attachment; filename="${bare.replace(/[^\x20-\x7e]/g, '_')}"; `
            + `filename*=UTF-8''${encodeURIComponent(bare)}`
        : `attachment; filename="${bare}"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.end(body);
  }

  private stamp(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
