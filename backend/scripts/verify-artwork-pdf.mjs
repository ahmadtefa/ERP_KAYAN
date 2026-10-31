#!/usr/bin/env node
/**
 * Proves, on a real sheet, that an offer printed on an attached PDF is really
 * printed on it.
 *
 * Unit tests prove the merge arithmetic; they cannot prove that the browser
 * left the overlay transparent, that the artwork survived, or that the text
 * sits on top of it. Those are the three things an operator would notice, so
 * they are checked by looking at the finished pixels:
 *
 *   * the sheet is the artwork's own size;
 *   * the artwork's magenta band is still magenta after the merge (a browser
 *     that painted the page background over it would make it white);
 *   * the offer's text drew dark pixels inside the artwork's header area and
 *     inside the content area;
 *   * "n / N" is centred at the bottom of every page;
 *   * a one-page artwork behind a multi-page offer is repeated on every page,
 *     and a two-page artwork is used in order.
 *
 * Run where a browser and poppler exist (the CI job installs both):
 *
 *   node scripts/verify-artwork-pdf.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import sharp from 'sharp';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { PdfService } from '../dist/src/modules/export/pdf.service.js';
import { renderQuotationDocument } from '../dist/src/modules/sales/quotation-document.js';
import {
  mergeOfferOntoBackground,
  parseBackgroundSettings,
  sheetForBackground,
} from '../dist/src/modules/sales/quotation-background.js';

const A4 = { width: 595.28, height: 841.89 };
const MAGENTA = { r: 221, g: 15, b: 132 };

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/// A letterhead as a company would send it: a solid band across the top, a
/// block of colour at the bottom, and a wordmark - all in one colour that
/// cannot occur by accident anywhere else on the sheet.
async function artwork(pages) {
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

function offerFixture() {
  const lines = Array.from({ length: 18 }, (_, index) => ({
    itemCode: `SKU-${index + 1}`,
    description: 'بند توريد وتركيب واختبار وفق المواصفات الفنية المعتمدة في العرض.',
    countryOfOrigin: 'EG',
    unit: 'قطعة',
    quantity: '2.0000',
    unitPrice: '1250.0000',
    lineTotal: '2500.0000',
    customValues: {},
  }));
  return {
    quotationNumber: 'QT-ARTWORK-0001',
    quotationDate: '2026-11-01',
    validUntil: null,
    currency: 'EGP',
    version: 1,
    status: 'SENT',
    customer: {
      code: 'CUS-1',
      nameEn: 'Delta Engineering',
      nameAr: 'دلتا للهندسة',
      phone: null,
      email: null,
      taxNumber: null,
      address: null,
    },
    company: {
      nameEn: 'KAYAN Integrated Solutions',
      nameAr: 'كيان للحلول المتكاملة',
      taxId: null,
      commercialRegistration: null,
      phone: null,
      email: null,
      address: null,
      addressAr: null,
    },
    showTaxId: false,
    subject: 'توريد أجهزة وشبكات',
    columns: [
      { key: 'itemCode', labelEn: null, labelAr: null, visible: true, width: 1 },
      { key: 'description', labelEn: null, labelAr: null, visible: true, width: 4 },
      { key: 'unit', labelEn: null, labelAr: null, visible: true, width: 1 },
      { key: 'quantity', labelEn: null, labelAr: null, visible: true, width: 1 },
      { key: 'unitPrice', labelEn: null, labelAr: null, visible: true, width: 1 },
      { key: 'lineTotal', labelEn: null, labelAr: null, visible: true, width: 1 },
    ],
    managerName: null,
    responsibleName: null,
    responsiblePhone: null,
    notes: null,
    terms: 'الدفع خلال ثلاثين يومًا من تاريخ العرض.',
    discountType: 'PERCENT',
    discountPercent: '0.0000',
    discountAmount: '0.0000',
    taxRate: '14.0000',
    taxAmount: '6300.0000',
    tables: [
      {
        title: 'الأجهزة والشبكات',
        sortOrder: 1,
        columns: [],
        subTotal: '45000.0000',
        discountPercent: '0.0000',
        discountAmount: '0.0000',
        netTotal: '45000.0000',
        lines,
      },
    ],
    totals: {
      subTotal: '45000.0000',
      discountTotal: '0.0000',
      totalAmount: '51300.0000',
      taxRate: '14.0000',
      taxAmount: '6300.0000',
    },
    design: {},
  };
}

/// Renders one page of a PDF to raw RGBA pixels through poppler.
function rasterise(pdf, directory, page) {
  const source = join(directory, `sheet-${page}.pdf`);
  const stem = join(directory, `sheet-${page}`);
  writeFileSync(source, pdf);
  execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-r', '72', '-png', '-singlefile', source, stem], {
    stdio: 'pipe',
  });
  return sharp(`${stem}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

/// The text the sheet actually carries on one page, as the PDF stores it.
function pageText(pdf, page) {
  const source = join(mkdtempSync(join(tmpdir(), 'kayan-text-')), 'sheet.pdf');
  writeFileSync(source, pdf);
  try {
    return execFileSync(
      'pdftotext',
      ['-f', String(page), '-l', String(page), source, '-'],
      { encoding: 'utf8' },
    ).replace(/\f/g, ' ');
  } finally {
    rmSync(dirname(source), { recursive: true, force: true });
  }
}

function pixel(raw, info, x, y) {
  const offset = (Math.round(y) * info.width + Math.round(x)) * 4;
  return { r: raw[offset], g: raw[offset + 1], b: raw[offset + 2] };
}

function near(colour, target, tolerance = 24) {
  return (
    Math.abs(colour.r - target.r) <= tolerance &&
    Math.abs(colour.g - target.g) <= tolerance &&
    Math.abs(colour.b - target.b) <= tolerance
  );
}

async function inkIn(raw, info, box) {
  let ink = 0;
  // Every pixel, not every second one: the stamp is small type on a coloured
  // band, and a coarse grid steps straight over its strokes.
  for (let y = box.top; y < box.bottom; y += 1) {
    for (let x = box.left; x < box.right; x += 1) {
      const colour = pixel(raw, info, x, y);
      const luminance = 0.299 * colour.r + 0.587 * colour.g + 0.114 * colour.b;
      if (luminance < 120) ink += 1;
    }
  }
  return ink;
}

async function main() {
  const pdfService = new PdfService();
  if (!pdfService.available) {
    throw new Error(
      'No browser on this machine: the artwork PDF proof needs one (the CI job installs chromium).',
    );
  }
  const directory = mkdtempSync(join(tmpdir(), 'kayan-artwork-'));

  try {
    // ── one page of offer on one page of artwork ─────────────────────────
    const single = await artwork(1);
    const sheet = sheetForBackground(A4, parseBackgroundSettings({}, 1));
    const overlayHtml = renderQuotationDocument(offerFixture(), { logoData: null, logoMime: null }, 'ar', true, sheet);
    const overlay = await pdfService.render(overlayHtml, { fullBleed: true });
    const overlayDocument = await PDFDocument.load(overlay);
    check('the offer needs more than one page', overlayDocument.getPageCount() >= 1, `${overlayDocument.getPageCount()} page(s)`);

    const merged = await mergeOfferOntoBackground({
      background: single,
      overlay,
      settings: parseBackgroundSettings({ mode: 'REPEAT' }, 1),
      pageNumber: { y: 8, size: 8 },
    });
    const mergedDocument = await PDFDocument.load(merged.pdf);
    check(
      'the merged file has one page per offer page',
      mergedDocument.getPageCount() === merged.pages,
      `${mergedDocument.getPageCount()}`,
    );
    const size = mergedDocument.getPage(0).getSize();
    check(
      'the sheet is the artwork size, not A4 forced on it',
      Math.abs(size.width - A4.width) < 1 && Math.abs(size.height - A4.height) < 1,
      `${size.width.toFixed(2)} x ${size.height.toFixed(2)} pt`,
    );

    const first = await rasterise(merged.pdf, directory, 1);
    const band = pixel(first.data, first.info, first.info.width / 2, 24);
    check(
      'the artwork band is still on the paper after the merge',
      near(band, MAGENTA, 30),
      `rgb(${band.r},${band.g},${band.b}) at the top of the sheet`,
    );
    const letterheadInk = await inkIn(first.data, first.info, {
      top: 12,
      bottom: 40,
      left: 20,
      right: first.info.width - 20,
    });
    check('the artwork wordmark survived (white on the band)', letterheadInk > 40, `${letterheadInk} ink pixels`);

    const body = await inkIn(first.data, first.info, {
      top: Math.round(first.info.height * 0.35),
      bottom: Math.round(first.info.height * 0.85),
      left: 20,
      right: first.info.width - 20,
    });
    check('the offer itself is printed on top of the artwork', body > 400, `${body} ink pixels in the body`);

    const footer = await inkIn(first.data, first.info, {
      top: first.info.height - 26,
      bottom: first.info.height - 2,
      left: Math.round(first.info.width / 2) - 40,
      right: Math.round(first.info.width / 2) + 40,
    });
    check('"n / N" is stamped at the bottom centre', footer > 8, `${footer} ink pixels in the footer`);
    const firstPageText = pageText(merged.pdf, 1);
    check(
      'the stamp on the first page of two reads as "1 / 2"',
      /1\s*\/\s*2/.test(firstPageText),
      JSON.stringify(firstPageText.trim().slice(-40)),
    );

    const topLeftCorner = pixel(first.data, first.info, 2, 2);
    check(
      'the sheet is not a white page painted over the artwork',
      !(
        topLeftCorner.r > 245 &&
        topLeftCorner.g > 245 &&
        topLeftCorner.b > 245
      ) && near(topLeftCorner, MAGENTA, 30),
      `rgb(${topLeftCorner.r},${topLeftCorner.g},${topLeftCorner.b}) at the corner`,
    );

    // ── a two-page artwork behind a longer offer ─────────────────────────
    const double = await artwork(2);
    const sequence = await mergeOfferOntoBackground({
      background: double,
      overlay,
      settings: parseBackgroundSettings({ mode: 'SEQUENCE' }, 2),
      pageNumber: { y: 8, size: 8 },
    });
    check(
      'a two-page artwork is used in order and its last page holds',
      sequence.backgroundPages[0] === 0 &&
        sequence.backgroundPages[1] === 1 &&
        sequence.backgroundPages.slice(2).every((page) => page === 1),
      sequence.backgroundPages.join(','),
    );

    const secondSheet = await rasterise(sequence.pdf, directory, 2);
    const secondBand = pixel(secondSheet.data, secondSheet.info, secondSheet.info.width / 2, 24);
    check(
      'page two prints on the artwork too',
      near(secondBand, MAGENTA, 30),
      `rgb(${secondBand.r},${secondBand.g},${secondBand.b})`,
    );

    // ── a print without prices on artwork ────────────────────────────────
    const { redactQuotationPrices } = await import(
      '../dist/src/modules/sales/quotation-redaction.js'
    );
    const bareHtml = renderQuotationDocument(
      redactQuotationPrices(offerFixture(), { showSalePrice: false }),
      { logoData: null, logoMime: null },
      'ar',
      true,
      sheet,
    );
    check(
      'an offer printed without prices has no figures in the page it hands the printer',
      !/45,000\.00|51,300\.00|6,300\.00|1,250\.00/.test(bareHtml),
    );
    const barePdf = await pdfService.render(bareHtml, { fullBleed: true });
    const bareMerged = await mergeOfferOntoBackground({
      background: single,
      overlay: barePdf,
      settings: parseBackgroundSettings({ mode: 'REPEAT' }, 1),
      pageNumber: { y: 8, size: 8 },
    });
    const bareSheet = await rasterise(bareMerged.pdf, directory, 1);
    const bareBand = pixel(bareSheet.data, bareSheet.info, bareSheet.info.width / 2, 24);
    check(
      'the artwork is still the background of a price-free copy',
      near(bareBand, MAGENTA, 30),
      `rgb(${bareBand.r},${bareBand.g},${bareBand.b})`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
