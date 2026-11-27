import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';

import { PrismaService } from '../../common/prisma/prisma.service';
import { analyseBackground, type BackgroundZones } from './quotation-background-media';

/// Largest PDF a company may upload as a letterhead.
export const MAX_BACKGROUND_BYTES = 5 * 1024 * 1024;

/// Cuts page `pageNumber` (1-based) out of an uploaded PDF as a one-page PDF.
/// Throws a 400 with a plain reason when the bytes are not a readable PDF.
export async function extractBackgroundPage(bytes: Buffer, pageNumber = 1): Promise<Buffer> {
  if (bytes.length === 0 || bytes.length > MAX_BACKGROUND_BYTES) {
    throw new BadRequestException({ code: 'QUOTE_BG_SIZE', message: 'The background PDF must be between 1 byte and 5 MB' });
  }
  if (bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw new BadRequestException({ code: 'QUOTE_BG_NOT_PDF', message: 'The background file is not a PDF' });
  }
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes);
  } catch {
    throw new BadRequestException({ code: 'QUOTE_BG_UNREADABLE', message: 'The background PDF could not be read (it may be encrypted or damaged)' });
  }
  const count = source.getPageCount();
  if (pageNumber < 1 || pageNumber > count) {
    throw new BadRequestException({ code: 'QUOTE_BG_PAGE', message: `The PDF has ${count} page(s); page ${pageNumber} does not exist` });
  }
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(source, [pageNumber - 1]);
  out.addPage(page);
  // A blank page has no content stream and cannot be embedded later.
  page.drawRectangle({ x: 0, y: 0, width: 1, height: 1, opacity: 0, borderOpacity: 0 });
  return Buffer.from(await out.save());
}

@Injectable()
export class QuotationBackgroundsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string) {
    return this.prisma.$queryRaw<{ id: string; name: string; createdAt: Date; kind: string; pageCount: number }[]>(Prisma.sql`
      SELECT id, name, "createdAt", kind, "pageCount" FROM quotation_backgrounds
       WHERE "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL ORDER BY "createdAt" DESC
    `);
  }

  /// Accepts a PDF, PNG or JPEG. A PDF with several pages needs `page`; it is
  /// refused with BACKGROUND_PAGE_REQUIRED instead of silently taking page 1.
  async create(companyId: string, userId: string, dto: { name: string; dataBase64: string; page?: number }) {
    const analysed = await analyseBackground(Buffer.from(dto.dataBase64, 'base64'), dto.page);
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; createdAt: Date; kind: string; pageCount: number }[]>(Prisma.sql`
      INSERT INTO quotation_backgrounds (id, "companyId", name, pdf, preview, kind, "pageCount", "topFraction", "bottomFraction", "widthPt", "heightPt", "createdBy")
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${dto.name.trim()}, ${analysed.pdf}, ${analysed.preview},
              ${analysed.kind}, ${analysed.pageCount}, ${analysed.zones.topFraction}, ${analysed.zones.bottomFraction}, ${analysed.zones.widthPt}, ${analysed.zones.heightPt}, ${userId}::uuid)
      RETURNING id, name, "createdAt", kind, "pageCount"
    `);
    return rows[0];
  }

  /// The stored one-page PDF, or null when the id is empty/unknown/deleted.
  async bytes(companyId: string, id: unknown): Promise<Buffer | null> {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const rows = await this.prisma.$queryRaw<{ pdf: Buffer }[]>(Prisma.sql`
      SELECT pdf FROM quotation_backgrounds
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
    `);
    return rows[0] ? Buffer.from(rows[0].pdf) : null;
  }

  /// The PNG preview, built on first use for backgrounds saved before previews existed.
  async preview(companyId: string, id: unknown): Promise<Buffer | null> {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const rows = await this.prisma.$queryRaw<{ preview: Buffer | null; pdf: Buffer }[]>(Prisma.sql`
      SELECT preview, pdf FROM quotation_backgrounds
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
    `);
    const row = rows[0];
    if (!row) return null;
    if (row.preview) return Buffer.from(row.preview);
    const analysed = await this.backfill(companyId, id, Buffer.from(row.pdf));
    return analysed?.preview ?? null;
  }

  /// The artwork zones and page size, so printed text can keep clear of the
  /// letterhead whichever way it is fitted to A4.
  async meta(companyId: string, id: unknown): Promise<BackgroundZones | null> {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const rows = await this.prisma.$queryRaw<
      { topFraction: number | null; bottomFraction: number | null; widthPt: number | null; heightPt: number | null; pdf: Buffer }[]
    >(Prisma.sql`
      SELECT "topFraction", "bottomFraction", "widthPt", "heightPt", pdf FROM quotation_backgrounds
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
    `);
    const row = rows[0];
    if (!row) return null;
    if (row.topFraction !== null && row.bottomFraction !== null && row.widthPt !== null && row.heightPt !== null) {
      return {
        topFraction: Number(row.topFraction),
        bottomFraction: Number(row.bottomFraction),
        widthPt: Number(row.widthPt),
        heightPt: Number(row.heightPt),
      };
    }
    return (await this.backfill(companyId, id, Buffer.from(row.pdf)))?.zones ?? null;
  }

  private async backfill(companyId: string, id: string, pdf: Buffer) {
    try {
      const analysed = await analyseBackground(pdf, 1);
      const z = analysed.zones;
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE quotation_backgrounds
           SET preview = ${analysed.preview}, "topFraction" = ${z.topFraction}, "bottomFraction" = ${z.bottomFraction},
               "widthPt" = ${z.widthPt}, "heightPt" = ${z.heightPt}
         WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
      `);
      return analysed;
    } catch {
      return null;
    }
  }

  async remove(companyId: string, id: string) {
    const n = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE quotation_backgrounds SET "deletedAt" = now()
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
    `);
    if (!n) throw new NotFoundException({ code: 'BACKGROUND_NOT_FOUND', message: 'Background not found' });
    return { deleted: true };
  }
}
