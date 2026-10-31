import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  BACKGROUND_UPLOAD_MAX_BYTES,
  DEFAULT_BACKGROUND_SETTINGS,
  colourToHex,
  inspectPdfUpload,
  parseBackgroundSettings,
} from './quotation-background';

export interface UploadedBackgroundFile {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

/// What a screen sees about stored artwork. Never the bytes: a listing that
/// carried an 8 MB PDF per row would make the template screen slow for no
/// reason, and the file is one request away when it is actually shown.
export interface BackgroundSummary {
  id: string;
  name: string;
  mimeType: string;
  byteSize: number;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  sha256: string;
  createdAt: Date;
}

/// The artwork library behind the quotation templates.
///
/// The bytes are a `bytea` column, the same choice the company logo makes and
/// for the same reason: a full database backup carries the artwork, a restore
/// brings it back, and nothing in the printed sheet points at a network
/// location - so a quotation prints identically on an offline machine. A
/// soft-deleted file keeps its bytes while an issued offer still names it;
/// history is allowed to reprint.
@Injectable()
export class QuotationBackgroundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string): Promise<BackgroundSummary[]> {
    const rows = await this.prisma.quotationBackground.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        mimeType: true,
        byteSize: true,
        pageCount: true,
        pageWidth: true,
        pageHeight: true,
        sha256: true,
        createdAt: true,
      },
    });
    return rows;
  }

  /// Stores what arrived, after proving it is a PDF that can be printed on.
  ///
  /// An identical file - same digest - is returned instead of stored twice:
  /// pressing "upload" twice on the same letterhead is a mistake, not a
  /// library of two.
  async upload(
    companyId: string,
    userId: string,
    file: UploadedBackgroundFile,
    name?: string,
  ): Promise<BackgroundSummary> {
    const info = await inspectPdfUpload({
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      maxBytes: BACKGROUND_UPLOAD_MAX_BYTES,
    });

    const existing = await this.prisma.quotationBackground.findFirst({
      where: { companyId, sha256: info.sha256, deletedAt: null },
      select: { id: true, name: true },
    });
    if (existing) {
      throw new ConflictException(
        `هذا الملف مضاف بالفعل باسم «${existing.name}». / The same file is already attached as "${existing.name}".`,
      );
    }

    const label = this.cleanName(name, file.originalname);
    const row = await this.prisma.quotationBackground.create({
      data: {
        companyId,
        name: label,
        mimeType: 'application/pdf',
        byteSize: info.byteSize,
        pageCount: info.pageCount,
        pageWidth: info.pageWidth,
        pageHeight: info.pageHeight,
        sha256: info.sha256,
        data: file.buffer,
        createdBy: userId,
      },
      select: {
        id: true,
        name: true,
        mimeType: true,
        byteSize: true,
        pageCount: true,
        pageWidth: true,
        pageHeight: true,
        sha256: true,
        createdAt: true,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'create',
      entity: 'QuotationBackground',
      entityId: row.id,
      after: {
        name: row.name,
        pageCount: row.pageCount,
        byteSize: row.byteSize,
        sha256: row.sha256,
      },
    });
    return row;
  }

  async rename(companyId: string, userId: string, id: string, name: string) {
    const existing = await this.requireRow(companyId, id);
    const row = await this.prisma.quotationBackground.update({
      where: { id: existing.id },
      data: { name: this.cleanName(name, existing.name) },
      select: {
        id: true,
        name: true,
        mimeType: true,
        byteSize: true,
        pageCount: true,
        pageWidth: true,
        pageHeight: true,
        sha256: true,
        createdAt: true,
      },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'update',
      entity: 'QuotationBackground',
      entityId: id,
      before: { name: existing.name },
      after: { name: row.name },
    });
    return row;
  }

  /// The bytes, for the preview and for the printer. `inline` is what the
  /// preview window needs: a PDF opened in the browser's own viewer, not a
  /// download that lands in the operator's Downloads folder.
  async file(companyId: string, id: string) {
    const row = await this.prisma.quotationBackground.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { data: true, mimeType: true, name: true, pageCount: true },
    });
    if (!row) throw new NotFoundException('Quotation background not found');
    return {
      data: Buffer.from(row.data),
      mimeType: row.mimeType,
      name: row.name,
      pageCount: row.pageCount,
    };
  }

  /// Removes artwork from the library, but never from history: an offer that
  /// has been issued is a document that was sent, and it must reprint.
  async remove(companyId: string, userId: string, id: string) {
    const existing = await this.requireRow(companyId, id);

    const issued = await this.prisma.quotation.count({
      where: {
        companyId,
        backgroundFileId: id,
        deletedAt: null,
        status: { not: 'DRAFT' },
      },
    });
    if (issued > 0) {
      throw new ConflictException(
        `الخلفية مستخدمة في ${issued} عرض سعر صادر، ولا يمكن حذفها. / ` +
          `The artwork is used by ${issued} issued quotation(s) and cannot be removed.`,
      );
    }

    // Drafts and templates that point at it lose the binding; the drawing
    // design takes over, which is exactly what they looked like before.
    await this.prisma.$executeRaw`
      UPDATE quotation_design_templates
         SET "backgroundId" = NULL, "background" = NULL
       WHERE "companyId" = ${companyId}::uuid AND "backgroundId" = ${id}::uuid
    `;
    await this.prisma.quotation.updateMany({
      where: { companyId, backgroundFileId: id, status: 'DRAFT' },
      data: { backgroundFileId: null, background: {} },
    });

    await this.prisma.quotationBackground.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'delete',
      entity: 'QuotationBackground',
      entityId: id,
      before: { name: existing.name, sha256: existing.sha256 },
    });
    return { id, deleted: true };
  }

  /// The bytes an issued offer prints on, or null when it prints on the drawn
  /// design. Used by the print and PDF routes through QuotationsService.
  async bytesFor(companyId: string, id: string): Promise<Buffer | null> {
    const row = await this.prisma.quotationBackground.findFirst({
      where: { id, companyId },
      select: { data: true, deletedAt: true },
    });
    if (!row) return null;
    return Buffer.from(row.data);
  }

  /// The bytes and the measured page box, for the print pipeline. Null when the
  /// file is gone, which lets an offer fall back to the drawn design instead of
  /// failing to print at all.
  async assetFor(
    companyId: string,
    id: string,
  ): Promise<{
    data: Buffer;
    pageCount: number;
    pageWidth: number;
    pageHeight: number;
  } | null> {
    const row = await this.prisma.quotationBackground.findFirst({
      where: { id, companyId },
      select: { data: true, pageCount: true, pageWidth: true, pageHeight: true },
    });
    if (!row) return null;
    return {
      data: Buffer.from(row.data),
      pageCount: row.pageCount,
      pageWidth: row.pageWidth,
      pageHeight: row.pageHeight,
    };
  }

  /// Confirms a file belongs to this company before it is bound to anything.
  async assertOwned(companyId: string, id: string) {
    const row = await this.prisma.quotationBackground.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, name: true, pageCount: true, pageWidth: true, pageHeight: true },
    });
    if (!row) {
      throw new BadRequestException(
        'ملف الخلفية غير موجود أو لا يتبع هذه الشركة. / The background file does not exist for this company.',
      );
    }
    return row;
  }

  /// The settings a template keeps, with the defaults filled in.
  static settings(raw: unknown, pageCount = Number.MAX_SAFE_INTEGER) {
    return parseBackgroundSettings(raw ?? DEFAULT_BACKGROUND_SETTINGS, pageCount);
  }

  static describe(settings: ReturnType<typeof parseBackgroundSettings>) {
    return {
      ...settings,
      pageNumberColorHex: colourToHex(settings.pageNumberColor),
    };
  }

  private async requireRow(companyId: string, id: string) {
    const row = await this.prisma.quotationBackground.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, name: true, sha256: true },
    });
    if (!row) throw new NotFoundException('Quotation background not found');
    return row;
  }

  private cleanName(name: string | undefined, fallback: string | undefined): string {
    const candidate =
      (name ?? '').trim() ||
      (fallback ?? '')
        .replace(/\.pdf$/i, '')
        .replace(/[\\/]+/g, ' ')
        .trim();
    const label = candidate.slice(0, 160);
    if (!label) {
      throw new BadRequestException(
        'أدخل اسمًا لملف الخلفية. / Give the background file a name.',
      );
    }
    return label;
  }
}
