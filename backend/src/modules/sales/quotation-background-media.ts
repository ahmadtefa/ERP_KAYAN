import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

import { type BackgroundFit, placeBackground } from '../export/pdf.service';

/// Largest file a company may upload as a letterhead (PDF, PNG or JPEG).
/// Kept under the API's 6 MB JSON limit once base64-encoded (4 MB -> about 5.4 MB).
export const MAX_BACKGROUND_BYTES = 4 * 1024 * 1024;
/// Largest picture, in pixels, that is decoded (guards memory).
const MAX_IMAGE_PIXELS = 40_000_000;

/// A4 in PDF points, the sheet every quotation is printed on.
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

export type BackgroundKind = 'pdf' | 'image';

/// Where a background sits on the A4 sheet (see placeBackground).
export function placeOnA4(bgWidth: number, bgHeight: number, fit: BackgroundFit = 'contain') {
  return placeBackground(A4_WIDTH_PT, A4_HEIGHT_PT, bgWidth, bgHeight, fit);
}

/// What is kept about a background's artwork: zones as fractions of the page
/// height, so the same numbers serve whichever way it is fitted to A4.
export interface BackgroundZones {
  topFraction: number;
  bottomFraction: number;
  widthPt: number;
  heightPt: number;
}

/// The zones in millimetres on the printed A4 sheet for a given fit.
export function zonesOnSheet(zones: BackgroundZones, fit: BackgroundFit): { topInsetMm: number; bottomInsetMm: number } {
  const at = placeOnA4(zones.widthPt, zones.heightPt, fit);
  const mmPerPt = 25.4 / 72;
  const topPt = A4_HEIGHT_PT - at.y - at.height + zones.topFraction * at.height;
  const bottomPt = at.y + zones.bottomFraction * at.height;
  const round = (n: number) => Math.round(n * mmPerPt * 10) / 10;
  return {
    topInsetMm: zones.topFraction > 0 ? round(topPt) : 0,
    bottomInsetMm: zones.bottomFraction > 0 ? round(bottomPt) : 0,
  };
}

export interface AnalysedBackground {
  /// The stored one-page PDF the export paints under every page.
  pdf: Buffer;
  /// A PNG of that page, for the in-app preview.
  preview: Buffer;
  kind: BackgroundKind;
  /// Pages in the uploaded PDF (1 for a picture).
  pageCount: number;
  /// The letterhead artwork's reach from the top and bottom edge.
  zones: BackgroundZones;
}

export class BackgroundPageRequired extends BadRequestException {
  constructor(pages: number) {
    super({
      message: `ملف الـPDF يحتوي على ${pages} صفحات. اختر رقم الصفحة التي تُستخدم كخلفية.`,
      code: 'BACKGROUND_PAGE_REQUIRED',
      pageCount: pages,
    });
  }
}

type PdfiumLibrary = {
  loadDocument(data: Uint8Array): Promise<PdfiumDocument>;
};
type PdfiumDocument = {
  getPageCount(): number;
  getPage(index: number): {
    render(options: {
      scale: number;
      render: (b: { data: Uint8Array; width: number; height: number }) => Promise<Buffer>;
    }): Promise<{ data: Uint8Array; width: number; height: number }>;
  };
  destroy(): void;
};

let pdfium: Promise<PdfiumLibrary> | null = null;
function pdfiumLibrary(): Promise<PdfiumLibrary> {
  pdfium ??= (async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFiumLibrary } = require('@hyzyla/pdfium') as {
      PDFiumLibrary: { init(): Promise<PdfiumLibrary> };
    };
    return PDFiumLibrary.init();
  })();
  // A failed start must not poison every later upload.
  pdfium.catch(() => { pdfium = null; });
  return pdfium;
}

function isPng(b: Buffer): boolean {
  return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}
function isJpeg(b: Buffer): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
function isPdf(b: Buffer): boolean {
  return b.subarray(0, 5).toString('latin1').includes('%PDF');
}

/// Reads a PDF, PNG or JPEG upload and returns the one-page PDF, the preview
/// PNG and the letterhead's reserved zones. Every refusal is a 400 with a
/// plain sentence; nothing is thrown as a server error for a bad file.
export async function analyseBackground(bytes: Buffer, page?: number): Promise<AnalysedBackground> {
  if (bytes.length === 0 || bytes.length > MAX_BACKGROUND_BYTES) {
    throw new BadRequestException('الملف يجب أن يكون بين 1 بايت و4 ميجابايت');
  }
  if (isPdf(bytes)) return analysePdf(bytes, page);
  if (isPng(bytes) || isJpeg(bytes)) return analyseImage(bytes);
  throw new BadRequestException('نوع الملف غير مدعوم. اختر ملف PDF أو صورة PNG أو JPG');
}

async function analysePdf(bytes: Buffer, page?: number): Promise<AnalysedBackground> {
  let source: PDFDocument;
  let count: number;
  try {
    source = await PDFDocument.load(bytes);
    // pdf-lib reads the page tree lazily, so a damaged file fails here.
    count = source.getPageCount();
  } catch {
    throw new BadRequestException('تعذرت قراءة ملف الـPDF (قد يكون مشفرًا أو تالفًا)');
  }
  if (count === 0) throw new BadRequestException('ملف الـPDF لا يحتوي على صفحات');
  if (page === undefined && count > 1) throw new BackgroundPageRequired(count);
  const pageNumber = page ?? 1;
  if (pageNumber < 1 || pageNumber > count) {
    throw new BadRequestException(`الملف فيه ${count} صفحة، والصفحة ${pageNumber} غير موجودة`);
  }
  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(source, [pageNumber - 1]);
  out.addPage(copied);
  // A blank page has no content stream and cannot be embedded later.
  copied.drawRectangle({ x: 0, y: 0, width: 1, height: 1, opacity: 0, borderOpacity: 0 });
  const pdf = Buffer.from(await out.save());

  let rendered: { data: Uint8Array; width: number; height: number };
  try {
    const library = await pdfiumLibrary();
    const doc = await library.loadDocument(pdf);
    try {
      rendered = await doc.getPage(0).render({
        scale: 1.4,
        render: async ({ data, width, height }) =>
          sharp(data, { raw: { width, height, channels: 4 } }).flatten({ background: '#ffffff' }).png().toBuffer(),
      });
    } finally {
      doc.destroy();
    }
  } catch {
    throw new BadRequestException('تعذر عرض صفحة الـPDF، جرّب حفظها من البرنامج الأصلي مرة أخرى أو استخدم صورة');
  }
  const preview = Buffer.from(rendered.data);
  const zones = await inkZones(preview);
  const stored = await PDFDocument.load(pdf);
  const size = stored.getPage(0).getSize();
  return { pdf, preview, kind: 'pdf', pageCount: count, zones: { ...zones, widthPt: size.width, heightPt: size.height } };
}

async function analyseImage(bytes: Buffer): Promise<AnalysedBackground> {
  let normalised: Buffer;
  let width: number;
  let height: number;
  let png: boolean;
  try {
    const probe = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    png = probe.format === 'png';
    if (!png && probe.format !== 'jpeg') throw new Error('format');
    // Apply the camera's rotation flag, then store without it.
    const pipeline = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
    const encoded = await (png ? pipeline.png() : pipeline.jpeg({ quality: 92, mozjpeg: false })).toBuffer({
      resolveWithObject: true,
    });
    normalised = encoded.data;
    width = encoded.info.width;
    height = encoded.info.height;
  } catch {
    throw new BadRequestException('تعذرت قراءة الصورة، استخدم ملف PNG أو JPG سليم');
  }
  if (width < 200 || height < 200) {
    throw new BadRequestException('الصورة صغيرة جدًا لتكون خلفية، استخدم صورة بعرض 200 بكسل على الأقل');
  }
  const doc = await PDFDocument.create();
  const embedded = png ? await doc.embedPng(normalised) : await doc.embedJpg(normalised);
  // The page has the picture's own proportions; how it is fitted to A4 is
  // decided at print time, the same as for a PDF.
  const pageHeight = (A4_WIDTH_PT * height) / width;
  const sheet = doc.addPage([A4_WIDTH_PT, pageHeight]);
  sheet.drawImage(embedded, { x: 0, y: 0, width: A4_WIDTH_PT, height: pageHeight });
  const pdf = Buffer.from(await doc.save());

  const previewWidth = Math.min(width, 1000);
  const preview = await sharp(normalised).flatten({ background: '#ffffff' }).resize({ width: previewWidth }).png().toBuffer();
  const zones = await inkZones(preview);
  return { pdf, preview, kind: 'image', pageCount: 1, zones: { ...zones, widthPt: A4_WIDTH_PT, heightPt: pageHeight } };
}

interface Zones {
  /// Fractions of the background's own height.
  topFraction: number;
  bottomFraction: number;
}

/// Finds the artwork that hangs from the top and rises from the bottom edge of
/// a letterhead: rows holding real ink (headers, footers, stamps), not the pale
/// watermark in the middle. Two nearby blocks (a stamp above a footer band) are
/// one zone; a zone never reaches past a third of the sheet.
export async function inkZones(png: Buffer): Promise<Zones> {
  const { data, info } = await sharp(png)
    .flatten({ background: '#ffffff' })
    .resize({ width: 320 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const ink: boolean[] = [];
  for (let y = 0; y < height; y++) {
    let hits = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 200) hits++;
    }
    // Real header/footer artwork spans a fair part of the width; a thin side
    // stripe or an edge rule runs down every row and must not reserve the sheet.
    ink.push(hits >= width * 0.12);
  }
  // A gap of this many rows (about 12 mm of a letterhead) ends a zone.
  const gap = Math.max(2, Math.round(height * (12 / 297)));
  const cap = Math.round(height / 3);

  let topFraction = 0;
  const first = ink.indexOf(true);
  if (first !== -1 && first < cap) {
    let end = first;
    let blanks = 0;
    for (let y = first; y < height && y < cap * 2; y++) {
      if (ink[y]) { end = y; blanks = 0; } else if (++blanks >= gap) break;
    }
    topFraction = Math.min(end + 1, cap) / height;
  }
  let bottomFraction = 0;
  const last = ink.lastIndexOf(true);
  if (last !== -1 && last > height - cap) {
    let start = last;
    let blanks = 0;
    for (let y = last; y >= 0 && y > height - cap * 2; y--) {
      if (ink[y]) { start = y; blanks = 0; } else if (++blanks >= gap) break;
    }
    bottomFraction = Math.min(height - start, cap) / height;
  }
  return { topFraction, bottomFraction };
}
