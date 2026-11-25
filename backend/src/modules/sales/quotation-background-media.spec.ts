import { PDFDocument, rgb } from 'pdf-lib';
import sharp from 'sharp';

import { analyseBackground, placeOnA4, zonesOnSheet } from './quotation-background-media';
import { placeBackground, underlayBackground } from '../export/pdf.service';
import { backgroundPageNumber } from './quotation-document';

/// A synthetic letterhead (no real branding): header strip, pale watermark in
/// the middle, a stamp and a footer band. Letter size, like many Word exports.
async function letterheadPdf(pages = 1, size: [number, number] = [612, 792]): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = d.addPage(size);
    p.drawRectangle({ x: 0, y: size[1] - 60, width: size[0], height: 60, color: rgb(0.1, 0.3, 0.7) });
    p.drawRectangle({ x: 150, y: 330, width: 300, height: 120, color: rgb(0.86, 0.9, 0.99) });
    p.drawRectangle({ x: 40, y: 80, width: 110, height: 40, color: rgb(0.2, 0.3, 0.8) });
    p.drawRectangle({ x: 0, y: 0, width: size[0], height: 50, color: rgb(0.2, 0.45, 0.8) });
  }
  return Buffer.from(await d.save());
}

async function letterheadPng(width = 794, height = 1123): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <rect width="${width}" height="${Math.round(height * 0.08)}" fill="#1a4d99"/>
    <rect y="${Math.round(height * 0.93)}" width="${width}" height="${Math.round(height * 0.07)}" fill="#3377cc"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('quotation background: PDF and image uploads', () => {
  it('turns a one-page PDF into a page, a PNG preview and reserved zones', async () => {
    const out = await analyseBackground(await letterheadPdf());
    expect(out.kind).toBe('pdf');
    expect(out.pageCount).toBe(1);
    expect((await PDFDocument.load(out.pdf)).getPageCount()).toBe(1);
    const meta = await sharp(out.preview).metadata();
    expect(meta.format).toBe('png');
    // Header strip is 60 of 792pt; footer 50pt plus the stamp up to 120pt.
    const contain = zonesOnSheet(out.zones, 'contain');
    const stretch = zonesOnSheet(out.zones, 'stretch');
    expect(contain.topInsetMm).toBeGreaterThan(19);
    expect(contain.topInsetMm).toBeLessThan(26);
    // Letter fitted inside A4 keeps a strip under it, so its footer art sits higher.
    expect(contain.bottomInsetMm).toBeGreaterThan(60);
    expect(contain.bottomInsetMm).toBeLessThan(72);
    expect(stretch.bottomInsetMm).toBeGreaterThan(40);
    expect(stretch.bottomInsetMm).toBeLessThan(52);
    expect(out.zones.widthPt).toBe(612);
    expect(out.zones.heightPt).toBe(792);
  });

  it('refuses a several-page PDF until a page is chosen, then uses that page', async () => {
    const many = await letterheadPdf(3);
    await expect(analyseBackground(many)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BACKGROUND_PAGE_REQUIRED', pageCount: 3 }),
    });
    const chosen = await analyseBackground(many, 2);
    expect(chosen.pageCount).toBe(3);
    await expect(analyseBackground(many, 4)).rejects.toThrow('غير موجودة');
  });

  it('accepts PNG and JPEG, keeps their proportions and builds the same outputs', async () => {
    const png = await analyseBackground(await letterheadPng());
    expect(png.kind).toBe('image');
    const pngMm = zonesOnSheet(png.zones, 'contain');
    expect(pngMm.topInsetMm).toBeGreaterThan(20);
    expect(pngMm.bottomInsetMm).toBeGreaterThan(18);
    const jpeg = await analyseBackground(await sharp(await letterheadPng()).jpeg().toBuffer());
    expect(jpeg.kind).toBe('image');
    const wide = await analyseBackground(await letterheadPng(1200, 800));
    const wideOnA4 = placeOnA4(1200, 800);
    expect(wideOnA4.width / wideOnA4.height).toBeCloseTo(1.5, 3);
    const doc = await PDFDocument.load(wide.pdf);
    expect(doc.getPageCount()).toBe(1);
    const at = placeOnA4(1200, 800);
    expect(at.width / at.height).toBeCloseTo(1200 / 800, 3);
    expect(at.width).toBeLessThanOrEqual(595.28 + 0.01);
  });

  it('refuses text, empty, tiny, oversized, damaged and unsupported files with a sentence', async () => {
    await expect(analyseBackground(Buffer.from('hello'))).rejects.toThrow('غير مدعوم');
    await expect(analyseBackground(Buffer.alloc(0))).rejects.toThrow('4 ميجابايت');
    await expect(analyseBackground(Buffer.alloc(4 * 1024 * 1024 + 1))).rejects.toThrow('4 ميجابايت');
    await expect(analyseBackground(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('garbage')]))).rejects.toThrow('PDF');
    await expect(analyseBackground(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]))).rejects.toThrow('الصورة');
    await expect(analyseBackground(await letterheadPng(100, 100))).rejects.toThrow('صغيرة');
    const gif = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fff' } }).gif().toBuffer();
    await expect(analyseBackground(gif)).rejects.toThrow('غير مدعوم');
  });

  it('keeps the background in proportion under every content page', async () => {
    const content = await PDFDocument.create();
    content.addPage([595.28, 841.89]).drawText('one');
    content.addPage([595.28, 841.89]).drawText('two');
    const out = await underlayBackground(Buffer.from(await content.save()), (await analyseBackground(await letterheadPdf())).pdf);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
    // US Letter keeps its proportions by default: no distortion, a strip left under it.
    const letter = placeBackground(595.28, 841.89, 612, 792);
    expect(letter.width / letter.height).toBeCloseTo(612 / 792, 3);
    expect(letter.y + letter.height).toBeCloseTo(841.89, 2);
    expect(letter.y).toBeGreaterThan(60);
    // Stretching is an explicit choice.
    expect(placeBackground(595.28, 841.89, 612, 792, 'stretch')).toEqual({ x: 0, y: 0, width: 595.28, height: 841.89 });
    const square = placeBackground(595.28, 841.89, 1000, 1000);
    expect(square.width / square.height).toBeCloseTo(1, 3);
    expect(square.y + square.height).toBeCloseTo(841.89, 2);
    const a4ish = placeBackground(595.28, 841.89, 2480, 3508);
    expect(a4ish).toEqual({ x: 0, y: 0, width: 595.28, height: 841.89 });
  });

  it('puts the page number above the artwork instead of on it', () => {
    const withArt = backgroundPageNumber(48, true);
    expect(withArt.y).toBeGreaterThan(48 * (72 / 25.4));
    expect(backgroundPageNumber(0, true).y).toBeGreaterThan(0);
  });
});
