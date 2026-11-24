import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';

import { PrismaService } from '../../common/prisma/prisma.service';

/// Largest PDF a company may upload as a letterhead.
export const MAX_BACKGROUND_BYTES = 5 * 1024 * 1024;

/// Cuts page `pageNumber` (1-based) out of an uploaded PDF as a one-page PDF.
/// Throws a 400 with a plain reason when the bytes are not a readable PDF.
export async function extractBackgroundPage(bytes: Buffer, pageNumber = 1): Promise<Buffer> {
  if (bytes.length === 0 || bytes.length > MAX_BACKGROUND_BYTES) {
    throw new BadRequestException('The background PDF must be between 1 byte and 5 MB');
  }
  if (bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw new BadRequestException('The background file is not a PDF');
  }
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes);
  } catch {
    throw new BadRequestException('The background PDF could not be read (it may be encrypted or damaged)');
  }
  const count = source.getPageCount();
  if (pageNumber < 1 || pageNumber > count) {
    throw new BadRequestException(`The PDF has ${count} page(s); page ${pageNumber} does not exist`);
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
    return this.prisma.$queryRaw<{ id: string; name: string; createdAt: Date }[]>(Prisma.sql`
      SELECT id, name, "createdAt" FROM quotation_backgrounds
       WHERE "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL ORDER BY "createdAt" DESC
    `);
  }

  async create(companyId: string, userId: string, dto: { name: string; dataBase64: string; page?: number }) {
    const pdf = await extractBackgroundPage(Buffer.from(dto.dataBase64, 'base64'), dto.page ?? 1);
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; createdAt: Date }[]>(Prisma.sql`
      INSERT INTO quotation_backgrounds (id, "companyId", name, pdf, "createdBy")
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${dto.name.trim()}, ${pdf}, ${userId}::uuid)
      RETURNING id, name, "createdAt"
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

  async remove(companyId: string, id: string) {
    const n = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE quotation_backgrounds SET "deletedAt" = now()
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
    `);
    if (!n) throw new NotFoundException('Background not found');
    return { deleted: true };
  }
}
