import { BadRequestException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';

import { ItemImageService } from './item-image.service';

/// An 8x8 WebP encoded once, so every test in this file uses real bytes.
const TINY_WEBP =
  'UklGRjgAAABXRUJQVlA4ICwAAADQAQCdASoIAAgAAUAmJaACdLoB+AADsAD+8ut//OJY6nd3Z//MEr8g3XIAAA==';

const COMPANY = 'company-1';
const USER = 'user-1';
const ITEM = '11111111-1111-4111-8111-111111111111';

/// A real PNG, made here rather than pasted, so the decode path is exercised
/// with an image that sharp actually accepts.
async function png(width = 96, height = 96): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
}

function build(options: { items?: Array<{ id: string }>; existing?: boolean } = {}) {
  const items = options.items ?? [{ id: ITEM }];
  const images = new Map<string, Record<string, unknown>>();
  if (options.existing !== false && options.existing) {
    images.set(ITEM, {
      itemId: ITEM,
      companyId: COMPANY,
      // A real 8x8 WebP, so the thumbnail path exercises sharp rather than a
      // stub: a fake that is not decodable would only prove the error branch.
      data: Buffer.from(TINY_WEBP, 'base64'),
      mime: 'image/webp',
      width: 10,
      height: 10,
      updatedAt: new Date(),
    });
  }

  const auditCalls: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: jest.fn(async () => items),
    itemImage: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        images.set(where.itemId, { ...(images.get(where.itemId) ?? {}), ...(create ?? {}), ...(update ?? {}) });
        return images.get(where.itemId);
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const had = images.delete(where.itemId);
        return { count: had ? 1 : 0 };
      }),
      findFirst: jest.fn(async ({ where }: any) => images.get(where.itemId) ?? null),
      findMany: jest.fn(async ({ where, select }: any) => {
        // A company-wide query omits itemId; a targeted one lists ids.
        const wanted: string[] = where.itemId?.in ?? [...images.keys()];
        return wanted
          .filter((id: string) => images.get(id)?.companyId === where.companyId)
          .map((id: string) => {
            const row = images.get(id)!;
            // Mirror Prisma: only the selected columns come back.
            if (!select) return row;
            return Object.fromEntries(
              Object.keys(select).map((column) => [column, row[column]]),
            );
          });
      }),
    },
    item: {
      findFirst: jest.fn(async ({ where }: any) =>
        items.find((row) => row.id === where.id) ?? null,
      ),
    },
  };

  const prisma = {
    ...tx,
    $transaction: jest.fn(async (work: any) => work(tx)),
  } as any;

  const audit = {
    recordRequired: jest.fn(async (entry: Record<string, unknown>) => {
      auditCalls.push(entry);
    }),
  } as any;

  return { service: new ItemImageService(prisma, audit), prisma, tx, images, auditCalls };
}

describe('item pictures', () => {
  it('stores a real picture as re-encoded WebP and reports its size', async () => {
    const { service, tx } = build();

    const result = await service.set(COMPANY, USER, ITEM, await png(), 'image/png');

    expect(result.updated).toBe(true);
    // The stored bytes are ours, not the upload's.
    expect(result.mime).toBe('image/webp');
    const written = (tx.itemImage.upsert as jest.Mock).mock.calls[0][0];
    expect(written.create.mime).toBe('image/webp');
    expect(written.create.width).toBeGreaterThan(0);
    expect(written.create.height).toBeGreaterThan(0);
  });

  it('audits that a picture changed without recording the bytes', async () => {
    const { service, auditCalls } = build();

    await service.set(COMPANY, USER, ITEM, await png(), 'image/png');

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ action: 'ITEM_IMAGE_SET', entity: 'items', entityId: ITEM });
    const after = auditCalls[0].after as Record<string, unknown>;
    expect(Object.keys(after)).toEqual(['mime', 'size', 'width', 'height']);
    expect(JSON.stringify(auditCalls[0])).not.toContain('base64');
  });

  it('refuses a file whose bytes are not an image even when its type claims otherwise', async () => {
    const { service, tx } = build();

    await expect(
      service.set(COMPANY, USER, ITEM, Buffer.from('this is not an image at all'), 'image/png'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.itemImage.upsert).not.toHaveBeenCalled();
  });

  it('refuses a type that is not on the allow-list', async () => {
    const { service } = build();

    await expect(
      service.set(COMPANY, USER, ITEM, await png(), 'image/svg+xml'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an empty upload', async () => {
    const { service } = build();

    await expect(
      service.set(COMPANY, USER, ITEM, Buffer.alloc(0), 'image/png'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses an item that belongs to another company', async () => {
    const { service, tx } = build({ items: [] });

    await expect(service.set(COMPANY, USER, ITEM, await png(), 'image/png')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.itemImage.upsert).not.toHaveBeenCalled();
  });

  it('returns empty fields for an item with no picture', async () => {
    const { service } = build();

    const result = await service.get(COMPANY, ITEM);

    expect(result).toMatchObject({ mime: null, data: null, width: null, height: null });
  });

  it('answers base64 bytes for an item that has one', async () => {
    const { service } = build({ existing: true });

    const result = await service.get(COMPANY, ITEM);

    expect(result.mime).toBe('image/webp');
    expect(typeof result.data).toBe('string');
  });

  it('removes the picture and says so in the audit trail', async () => {
    const { service, auditCalls } = build({ existing: true });

    const result = await service.remove(COMPANY, USER, ITEM);

    expect(result.deleted).toBe(true);
    expect(auditCalls[0]).toMatchObject({ action: 'ITEM_IMAGE_REMOVE' });
  });

  it('writes nothing when removing a picture the item never had', async () => {
    const { service, auditCalls } = build();

    await service.remove(COMPANY, USER, ITEM);

    expect(auditCalls).toHaveLength(0);
  });

  it('reports presence for a list without fetching any bytes', async () => {
    const { service, tx } = build({ existing: true });

    const present = await service.presence(COMPANY, [ITEM, 'other']);

    expect([...present]).toEqual([ITEM]);
    // The query must not select the data column.
    const select = (tx.itemImage.findMany as jest.Mock).mock.calls[0][0].select;
    expect(select).toEqual({ itemId: true });
  });

  it('answers a whole page of thumbnails without echoing the stored bytes', async () => {
    const { service, tx } = build({ existing: true });

    const pictures = await service.thumbnails(COMPANY, [ITEM, 'other']);

    // One row has a picture; the other simply does not appear, so the screen
    // can draw its placeholder without a second request.
    expect(pictures.map((p) => p.itemId)).toEqual([ITEM]);
    // The thumbnails are WebP produced here, not the stored bytes echoed back.
    expect(Buffer.from(pictures[0].data, 'base64').subarray(8, 12).toString('ascii')).toBe('WEBP');
    // The first query is the cheap key-only one: a page must not pull every
    // stored original (up to 2 MB each) just to decide what to render.
    expect((tx.itemImage.findMany as jest.Mock).mock.calls[0][0].select)
      .toEqual({ itemId: true, updatedAt: true });
  });

  it('does not load the originals again once a thumbnail is cached', async () => {
    const { service, tx } = build({ existing: true });

    await service.thumbnails(COMPANY, [ITEM]);
    const callsAfterFirstPage = (tx.itemImage.findMany as jest.Mock).mock.calls.length;
    await service.thumbnails(COMPANY, [ITEM]);

    // The second page is answered from the cache: only the key query runs, and
    // the data column is never fetched again.
    expect((tx.itemImage.findMany as jest.Mock).mock.calls.length).toBe(callsAfterFirstPage + 1);
    const lastSelect = (tx.itemImage.findMany as jest.Mock).mock.calls.at(-1)[0].select;
    expect(lastSelect).toEqual({ itemId: true, updatedAt: true });
  });

  it('asks for nothing when the page has no items', async () => {
    const { service, tx } = build();

    expect(await service.thumbnails(COMPANY, [])).toEqual([]);
    expect(tx.itemImage.findMany).not.toHaveBeenCalled();
  });

  it('asks for nothing when given no ids', async () => {
    const { service, tx } = build();

    expect([...(await service.presence(COMPANY, []))]).toEqual([]);
    expect(tx.itemImage.findMany).not.toHaveBeenCalled();
  });
});
