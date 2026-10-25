#!/usr/bin/env node
/**
 * Checks a quotation PDF the way a person looking at the printed sheet would.
 *
 * The download route hands a page to the browser and gets a file back; a file
 * that opens is not the same thing as a file with the design on it. A printer
 * that drops the background image, a browser that never loaded the Arabic
 * font, a page whose number went missing - all three still produce a valid
 * PDF. So the installed runtime is asked to prove each of them, per page,
 * after the fact:
 *
 *   * the page is A4,
 *   * the page carries a painted band across its full width,
 *   * the company logo is drawn on it,
 *   * the bundled Naskh Arabic face is embedded in it,
 *   * exactly one "n / N" was stamped on it, and it is the right one,
 *   * nothing in the file points at the network.
 *
 * Usage: node verify-quotation-pdf.mjs <file.pdf> [--max-pages N]
 * Exit code 0 with a summary on stdout, 1 with the first failure on stderr.
 */
import { readFileSync } from 'node:fs';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';

const A4 = { width: 595.28, height: 841.89 };
const failures = [];

function fail(message) {
  failures.push(message);
}

/// Everything drawn on each page, decompressed.
function drawingPerPage(document) {
  const decoder = new TextDecoder('latin1');
  return document.getPages().map((page) => {
    const contents = page.node.Contents();
    if (!contents) return '';
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((reference) => document.context.lookup(reference))
        : [contents];
    return streams
      .map((stream) =>
        stream instanceof PDFRawStream
          ? decoder.decode(decodePDFRawStream(stream).decode())
          : '',
      )
      .join('\n');
  });
}

function dictionaryOf(object) {
  if (object instanceof PDFDict) return object;
  if (object instanceof PDFRawStream) return object.dict;
  return null;
}

/// The logo, either on the page itself or inside the form XObject that holds
/// the repeating design layer.
function paintsAnImage(document, index) {
  const visit = (resources, depth) => {
    const dictionary = dictionaryOf(resources);
    if (!dictionary || depth > 3) return false;
    const xobjects = dictionaryOf(dictionary.lookup(PDFName.of('XObject')));
    if (!xobjects) return false;
    for (const [, reference] of xobjects.entries()) {
      const object = dictionaryOf(document.context.lookup(reference));
      if (!object) continue;
      const subtype = object.get(PDFName.of('Subtype'))?.toString();
      if (subtype === '/Image') return true;
      if (subtype === '/Form' && visit(object.lookup(PDFName.of('Resources')), depth + 1)) {
        return true;
      }
    }
    return false;
  };
  return visit(document.getPage(index).node.Resources(), 0);
}

function fontsOnPage(document, index) {
  const resources = document.getPage(index).node.Resources();
  const fonts = dictionaryOf(resources?.lookup(PDFName.of('Font')));
  if (!fonts) return [];
  const names = [];
  for (const [, reference] of fonts.entries()) {
    const font = dictionaryOf(document.context.lookup(reference));
    if (font) names.push(font.get(PDFName.of('BaseFont'))?.toString() ?? '');
  }
  return names;
}

async function main() {
  const file = process.argv[2];
  const maxArgument = process.argv.indexOf('--max-pages');
  const maxPages = maxArgument > 0 ? Number(process.argv[maxArgument + 1]) : Number.POSITIVE_INFINITY;
  if (!file) {
    console.error('usage: node verify-quotation-pdf.mjs <file.pdf> [--max-pages N]');
    process.exit(1);
  }

  const bytes = readFileSync(file);
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    console.error('not a PDF: the file does not start with %PDF-');
    process.exit(1);
  }

  const document = await PDFDocument.load(bytes);
  const pages = document.getPageCount();
  if (pages < 1) fail('the document has no pages');
  if (pages > maxPages) fail(`${pages} pages, more than the ${maxPages} expected for this offer`);

  const drawing = drawingPerPage(document);
  drawing.forEach((page, index) => {
    const { width, height } = document.getPage(index).getSize();
    if (Math.abs(width - A4.width) > 1 || Math.abs(height - A4.height) > 1) {
      fail(`page ${index + 1} is ${width.toFixed(1)}x${height.toFixed(1)} pt, not A4`);
    }
    const bands = [...page.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g)].filter(
      (match) => Number(match[3]) > 560 && Number(match[4]) > 55,
    );
    if (bands.length === 0) fail(`page ${index + 1} has no painted band: the background did not print`);
    if (!paintsAnImage(document, index)) fail(`page ${index + 1} does not draw the company logo`);
    const fonts = fontsOnPage(document, index).join(' ');
    if (!/NotoNaskhArabic/.test(fonts)) {
      fail(`page ${index + 1} does not embed the bundled Arabic face`);
    }
    if (!/Helvetica/.test(fonts)) fail(`page ${index + 1} carries no stamped page number`);
    const labels = [...page.matchAll(/<([0-9A-F]+)> Tj/g)]
      .map((match) => Buffer.from(match[1], 'hex').toString('latin1'))
      .filter((label) => /^\d+ \/ \d+$/.test(label));
    if (labels.length !== 1 || labels[0] !== `${index + 1} / ${pages}`) {
      fail(
        `page ${index + 1} is numbered ${labels.join(', ') || 'nothing'}, expected '${index + 1} / ${pages}'`,
      );
    }
  });

  const raw = bytes.toString('latin1');
  if (/\/URI/.test(raw)) fail('the file contains a link annotation: something points at the network');
  if (/https?:\/\//.test(raw)) fail('the file contains a URL: something reached for the internet');

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAILED: ${failure}`);
    process.exit(1);
  }

  console.log(
    `::notice::Quotation PDF verified: ${bytes.length} bytes, ${pages} A4 page(s), ` +
      'a painted band, the logo, the bundled Naskh Arabic face and the right page number on every page, ' +
      'and no reference to the network.',
  );
  console.log(
    JSON.stringify({
      file,
      bytes: bytes.length,
      pages,
      checks: ['a4', 'painted-band', 'logo', 'naskh-font', 'page-number', 'offline'],
    }),
  );
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
