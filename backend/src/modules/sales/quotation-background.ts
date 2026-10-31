import { BadRequestException } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'crypto';

/// The artwork an offer is printed on, and the rules for using its pages.
///
/// Everything here is pure: the bytes in, the bytes out. The storage, the
/// permissions and the audit trail live in the service next to this file, so
/// the merge can be pinned by a test that needs no database, no browser and no
/// network - which is the only way a printed sheet can be proven to be the
/// sheet that was ordered.
export const BACKGROUND_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

/// The sheet an overlay is laid out on, in millimetres, for the CSS `@page`
/// rule. Chromium prints exactly this box, and the merge then draws the
/// overlay onto the artwork's own page at 1:1.
export interface SheetSize {
  widthMm: number;
  heightMm: number;
  marginMm: { top: number; bottom: number; left: number; right: number };
  /// Set when the overlay had to be scaled to fit a differently sized artwork
  /// page. Nothing is stretched: the scale is uniform, so text keeps its shape.
  scaled: boolean;
}

/// How the artwork's pages are used behind a multi-page offer.
///
///   REPEAT      every offer page prints on the first artwork page (letterhead)
///   SEQUENCE    artwork pages are used in order; after the last one the last
///               page repeats, so a two-page artwork behind a five-page offer
///               gives 1, 2, 2, 2, 2 instead of silently dropping artwork
///   SINGLE_PAGE one chosen page behind every offer page
export type BackgroundMode = 'REPEAT' | 'SEQUENCE' | 'SINGLE_PAGE';

export interface QuotationBackgroundSettings {
  mode: BackgroundMode;
  /// 1-based; only meaningful for SINGLE_PAGE, clamped to the file's pages.
  page: number;
  showPageNumbers: boolean;
  /// The ink of "1 / 3". A dark letterhead wants white, a light one wants ink.
  pageNumberColor: { r: number; g: number; b: number };
  /// Where the offer's own text may start and stop, in millimetres. The
  /// letterhead's own logo and footer live in these margins.
  marginMm: { top: number; bottom: number; left: number; right: number };
}

export const DEFAULT_BACKGROUND_SETTINGS: QuotationBackgroundSettings = {
  mode: 'REPEAT',
  page: 1,
  showPageNumbers: true,
  pageNumberColor: { r: 0.12, g: 0.16, b: 0.22 },
  marginMm: { top: 20, bottom: 18, left: 12, right: 12 },
};

/// Artwork metadata measured from the file, never from what the upload
/// claimed. The stored row keeps exactly these numbers.
export interface BackgroundFileInfo {
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  byteSize: number;
  sha256: string;
  /// True when the artwork's pages do not all measure the same. The merge
  /// still works; the offer is simply laid out per page.
  mixedPageSizes: boolean;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toColour(raw: unknown): { r: number; g: number; b: number } {
  const fallback = DEFAULT_BACKGROUND_SETTINGS.pageNumberColor;
  if (typeof raw !== 'string') return fallback;
  const match = /^#?([0-9a-f]{6})$/i.exec(raw.trim());
  if (!match) return fallback;
  const value = parseInt(match[1], 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

export function colourToHex(colour: { r: number; g: number; b: number }): string {
  const channel = (value: number) =>
    Math.round(clamp(value, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(colour.r)}${channel(colour.g)}${channel(colour.b)}`;
}

/// Reads the settings a template or an issued offer carries.
///
/// Anything unreadable falls back to the defaults rather than throwing: a
/// quotation must still print if somebody stored a mangled setting, and the
/// default is the safe one (the artwork is used, the page numbers are drawn,
/// no page is skipped).
export function parseBackgroundSettings(
  raw: unknown,
  pageCount = Number.MAX_SAFE_INTEGER,
): QuotationBackgroundSettings {
  const value = (raw ?? {}) as Record<string, unknown>;
  const modeRaw = typeof value.mode === 'string' ? value.mode.toUpperCase() : '';
  const mode: BackgroundMode =
    modeRaw === 'SEQUENCE' || modeRaw === 'SINGLE_PAGE' ? modeRaw : 'REPEAT';

  const page = clamp(Math.floor(toNumber(value.page) ?? 1), 1, Math.max(pageCount, 1));

  const margins = (value.marginMm ?? {}) as Record<string, unknown>;
  const margin = (key: keyof QuotationBackgroundSettings['marginMm']) =>
    clamp(
      toNumber(margins[key]) ?? DEFAULT_BACKGROUND_SETTINGS.marginMm[key],
      0,
      80,
    );

  return {
    mode,
    page,
    showPageNumbers: value.showPageNumbers !== false,
    pageNumberColor: toColour(value.pageNumberColor),
    marginMm: {
      top: margin('top'),
      bottom: margin('bottom'),
      left: margin('left'),
      right: margin('right'),
    },
  };
}

/// Which artwork page sits behind offer page [pageIndex] (0-based).
///
/// The three rules differ only in what they do when the offer is longer than
/// the artwork, and none of them ever asks for a page that does not exist:
/// that is how a one-page letterhead stays a letterhead and a five-page
/// contract does not lose its last two pages of artwork.
export function selectBackgroundPage(
  pageIndex: number,
  settings: QuotationBackgroundSettings,
  pageCount: number,
): number {
  const total = Math.max(pageCount, 1);
  const index = Math.max(pageIndex, 0);
  switch (settings.mode) {
    case 'SINGLE_PAGE':
      return clamp(settings.page - 1, 0, total - 1);
    case 'SEQUENCE':
      return Math.min(index, total - 1);
    case 'REPEAT':
    default:
      return 0;
  }
}

/// Converts the artwork's page box into the sheet the overlay is laid out on.
///
/// Points are 1/72", CSS wants millimetres; a PDF page's own width and height
/// are used as they are, so nothing is ever resampled or stretched on the way
/// to paper.
export function sheetForBackground(
  page: { width: number; height: number },
  settings: QuotationBackgroundSettings = DEFAULT_BACKGROUND_SETTINGS,
): SheetSize {
  const mm = (points: number) => Math.round((points * 25.4) / 72 * 100) / 100;
  return {
    widthMm: mm(page.width),
    heightMm: mm(page.height),
    marginMm: settings.marginMm,
    scaled: false,
  };
}

const PDF_MAGIC = '%PDF-';
const PDF_TRAILER = '%%EOF';

/// Checks that what arrived is a PDF we can actually print on.
///
/// Five separate things are proven, because four of them can be true while the
/// file is useless: the extension, the size, the real file signature, the
/// trailer, and - the only one that matters - that a PDF parser can open it and
/// find pages with a positive size. A PNG renamed to `.pdf` fails the
/// signature; a truncated download fails the trailer or the parser; a
/// password-protected file fails to open, which is right: its artwork cannot
/// be drawn behind an offer.
export async function inspectPdfUpload(upload: {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  maxBytes?: number;
}): Promise<BackgroundFileInfo> {
  const maxBytes = upload.maxBytes ?? BACKGROUND_UPLOAD_MAX_BYTES;
  const buffer = upload.buffer;
  const name = (upload.originalname ?? '').trim();

  if (!buffer || buffer.length === 0) {
    throw new BadRequestException(
      'لم يتم اختيار ملف / No file was uploaded.',
    );
  }
  if (buffer.length > maxBytes) {
    throw new BadRequestException(
      `حجم ملف الخلفية أكبر من الحد المسموح (${Math.round(maxBytes / 1024 / 1024)} ميجابايت). / ` +
        `The background file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`,
    );
  }
  if (name && !/\.pdf$/i.test(name)) {
    throw new BadRequestException(
      'يجب أن تكون خلفية العرض ملف PDF بامتداد ‎.pdf‎. / The background must be a .pdf file.',
    );
  }

  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  if (!head.includes(PDF_MAGIC)) {
    throw new BadRequestException(
      'محتوى الملف ليس PDF حتى لو كان امتداده كذلك. / The file content is not a PDF, whatever its extension says.',
    );
  }
  const tail = buffer
    .subarray(Math.max(0, buffer.length - 2048))
    .toString('latin1');
  if (!tail.includes(PDF_TRAILER)) {
    throw new BadRequestException(
      'ملف PDF غير مكتمل أو تالف (لا توجد نهاية الملف). / The PDF is truncated or damaged: its end marker is missing.',
    );
  }

  // pdf-lib parses lazily: `load` accepts a file whose page tree is nonsense,
  // and the failure only appears when the pages are asked for. Both calls are
  // therefore inside the guard - an unreadable file must be a clear refusal,
  // never a 500 from deep inside the parser.
  let pages: ReturnType<PDFDocument['getPages']>;
  let sizes: Array<{ width: number; height: number }>;
  try {
    // pdf-lib asks for Uint8Array<ArrayBuffer>; a Node Buffer is
    // Uint8Array<ArrayBufferLike>, so it is copied into a plain view.
    const document = await PDFDocument.load(new Uint8Array(buffer), {
      updateMetadata: false,
    });
    pages = document.getPages();
    sizes = pages.map((page) => page.getSize());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const encrypted = /encrypt/i.test(message);
    throw new BadRequestException(
      encrypted
        ? 'ملف PDF محمي بكلمة سر ولا يمكن استخدامه كخلفية. / The PDF is password protected and cannot be used as artwork.'
        : `تعذر قراءة ملف PDF: ${message} / The PDF could not be read: ${message}`,
    );
  }

  if (pages.length === 0) {
    throw new BadRequestException(
      'ملف PDF لا يحتوي صفحات. / The PDF has no pages.',
    );
  }
  const broken = sizes.some((size) => !(size.width > 0) || !(size.height > 0));
  if (broken) {
    throw new BadRequestException(
      'ملف PDF يحتوي صفحة بأبعاد غير صالحة. / The PDF has a page with no printable size.',
    );
  }

  const first = sizes[0];
  const mixedPageSizes = sizes.some(
    (size) =>
      Math.abs(size.width - first.width) > 0.5 ||
      Math.abs(size.height - first.height) > 0.5,
  );

  return {
    pageCount: pages.length,
    pageWidth: Math.round(first.width * 100) / 100,
    pageHeight: Math.round(first.height * 100) / 100,
    byteSize: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    mixedPageSizes,
  };
}

/// Where the overlay is drawn on an artwork page.
///
/// Zoomed to the artwork's box with one scale for both axes, then centred.
/// Two aspects are preserved at once: the artwork's (it is the page) and the
/// offer's (the overlay is only ever scaled uniformly), so neither is ever
/// squeezed. Exported because "never distort" is a promise a test can check.
export function overlayPlacement(
  page: { width: number; height: number },
  overlay: { width: number; height: number },
): { x: number; y: number; width: number; height: number; scale: number } {
  const scale = Math.min(page.width / overlay.width, page.height / overlay.height);
  const width = overlay.width * scale;
  const height = overlay.height * scale;
  return {
    x: (page.width - width) / 2,
    y: (page.height - height) / 2,
    width,
    height,
    scale,
  };
}

export interface MergeOptions {
  background: Buffer;
  overlay: Buffer;
  settings: QuotationBackgroundSettings;
  /// Where the page number sits, as the drawn design has always placed it.
  pageNumber?: { y: number; size: number } | null;
}

export interface MergeResult {
  pdf: Buffer;
  pages: number;
  /// Which artwork page ended up behind each offer page, in order. Returned so
  /// a test - and the operator's preview - can say exactly what happened when
  /// the artwork and the offer do not have the same number of pages.
  backgroundPages: number[];
  mixedPageSizes: boolean;
}

/// Puts the offer on top of the artwork, page by page.
///
/// The output page is the artwork page: same box, same orientation, drawn at
/// its native size, so a designed letterhead keeps its aspect ratio and is
/// never stretched to fit an offer. The overlay - which the browser laid out,
/// because only a browser joins Arabic letters correctly - is drawn above it
/// at 1:1 when the boxes agree, and uniformly scaled and centred when a
/// multi-page artwork changes size part-way through. Uniform is the point:
/// text that is scaled but never distorted still reads as the document it is.
///
/// The page number is stamped last, on the merged page, so it is guaranteed to
/// be above the artwork instead of hidden behind it.
export async function mergeOfferOntoBackground(
  options: MergeOptions,
): Promise<MergeResult> {
  const [backgroundDocument, overlayDocument] = await Promise.all([
    PDFDocument.load(new Uint8Array(options.background), { updateMetadata: false }),
    PDFDocument.load(new Uint8Array(options.overlay), { updateMetadata: false }),
  ]);

  const backgroundPages = backgroundDocument.getPages();
  const overlayPages = overlayDocument.getPages();
  if (backgroundPages.length === 0) {
    throw new BadRequestException('The background PDF has no pages.');
  }
  if (overlayPages.length === 0) {
    throw new BadRequestException('The offer produced no pages.');
  }

  const output = await PDFDocument.create();
  const font = options.settings.showPageNumbers
    ? await output.embedFont(StandardFonts.Helvetica)
    : null;

  const embeddedBackgrounds = new Map<number, Awaited<ReturnType<typeof output.embedPage>>>();
  const chosen: number[] = [];
  const backgroundSizes = backgroundPages.map((page) => page.getSize());
  const mixedPageSizes = backgroundSizes.some(
    (size) =>
      Math.abs(size.width - backgroundSizes[0].width) > 0.5 ||
      Math.abs(size.height - backgroundSizes[0].height) > 0.5,
  );

  for (let index = 0; index < overlayPages.length; index += 1) {
    const backgroundIndex = selectBackgroundPage(
      index,
      options.settings,
      backgroundPages.length,
    );
    chosen.push(backgroundIndex);

    const size = backgroundSizes[backgroundIndex];
    const page = output.addPage([size.width, size.height]);

    let embeddedBackground = embeddedBackgrounds.get(backgroundIndex);
    if (!embeddedBackground) {
      embeddedBackground = await output.embedPage(backgroundPages[backgroundIndex]);
      embeddedBackgrounds.set(backgroundIndex, embeddedBackground);
    }
    page.drawPage(embeddedBackground, {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    });

    const placement = overlayPlacement(size, overlayPages[index].getSize());
    const embeddedOverlay = await output.embedPage(overlayPages[index]);
    page.drawPage(embeddedOverlay, {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    });

    if (font && options.settings.showPageNumbers) {
      const label = `${index + 1} / ${overlayPages.length}`;
      const fontSize = options.pageNumber?.size ?? 9;
      const textWidth = font.widthOfTextAtSize(label, fontSize);
      page.drawText(label, {
        x: (size.width - textWidth) / 2,
        y: options.pageNumber?.y ?? 12,
        size: fontSize,
        font,
        color: rgb(
          options.settings.pageNumberColor.r,
          options.settings.pageNumberColor.g,
          options.settings.pageNumberColor.b,
        ),
      });
    }
  }

  return {
    pdf: Buffer.from(await output.save()),
    pages: overlayPages.length,
    backgroundPages: chosen,
    mixedPageSizes,
  };
}
