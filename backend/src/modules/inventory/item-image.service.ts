import { Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { normalizePicture } from '../../common/image/normalize-picture';
import { PrismaService } from '../../common/prisma/prisma.service';

/** A picture for an item: shown on its row, in pickers and on invoice lines. */
export const ITEM_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const ITEM_IMAGE_MAX_PIXELS = 16_000_000;
const ITEM_IMAGE_MAX_DIMENSION = 1024;

const LABELS = {
  subjectAr: 'صورة الصنف',
  subjectEn: 'item picture',
  maxDimension: ITEM_IMAGE_MAX_DIMENSION,
  maxPixels: ITEM_IMAGE_MAX_PIXELS,
};

@Injectable()
export class ItemImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /// The stored picture, or nulls when the item has none. Bytes are returned
  /// base64-encoded because the transport is JSON.
  async get(companyId: string, itemId: string) {
    const image = await this.prisma.itemImage.findFirst({
      where: {
        itemId,
        companyId,
        item: { companyId, deletedAt: null },
      },
      select: { data: true, mime: true, width: true, height: true, updatedAt: true },
    });
    if (!image) return { mime: null, data: null, width: null, height: null, updatedAt: null };
    return {
      mime: image.mime,
      data: Buffer.from(image.data).toString('base64'),
      width: image.width,
      height: image.height,
      updatedAt: image.updatedAt,
    };
  }

  /// Replaces (or sets) the item's picture.
  ///
  /// The item is locked while this runs so two simultaneous uploads cannot
  /// interleave into a half-written row, and the item is proved to belong to
  /// the caller's company before anything is written.
  async set(companyId: string, userId: string, itemId: string, data: Buffer, mime: string) {
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw new NotFoundException('No image was uploaded / لم يتم إرسال صورة.');
    }
    // Validate and re-encode before opening the transaction: decoding is the
    // expensive part and must not hold a row lock.
    const picture = await normalizePicture(data, mime, LABELS, ITEM_IMAGE_MAX_BYTES);

    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM items
         WHERE id = ${itemId}::uuid AND "companyId" = ${companyId}::uuid
           AND "deletedAt" IS NULL
         FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Item not found');

      await tx.itemImage.upsert({
        where: { itemId },
        create: {
          itemId,
          companyId,
          data: picture.data,
          mime: picture.mime,
          width: picture.width,
          height: picture.height,
        },
        update: {
          data: picture.data,
          mime: picture.mime,
          width: picture.width,
          height: picture.height,
        },
      });

      // The audit trail records that a picture changed and how big it is —
      // never the bytes, the filename or the content.
      await this.audit.recordRequired({
        companyId,
        userId,
        action: 'ITEM_IMAGE_SET',
        entity: 'items',
        entityId: itemId,
        after: { mime: picture.mime, size: picture.data.length, width: picture.width, height: picture.height },
      }, tx);
    });

    return { updated: true, mime: picture.mime, width: picture.width, height: picture.height };
  }

  async remove(companyId: string, userId: string, itemId: string) {
    await this.prisma.$transaction(async (tx) => {
      const items = await tx.item.findFirst({
        where: { id: itemId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!items) throw new NotFoundException('Item not found');

      const result = await tx.itemImage.deleteMany({ where: { companyId, itemId } });
      if (result.count) {
        await this.audit.recordRequired({
          companyId,
          userId,
          action: 'ITEM_IMAGE_REMOVE',
          entity: 'items',
          entityId: itemId,
        }, tx);
      }
    });
    return { deleted: true };
  }

  /// Which of these items have a picture — one query, so a list screen can show
  /// placeholders without fetching any image bytes.
  async presence(companyId: string, itemIds: string[]): Promise<Set<string>> {
    if (!itemIds.length) return new Set();
    const rows = await this.prisma.itemImage.findMany({
      where: { companyId, itemId: { in: itemIds } },
      select: { itemId: true },
    });
    return new Set(rows.map((row) => row.itemId));
  }
}
