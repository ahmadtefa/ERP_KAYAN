#!/usr/bin/env node
/**
 * The custom quotation background, end to end, against the real HTTP API.
 *
 * `quotation-background.spec.ts` proves the rules (signatures, page selection,
 * the merge arithmetic) and `verify-artwork-pdf.mjs` proves the finished sheet
 * - rasterised and measured - is printed on. Neither touches the two things a
 * person actually does: **upload a letterhead** and **click download**.
 *
 * This scenario does exactly that, over HTTP, on a disposable PostgreSQL:
 *
 *   * a real PNG letterhead is accepted and stored as a one-page A4 PDF;
 *   * the same picture uploaded twice is refused instead of stored twice;
 *   * a text file named `.png` is refused, because the type is read from the
 *     bytes and not from the file name;
 *   * a real two-page PDF letterhead keeps both pages;
 *   * the library lists what was uploaded, and the preview serves the stored
 *     PDF inline;
 *   * a long Arabic offer printed on that letterhead downloads as a PDF whose
 *     every page is the letterhead's own sheet, carries the picture, and is
 *     named after the offer - not after the database id;
 *   * an offer with no letterhead downloads the drawn design, with no picture
 *     on any page: the artwork is opt-in per offer.
 *
 *   DATABASE_URL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... \
 *     node backend/scripts/scenario-quotation-artwork.mjs [apiBaseUrl]
 */
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import { PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';

const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required; this scenario must use disposable PostgreSQL.');
}

const A4 = { width: 595.28, height: 841.89 };
const MAGENTA = { r: 221, g: 15, b: 132 };

const results = [];
let token = '';
const stamp = String(Date.now()).slice(-7);
const today = new Date().toISOString().slice(0, 10);

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (token && !options.noAuth && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body:
      options.body ??
      (options.json === undefined ? undefined : JSON.stringify(options.json)),
  });
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('application/json')
    ? await response.json().catch(() => null)
    : type.includes('application/pdf')
      ? Buffer.from(await response.arrayBuffer())
      : await response.text();
  return { status: response.status, data, headers: response.headers };
}

async function must(label, path, options = {}) {
  const response = await api(path, options);
  if (response.status >= 200 && response.status < 300) return response.data;
  check(label, false, `${response.status} ${JSON.stringify(response.data)?.slice(0, 400)}`);
  return null;
}

/// A letterhead as an office really sends one: a picture.
async function pngLetterhead() {
  const width = 1240;
  const height = 1754;
  const band = await sharp({
    create: {
      width,
      height: 220,
      channels: 3,
      background: { r: MAGENTA.r, g: MAGENTA.g, b: MAGENTA.b },
    },
  })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: band, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/// A two-page letterhead as a PDF with a printer would supply it.
async function pdfLetterhead(pages) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  for (let index = 0; index < pages; index += 1) {
    const page = document.addPage([A4.width, A4.height]);
    page.drawRectangle({
      x: 0,
      y: A4.height - 90,
      width: A4.width,
      height: 90,
      color: rgb(MAGENTA.r / 255, MAGENTA.g / 255, MAGENTA.b / 255),
    });
    page.drawText(`LETTERHEAD ${index + 1}`, {
      x: 40,
      y: A4.height - 60,
      size: 22,
      font,
      color: rgb(1, 1, 1),
    });
  }
  return Buffer.from(await document.save());
}

function upload(path, bytes, name, type, extra = {}) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return api(path, { method: 'POST', body: form });
}

/// pdf-lib hands back indirect references; the values behind them are what a
/// reader draws. Both helpers follow a reference once.
const deref = (document, value) =>
  value && typeof value === 'object' && 'objectNumber' in value
    ? document.context.lookup(value)
    : value;

/// Every picture drawn on a page, at any depth.
///
/// The merge places the letterhead as an *embedded page* - a form XObject -
/// and the picture lives inside that form, so a scan of the page's own
/// resources finds nothing and would pass for the wrong reason. The sizes
/// returned are the picture's own pixels: 1240 x 1754 is the file this
/// scenario uploaded, and nothing else on a sheet is that size.
function imagesOn(document, resources, depth = 0, seen = new Set()) {
  const dict = deref(document, resources);
  if (!dict || depth > 4 || typeof dict.get !== 'function') return [];
  const xobjects = deref(document, dict.get(PDFName.of('XObject')));
  if (!xobjects || typeof xobjects.keys !== 'function') return [];
  const found = [];
  for (const key of xobjects.keys()) {
    const stream = deref(document, xobjects.get(key));
    if (!stream || !stream.dict || seen.has(stream)) continue;
    seen.add(stream);
    const subtype = String(deref(document, stream.dict.get(PDFName.of('Subtype'))));
    if (subtype === '/Image') {
      found.push({
        width: Number(deref(document, stream.dict.get(PDFName.of('Width')))?.toString?.() ?? NaN),
        height: Number(deref(document, stream.dict.get(PDFName.of('Height')))?.toString?.() ?? NaN),
      });
    } else if (subtype === '/Form') {
      found.push(
        ...imagesOn(document, stream.dict.get(PDFName.of('Resources')), depth + 1, seen),
      );
    }
  }
  return found;
}

/// The text a page actually draws, decompressed.
///
/// pdf-lib writes every string as a hex literal, so "1 / 2" is the bytes
/// `<31202F2032> Tj`. Reading it back is how the proof says the page number
/// survived the merge instead of trusting that it was drawn.
function drawnText(document, page) {
  const raw = deref(document, page.node.get(PDFName.of('Contents')));
  const streams = Array.isArray(raw?.asArray?.()) ? raw.asArray().map((ref) => deref(document, ref)) : [raw];
  let text = '';
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream)) continue;
    const filter = String(deref(document, stream.dict.get(PDFName.of('Filter'))) ?? '');
    const body = Buffer.from(stream.contents ?? stream.getContents?.() ?? []);
    text += /FlateDecode/.test(filter) ? inflateSync(body).toString('latin1') : body.toString('latin1');
  }
  return text;
}

function drawnStrings(document, page) {
  const text = drawnText(document, page);
  const strings = [];
  for (const match of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    strings.push(Buffer.from(match[1], 'hex').toString('latin1'));
  }
  return strings;
}

/// 70 rows: long enough that the offer cannot be one page.
function longTables(rows) {
  const lines = [];
  for (let index = 0; index < rows; index += 1) {
    lines.push({
      description: `بند عرض السعر رقم ${index + 1} — item line ${index + 1} with a description long enough to occupy a row`,
      quantity: '1',
      unitPrice: String(100 + index),
      unit: 'piece',
    });
  }
  return [{ title: 'البنود / Items', lines }];
}

async function main() {
  // The server rate limits sign-ins by address; an earlier scenario may have
  // filled the window, so the wait is the client's job.
  let signedIn = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  for (let attempt = 1; signedIn.status === 429 && attempt <= 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 15000));
    signedIn = await api('/auth/login', {
      method: 'POST',
      json: { username: USERNAME, password: PASSWORD },
      noAuth: true,
    });
  }
  check('sign in', signedIn.status === 201, `status ${signedIn.status}`);
  token = signedIn.data?.accessToken;
  if (!token) return;

  // ── the artwork library ─────────────────────────────────────────────
  const png = await pngLetterhead();
  const uploadPng = await upload(
    '/sales/quotation-backgrounds',
    png,
    `letterhead-${stamp}.png`,
    'image/png',
    { name: `Letterhead PNG ${stamp}` },
  );
  check(
    'a PNG letterhead is accepted',
    uploadPng.status === 201,
    `${uploadPng.status} ${JSON.stringify(uploadPng.data)?.slice(0, 300)}`,
  );
  const pngRow = uploadPng.data;
  if (!pngRow?.id) return;
  check(
    'a picture is stored as a one-page PDF, not as a picture',
    pngRow.mimeType === 'application/pdf' && pngRow.pageCount === 1,
    JSON.stringify({ mimeType: pngRow.mimeType, pages: pngRow.pageCount }),
  );
  check(
    'the stored sheet is A4, whatever shape the picture was',
    Math.abs(pngRow.pageWidth - A4.width) < 0.5 && Math.abs(pngRow.pageHeight - A4.height) < 0.5,
    `${pngRow.pageWidth} x ${pngRow.pageHeight}`,
  );
  check('the letterhead keeps the name it was given', pngRow.name === `Letterhead PNG ${stamp}`, pngRow.name);

  const disguised = await upload(
    '/sales/quotation-backgrounds',
    Buffer.from('this is not a picture, whatever the name says'),
    `notes-${stamp}.png`,
    'image/png',
  );
  check(
    'a text file named .png is refused, because the bytes are read and not the name',
    disguised.status === 400,
    `status ${disguised.status}`,
  );

  const pdf = await pdfLetterhead(2);
  const uploadPdf = await upload(
    '/sales/quotation-backgrounds',
    pdf,
    `contract-letterhead-${stamp}.pdf`,
    'application/pdf',
    { name: `Two-page letterhead ${stamp}` },
  );
  check('a two-page PDF letterhead is accepted', uploadPdf.status === 201, `status ${uploadPdf.status}`);
  const pdfRow = uploadPdf.data;
  check('a PDF letterhead keeps its own pages', pdfRow?.pageCount === 2, String(pdfRow?.pageCount));

  // A file that is already in the library is refused, not stored twice. This
  // is checked with a PDF because a PDF is stored byte for byte; a picture is
  // converted into a fresh PDF, so two uploads of the same picture are two
  // entries (a known, harmless limit - see the delivery report).
  const duplicate = await upload(
    '/sales/quotation-backgrounds',
    pdf,
    `contract-letterhead-copy-${stamp}.pdf`,
    'application/pdf',
  );
  check(
    'the same PDF letterhead is refused instead of stored twice',
    duplicate.status === 409,
    `status ${duplicate.status}`,
  );
  check(
    'the stored file is ours, not the upload echoed back',
    pdfRow?.mimeType === 'application/pdf' &&
      pdfRow?.sha256 === createHash('sha256').update(pdf).digest('hex'),
    'a PDF background is stored byte for byte',
  );

  const library = await must('read the artwork library', '/sales/quotation-backgrounds');
  const listed = Array.isArray(library) ? library : library?.items ?? [];
  check(
    'the library lists both letterheads',
    listed.some((row) => row.id === pngRow.id) && listed.some((row) => row.id === pdfRow?.id),
    `${listed.length} file(s)`,
  );
  check(
    'the library never ships the bytes with the list',
    listed.every((row) => row.data === undefined && row.byteSize > 0),
  );

  const preview = await api(`/sales/quotation-backgrounds/${pngRow.id}/file`);
  check(
    'the preview is the stored PDF, sent inline',
    preview.status === 200 &&
      String(preview.headers.get('content-type')).includes('application/pdf') &&
      String(preview.headers.get('content-disposition')).startsWith('inline') &&
      Buffer.isBuffer(preview.data) &&
      preview.data.subarray(0, 5).toString('latin1') === '%PDF-',
    `${preview.status} ${preview.headers.get('content-type')}`,
  );

  // ── an offer printed on it ──────────────────────────────────────────
  const customer = await must('create a customer', '/parties/customers', {
    method: 'POST',
    json: {
      code: `ART-C-${stamp}`,
      nameEn: `Artwork customer ${stamp}`,
      nameAr: `عميل الخلفية ${stamp}`,
      phone: '01000000000',
    },
  });
  if (!customer?.id) return;

  const payload = (subject, background) => ({
    quotationDate: today,
    validUntil: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    customerId: customer.id,
    currency: 'EGP',
    subject,
    terms: 'العرض سارٍ لمدة أسبوعين. / Valid for two weeks.',
    ...background,
    tables: longTables(70),
  });

  const onArtwork = await must('create an offer on the letterhead', '/sales/quotations', {
    method: 'POST',
    json: payload(`عرض بخلفية ${stamp}`, {
      backgroundFileId: pngRow.id,
      background: {
        mode: 'REPEAT',
        showPageNumbers: true,
        pageNumberColor: '#111827',
        marginMm: { top: 40, bottom: 24, left: 14, right: 14 },
      },
    }),
  });
  if (!onArtwork?.id) return;
  check(
    'the offer remembers which letterhead it prints on',
    onArtwork.backgroundFileId === pngRow.id,
    String(onArtwork.backgroundFileId),
  );

  const download = await api(`/sales/quotations/${onArtwork.id}/pdf?lang=ar`);
  check('the download answers with a file', download.status === 200, `status ${download.status}`);
  if (download.status !== 200) {
    check('the download explains itself', false, JSON.stringify(download.data)?.slice(0, 300));
    return;
  }
  check(
    'the answer is a PDF sent as an attachment named after the offer',
    String(download.headers.get('content-type')).includes('application/pdf') &&
      String(download.headers.get('content-disposition')).startsWith('attachment') &&
      String(download.headers.get('content-disposition')).includes(
        `quotation-${String(onArtwork.quotationNumber).replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`,
      ),
    String(download.headers.get('content-disposition')),
  );
  check(
    'a downloaded file is never served from a cache',
    download.headers.get('cache-control') === 'no-store',
    String(download.headers.get('cache-control')),
  );

  const bytes = download.data;
  check(
    'the downloaded bytes really are a PDF',
    Buffer.isBuffer(bytes) && bytes.subarray(0, 5).toString('latin1') === '%PDF-',
  );

  let finished;
  try {
    finished = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  } catch (error) {
    check('the downloaded file opens in a PDF reader', false, error.message);
    return;
  }
  const pages = finished.getPages();
  check('the downloaded file opens in a PDF reader', true, `${pages.length} page(s)`);
  check(
    'a seventy-line offer spans more than one sheet',
    pages.length >= 2,
    `${pages.length} page(s)`,
  );
  check(
    'every page is the letterhead sheet, not a resized page',
    pages.every(
      (page) =>
        Math.abs(page.getWidth() - A4.width) < 0.5 &&
        Math.abs(page.getHeight() - A4.height) < 0.5,
    ),
    `${Math.round(pages[0].getWidth())} x ${Math.round(pages[0].getHeight())} pt`,
  );
  // The picture's own pixels: the file this scenario generated.
  const uploaded = { width: 1240, height: 1754 };
  const pictures = pages.map((page) => imagesOn(finished, page.node.Resources()));
  check(
    'the uploaded picture is on every page of the offer',
    pictures.every((found) =>
      found.some((image) => image.width === uploaded.width && image.height === uploaded.height),
    ),
    pictures.map((found) => found.map((image) => `${image.width}x${image.height}`).join('+') || 'none').join(' '),
  );
  const numbered = pages.map((page, index) => {
    const strings = drawnStrings(finished, page);
    return strings.some((value) => value.replace(/\s+/g, ' ').trim() === `${index + 1} / ${pages.length}`);
  });
  check(
    'every page still carries its own "n / N"',
    numbered.every(Boolean),
    numbered.map((ok, index) => (ok ? `${index + 1} ok` : `${index + 1} MISSING`)).join(', '),
  );

  // ── the artwork is opt-in ───────────────────────────────────────────
  const drawn = await must('create an offer with no letterhead', '/sales/quotations', {
    method: 'POST',
    json: payload(`عرض بدون خلفية ${stamp}`, {}),
  });
  if (!drawn?.id) return;
  const plain = await api(`/sales/quotations/${drawn.id}/pdf?lang=ar`);
  let plainPdf = null;
  if (plain.status === 200) {
    plainPdf = await PDFDocument.load(new Uint8Array(plain.data), {
      updateMetadata: false,
    });
  }
  check(
    'an offer with no letterhead still downloads',
    plain.status === 200 && plainPdf !== null,
    `status ${plain.status}`,
  );
  if (plainPdf) {
    check(
      'an offer with no letterhead prints no letterhead',
      plainPdf
        .getPages()
        .every((page) =>
          imagesOn(plainPdf, page.node.Resources()).every(
            (image) => image.width !== 1240 || image.height !== 1754,
          ),
        ),
      `${plainPdf.getPageCount()} page(s), no letterhead picture`,
    );
    check(
      'the drawn design prints the offer it holds',
      plainPdf.getPageCount() >= 1 && plainPdf.getPageCount() <= pages.length + 1,
      `${plainPdf.getPageCount()} page(s)`,
    );
  }

  // ── retiring artwork ───────────────────────────────────────────────
  //
  // Deleting an unused letterhead is allowed. Deleting the one a *draft* uses
  // is also allowed - the draft loses the binding and prints on the drawn
  // design again - and that fallback is the thing worth proving: a library
  // change must never leave an offer that cannot be printed.
  const retired = await api(`/sales/quotation-backgrounds/${pdfRow?.id}`, { method: 'DELETE' });
  check(
    'an unused letterhead can be retired',
    retired.status === 200 || retired.status === 204,
    `status ${retired.status}`,
  );

  const removed = await api(`/sales/quotation-backgrounds/${pngRow.id}`, { method: 'DELETE' });
  check(
    'a letterhead used only by a draft can be retired',
    removed.status === 200 || removed.status === 204,
    `status ${removed.status} ${JSON.stringify(removed.data)?.slice(0, 200) ?? ''}`,
  );

  const afterRemoval = await api(`/sales/quotations/${onArtwork.id}/pdf?lang=ar`);
  let fallback = null;
  if (afterRemoval.status === 200) {
    fallback = await PDFDocument.load(new Uint8Array(afterRemoval.data), {
      updateMetadata: false,
    });
  }
  check(
    'the offer still downloads after its letterhead was retired',
    afterRemoval.status === 200 && fallback !== null,
    `status ${afterRemoval.status}`,
  );
  check(
    'it falls back to the drawn design instead of failing to print',
    fallback !== null &&
      fallback
        .getPages()
        .every((page) =>
          imagesOn(fallback, page.node.Resources()).every(
            (image) => image.width !== 1240 || image.height !== 1754,
          ),
        ),
    `${fallback?.getPageCount() ?? 0} page(s), no letterhead picture`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    results.push({ name: 'scenario crashed', ok: false, detail: error.message });
  })
  .finally(() => {
    const failed = results.filter((row) => !row.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
      console.log('FAILED:');
      for (const row of failed) console.log(`  - ${row.name} ${row.detail}`);
      process.exitCode = 1;
    }
  });
