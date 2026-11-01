import {
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
  rgb,
} from 'pdf-lib';

import { createHash } from 'crypto';
import { deflateSync } from 'zlib';

import {
  BACKGROUND_UPLOAD_MAX_BYTES,
  DEFAULT_BACKGROUND_SETTINGS,
  colourToHex,
  inspectBackgroundUpload,
  inspectPdfUpload,
  mergeOfferOntoBackground,
  overlayPlacement,
  parseBackgroundSettings,
  selectBackgroundPage,
  sheetForBackground,
} from './quotation-background';

/// Builds a PDF the way the application receives one: real pages, real bytes.
async function pdf(
  pages: Array<{ width: number; height: number; label?: string }>,
): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont('Helvetica');
  for (const spec of pages) {
    const page = document.addPage([spec.width, spec.height]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: spec.width,
      height: 22,
      color: rgb(0.12, 0.38, 0.67),
    });
    page.drawText(spec.label ?? 'artwork', { x: 24, y: spec.height - 60, size: 18, font });
  }
  return Buffer.from(await document.save());
}

const A4 = { width: 595.28, height: 841.89 };

/// Reads every text operation out of a page's content stream, so a test can
/// say what the finished file actually draws instead of trusting the code.
function drawnText(document: PDFDocument, index: number): string {
  const page = document.getPage(index);
  const contents = page.node.Contents();
  const references =
    contents && 'asArray' in contents ? contents.asArray() : [contents];
  const decoder = new TextDecoder('latin1');
  const raw = references
    .map((reference) => document.context.lookup(reference))
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map((stream) => decoder.decode(decodePDFRawStream(stream).decode()))
    .join('\n');
  // pdf-lib writes text as a hex string; decode it so a test can read the
  // label a person would see on the sheet.
  return raw.replace(/<([0-9a-fA-F]+)>\s*Tj/g, (_match, hex: string) =>
    Buffer.from(hex, 'hex').toString('latin1'),
  );
}


/// Builds a real PNG of the given pixel size, so a picture test measures a
/// picture and not a byte pattern that only starts like one.
function png(width: number, height: number): Buffer {
  const chunk = (type: string, body: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([length, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = 0x21;
      raw[row + 2 + x * 3] = 0x6b;
      raw[row + 3 + x * 3] = 0xd6;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let crcTable: number[] | null = null;
function crc32(buffer: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/// A one-pixel JPEG, real enough for pdf-lib to embed.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

/// The drawing operations of one page, as text: enough to read where a picture
/// was placed without trusting the function that placed it.
function contentOf(document: PDFDocument, index: number): string {
  const page = document.getPage(index);
  const contents = page.node.Contents();
  const references =
    contents && 'asArray' in contents ? contents.asArray() : [contents];
  const decoder = new TextDecoder('latin1');
  return references
    .map((reference) => document.context.lookup(reference))
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map((stream) => decoder.decode(decodePDFRawStream(stream).decode()))
    .join('\n');
}

describe('attached PDF background', () => {
  describe('what is accepted as artwork', () => {
    it('accepts a real PDF and measures it from the bytes, not the name', async () => {
      const buffer = await pdf([A4, A4]);
      const info = await inspectPdfUpload({
        buffer,
        originalname: 'letterhead.pdf',
        mimetype: 'application/pdf',
      });
      expect(info.pageCount).toBe(2);
      expect(info.pageWidth).toBeCloseTo(595.28, 1);
      expect(info.pageHeight).toBeCloseTo(841.89, 1);
      expect(info.byteSize).toBe(buffer.length);
      expect(info.sha256).toHaveLength(64);
      expect(info.mixedPageSizes).toBe(false);
    });

    it('reports mixed page sizes instead of pretending they are uniform', async () => {
      const buffer = await pdf([A4, { width: 419.53, height: 595.28 }]);
      const info = await inspectPdfUpload({ buffer, originalname: 'mixed.pdf' });
      expect(info.mixedPageSizes).toBe(true);
    });

    it('refuses a PNG that was renamed to .pdf', async () => {
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(2048, 7),
      ]);
      await expect(
        inspectPdfUpload({ buffer: png, originalname: 'looks-like.pdf', mimetype: 'application/pdf' }),
      ).rejects.toThrow(/not a PDF/i);
    });

    it('refuses a PDF that is not a PDF by extension first', async () => {
      const buffer = await pdf([A4]);
      await expect(
        inspectPdfUpload({ buffer, originalname: 'scan.docx' }),
      ).rejects.toThrow(/\.pdf/i);
    });

    it('refuses a truncated file: the end marker is missing', async () => {
      const buffer = await pdf([A4]);
      const truncated = buffer.subarray(0, Math.floor(buffer.length * 0.6));
      await expect(
        inspectPdfUpload({ buffer: truncated, originalname: 'torn.pdf' }),
      ).rejects.toThrow(/end marker|damaged|truncated/i);
    });

    it('refuses a file that only pretends to be a PDF', async () => {
      const fake = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
      await expect(
        inspectPdfUpload({ buffer: fake, originalname: 'fake.pdf' }),
      ).rejects.toThrow(/could not be read/i);
    });

    it('refuses an empty selection', async () => {
      await expect(
        inspectPdfUpload({ buffer: Buffer.alloc(0), originalname: 'empty.pdf' }),
      ).rejects.toThrow(/No file was uploaded/i);
    });

    it('refuses a file over the size limit and says what the limit is', async () => {
      const buffer = await pdf([A4]);
      await expect(
        inspectPdfUpload({ buffer, originalname: 'huge.pdf', maxBytes: buffer.length - 1 }),
      ).rejects.toThrow(/larger than/i);
    });

    it('keeps a limit small enough for a database row', () => {
      expect(BACKGROUND_UPLOAD_MAX_BYTES).toBeGreaterThan(1024 * 1024);
      expect(BACKGROUND_UPLOAD_MAX_BYTES).toBeLessThanOrEqual(16 * 1024 * 1024);
    });
  });


  describe('picture artwork (PNG and JPG)', () => {
    it('embeds a PNG into one A4 page, and stores that PDF rather than the picture', async () => {
      const info = await inspectBackgroundUpload({
        buffer: png(1000, 250),
        originalname: 'letterhead.png',
        mimetype: 'image/png',
      });
      expect(info.sourceKind).toBe('png');
      expect(info.mimeType).toBe('application/pdf');
      expect(info.pageCount).toBe(1);
      expect(info.pageWidth).toBeCloseTo(595.28, 1);
      expect(info.pageHeight).toBeCloseTo(841.89, 1);
      expect(info.data.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(info.byteSize).toBe(info.data.length);
      expect(info.sha256).toBe(
        createHash('sha256').update(info.data).digest('hex'),
      );
    });

    it('accepts a JPG and measures the stored page, not the file', async () => {
      const info = await inspectBackgroundUpload({
        buffer: TINY_JPEG,
        originalname: 'scan.jpeg',
        mimetype: 'image/jpeg',
      });
      expect(info.sourceKind).toBe('jpeg');
      expect(info.pageCount).toBe(1);
      const stored = await PDFDocument.load(new Uint8Array(info.data));
      const size = stored.getPage(0).getSize();
      expect(size.width).toBeCloseTo(595.28, 1);
      expect(size.height).toBeCloseTo(841.89, 1);
    });

    it('scales a wide picture by one factor, so nothing is stretched', async () => {
      const info = await inspectBackgroundUpload({
        buffer: png(1000, 250),
        originalname: 'banner.png',
      });
      const stored = await PDFDocument.load(new Uint8Array(info.data));
      // The picture's placement is the one with a real area: pdf-lib wraps
      // each drawing in its own `cm`, and the wrapping ones are the identity.
      const placements = [
        ...contentOf(stored, 0).matchAll(
          /([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/g,
        ),
      ];
      expect(placements.length).toBeGreaterThan(0);
      const placed = placements.reduce((best, next) =>
        Number(next[1]) * Number(next[2]) > Number(best[1]) * Number(best[2])
          ? next
          : best,
      );
      const width = Number(placed[1]);
      const height = Number(placed[2]);
      // The picture's own 4:1 shape survives; a stretched one would be 1:1.4.
      expect(width / height).toBeCloseTo(1000 / 250, 2);
      // Fit inside the sheet, on both axes.
      expect(width).toBeLessThanOrEqual(595.28 + 0.01);
      expect(height).toBeLessThanOrEqual(841.89 + 0.01);
    });

    it('decides the kind from the bytes, not from the name', async () => {
      const disguised = await inspectBackgroundUpload({
        buffer: png(40, 40),
        originalname: 'letterhead.pdf',
        mimetype: 'application/pdf',
      });
      expect(disguised.sourceKind).toBe('png');

      await expect(
        inspectBackgroundUpload({
          buffer: Buffer.from('this is not a picture at all'),
          originalname: 'letterhead.png',
          mimetype: 'image/png',
        }),
      ).rejects.toThrow(/not a PDF, PNG or JPG/i);
    });

    it('repeats the picture behind every page of a long offer, keeping A4', async () => {
      const info = await inspectBackgroundUpload({
        buffer: png(600, 600),
        originalname: 'square.png',
      });
      const overlay = await pdf([A4, A4, A4]);
      const merged = await mergeOfferOntoBackground({
        background: info.data,
        overlay,
        settings: parseBackgroundSettings({ mode: 'REPEAT' }, 1),
        pageNumber: { y: 18, size: 8 },
      });
      expect(merged.pages).toBe(3);
      expect(merged.backgroundPages).toEqual([0, 0, 0]);
      const result = await PDFDocument.load(new Uint8Array(merged.pdf));
      for (let index = 0; index < 3; index += 1) {
        const size = result.getPage(index).getSize();
        expect(size.width).toBeCloseTo(595.28, 1);
        expect(size.height).toBeCloseTo(841.89, 1);
      }
    });
  });

  describe('how the artwork pages are chosen', () => {
    it('repeats the first page when the artefact is one sheet', () => {
      const settings = parseBackgroundSettings({ mode: 'REPEAT' });
      expect([0, 1, 2, 3].map((i) => selectBackgroundPage(i, settings, 1))).toEqual([
        0, 0, 0, 0,
      ]);
    });

    it('walks a multi-page artwork in order and holds the last page', () => {
      const settings = parseBackgroundSettings({ mode: 'SEQUENCE' });
      expect([0, 1, 2, 3, 4].map((i) => selectBackgroundPage(i, settings, 2))).toEqual([
        0, 1, 1, 1, 1,
      ]);
    });

    it('uses one chosen page for a long offer', () => {
      const settings = parseBackgroundSettings({ mode: 'SINGLE_PAGE', page: 3 });
      expect([0, 1, 2].map((i) => selectBackgroundPage(i, settings, 4))).toEqual([
        2, 2, 2,
      ]);
    });

    it('never asks for a page the file does not have', () => {
      const settings = parseBackgroundSettings({ mode: 'SINGLE_PAGE', page: 99 }, 2);
      expect(selectBackgroundPage(0, settings, 2)).toBe(1);
      const weird = parseBackgroundSettings({ mode: 'SEQUENCE', page: -4 }, 0);
      expect(selectBackgroundPage(5, weird, 0)).toBe(0);
    });

    it('falls back to the safe default when the stored settings are mangled', () => {
      const settings = parseBackgroundSettings({
        mode: 'nonsense',
        showPageNumbers: 'yes',
        marginMm: { top: 'abc', bottom: 500 },
        pageNumberColor: 'not-a-colour',
      });
      expect(settings.mode).toBe('REPEAT');
      expect(settings.showPageNumbers).toBe(true);
      expect(settings.marginMm.top).toBe(DEFAULT_BACKGROUND_SETTINGS.marginMm.top);
      expect(settings.marginMm.bottom).toBe(80);
      expect(colourToHex(settings.pageNumberColor)).toBe(
        colourToHex(DEFAULT_BACKGROUND_SETTINGS.pageNumberColor),
      );
    });
  });

  describe('the sheet the offer is laid out on', () => {
    it('turns the artwork page box into an A4 sheet in millimetres', () => {
      const sheet = sheetForBackground(A4);
      expect(sheet.widthMm).toBeCloseTo(210, 0);
      expect(sheet.heightMm).toBeCloseTo(297, 0);
      expect(sheet.scaled).toBe(false);
    });

    it('keeps a landscape artwork landscape', () => {
      const sheet = sheetForBackground({ width: 841.89, height: 595.28 });
      expect(sheet.widthMm).toBeGreaterThan(sheet.heightMm);
    });
  });

  describe('placing the offer on the artwork', () => {
    it('draws a same-sized overlay exactly over the page', () => {
      const placement = overlayPlacement(A4, A4);
      expect(placement).toMatchObject({ x: 0, y: 0, width: 595.28, height: 841.89 });
      expect(placement.scale).toBeCloseTo(1, 6);
    });

    it('scales uniformly, never stretching one axis to fit', () => {
      const placement = overlayPlacement(A4, { width: 1190.56, height: 841.89 });
      expect(placement.width / placement.height).toBeCloseTo(1190.56 / 841.89, 6);
      expect(placement.height).toBeLessThanOrEqual(841.89 + 0.01);
      expect(placement.x).toBeGreaterThanOrEqual(0);
      expect(placement.y).toBeGreaterThanOrEqual(0);
    });
  });

  describe('the merged file', () => {
    it('keeps one offer page on one piece of artwork', async () => {
      const background = await pdf([A4]);
      const overlay = await pdf([A4]);
      const result = await mergeOfferOntoBackground({
        background,
        overlay,
        settings: parseBackgroundSettings({ mode: 'REPEAT' }),
        pageNumber: { y: 10, size: 9 },
      });
      expect(result.pages).toBe(1);
      expect(result.backgroundPages).toEqual([0]);

      const merged = await PDFDocument.load(new Uint8Array(result.pdf));
      const { width, height } = merged.getPage(0).getSize();
      expect(width).toBeCloseTo(A4.width, 1);
      expect(height).toBeCloseTo(A4.height, 1);
    });

    it('repeats a one-page letterhead behind a three-page offer', async () => {
      const background = await pdf([A4]);
      const overlay = await pdf([A4, A4, A4]);
      const result = await mergeOfferOntoBackground({
        background,
        overlay,
        settings: parseBackgroundSettings({ mode: 'REPEAT' }),
      });
      expect(result.pages).toBe(3);
      expect(result.backgroundPages).toEqual([0, 0, 0]);
      expect((await PDFDocument.load(new Uint8Array(result.pdf))).getPageCount()).toBe(3);
    });

    it('uses a two-page artwork in order behind a five-page offer', async () => {
      const background = await pdf([A4, A4]);
      const overlay = await pdf([A4, A4, A4, A4, A4]);
      const result = await mergeOfferOntoBackground({
        background,
        overlay,
        settings: parseBackgroundSettings({ mode: 'SEQUENCE' }),
      });
      expect(result.backgroundPages).toEqual([0, 1, 1, 1, 1]);
    });

    it('uses the artwork pages as the page box, so nothing is resized', async () => {
      const letter = { width: 612, height: 792 };
      const background = await pdf([letter, letter]);
      const overlay = await pdf([A4, A4]);
      const result = await mergeOfferOntoBackground({
        background,
        overlay,
        settings: parseBackgroundSettings({ mode: 'REPEAT' }),
      });
      const merged = await PDFDocument.load(new Uint8Array(result.pdf));
      for (const index of [0, 1]) {
        const size = merged.getPage(index).getSize();
        expect(size.width).toBeCloseTo(612, 1);
        expect(size.height).toBeCloseTo(792, 1);
      }
    });

    it('stamps the page number on top of the merged page, centred', async () => {
      const background = await pdf([A4]);
      const overlay = await pdf([A4, A4]);
      const result = await mergeOfferOntoBackground({
        background,
        overlay,
        settings: parseBackgroundSettings({ mode: 'REPEAT' }),
        pageNumber: { y: 10, size: 9 },
      });
      const merged = await PDFDocument.load(new Uint8Array(result.pdf));
      const first = drawnText(merged, 0);
      const second = drawnText(merged, 1);
      expect(first).toContain('1 / 2');
      expect(second).toContain('2 / 2');
    });

    it('leaves the number off when the template asked for none', async () => {
      const background = await pdf([A4]);
      const overlay = await pdf([A4]);
      const result = await mergeOfferOntoBackground({
        background,
        overlay,
        settings: parseBackgroundSettings({ showPageNumbers: false }),
      });
      const merged = await PDFDocument.load(new Uint8Array(result.pdf));
      expect(drawnText(merged, 0)).not.toContain('/ 1');
    });

    it('draws the offer after the artwork, so the offer is on top', async () => {
      const background = await pdf([A4]);
      const overlay = await pdf([A4]);
      const result = await mergeOfferOntoBackground({
        background,
        overlay,
        settings: parseBackgroundSettings({ mode: 'REPEAT' }),
      });
      const merged = await PDFDocument.load(new Uint8Array(result.pdf));
      const content = drawnText(merged, 0);
      // The artwork's own label and the offer's label are both painted; the
      // artwork is drawn first, so its operations come before the offer's.
      const artworkAt = content.indexOf('Do');
      const offerAt = content.lastIndexOf('Do');
      expect(artworkAt).toBeGreaterThanOrEqual(0);
      expect(offerAt).toBeGreaterThan(artworkAt);
    });
  });
});
