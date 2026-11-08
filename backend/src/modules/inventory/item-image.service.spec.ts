import { BadRequestException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';

import { ItemImageService } from './item-image.service';

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
      data: Buffer.from('old'),
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
      findMany: jest.fn(async ({ where }: any) =>
        (where.itemId?.in ?? []).filter((id: string) => images.has(id)).map((id: string) => ({ itemId: id })),
      ),
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

  it('asks for nothing when given no ids', async () => {
    const { service, tx } = build();

    expect([...(await service.presence(COMPANY, []))]).toEqual([]);
    expect(tx.itemImage.findMany).not.toHaveBeenCalled();
  });
});
