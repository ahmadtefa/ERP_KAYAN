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
 *   * the bundled Naskh Arabic face is embedded in it AND selected to draw
 *     text on it (a font listed in the resources but never used proves nothing),
 *   * the Arabic on it is joined: the letters carry their contextual forms
 *     (a head, a middle, a tail), not one isolated shape per letter,
 *   * exactly one "n / N" was stamped on it, and it is the right one,
 *   * nothing in the file points at the network.
 *
 * Usage: node verify-quotation-pdf.mjs <file.pdf> [--min-pages N] [--max-pages N]
 * Exit code 0 with a summary on stdout, 1 with the first failure on stderr.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';

const A4 = { width: 595.28, height: 841.89 };
/// Arabic letters live here, and nowhere else that matters to this check.
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/// Every stream drawn on a page: the page's own content, plus the form
/// XObjects it paints (a repeating background may live in one of those).
function pageLayers(document, index) {
  const page = document.getPage(index);
  const resources = page.node.Resources();
  const decoder = new TextDecoder('latin1');
  const decode = (stream) => decoder.decode(decodePDFRawStream(stream).decode());
  const layers = [];
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((reference) => document.context.lookup(reference))
      : [contents];
  for (const stream of streams) {
    if (stream instanceof PDFRawStream) layers.push({ text: decode(stream), resources });
  }
  const visit = (holder, depth) => {
    const dictionary = dictionaryOf(holder);
    if (!dictionary || depth > 3) return;
    const xobjects = dictionaryOf(dictionary.lookup(PDFName.of('XObject')));
    if (!xobjects) return;
    for (const [, reference] of xobjects.entries()) {
      const stream = document.context.lookup(reference);
      const object = dictionaryOf(stream);
      if (!object) continue;
      const subtype = object.get(PDFName.of('Subtype'))?.toString();
      if (subtype !== '/Form') continue;
      const formResources = object.lookup(PDFName.of('Resources')) ?? holder;
      if (stream instanceof PDFRawStream) {
        layers.push({ text: decode(stream), resources: formResources });
      }
      visit(formResources, depth + 1);
    }
  };
  visit(resources, 0);
  return layers;
}

function drawingPerPage(document) {
  return document.getPages().map((_, index) =>
    pageLayers(document, index)
      .map((layer) => layer.text)
      .join('\n'),
  );
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

function baseFontOf(font) {
  return font.get(PDFName.of('BaseFont'))?.toString() ?? '';
}

/// Fonts on the page, whether they are listed in the page's resources or in a
/// form's own resources.
function fontsOnPage(document, index) {
  const names = new Set();
  for (const layer of pageLayers(document, index)) {
    const fonts = dictionaryOf(dictionaryOf(layer.resources)?.lookup(PDFName.of('Font')));
    if (!fonts) continue;
    for (const [, reference] of fonts.entries()) {
      const font = dictionaryOf(document.context.lookup(reference));
      if (font) names.add(baseFontOf(font));
    }
  }
  return [...names];
}

/// Which fonts a content stream actually selects with `Tf`, in draw order.
/// An entry is `{ name, font }`, where `font` is the font dictionary resolved
/// in the resources of the stream the operator appears in.
function selectedFonts(layer) {
  const fonts = dictionaryOf(dictionaryOf(layer.resources)?.lookup(PDFName.of('Font')));
  const selected = [];
  for (const match of layer.text.matchAll(/\/([^\s/\[\]()<>{}]+)\s+[-\d.]+\s+Tf/g)) {
    const name = match[1];
    const font = fonts ? dictionaryOf(fonts.lookup(PDFName.of(name))) : null;
    if (font) selected.push({ name, font });
  }
  return selected;
}

/// A page that carries Arabic has to draw it with the bundled face; a font
/// sitting unused in the resources is exactly what a fallback looks like.
function drawsWithNaskh(document, index) {
  return pageLayers(document, index).some((layer) =>
    selectedFonts(layer).some(({ font }) => /NotoNaskhArabic/.test(baseFontOf(font))),
  );
}

function hexToBytes(text) {
  const clean = text.replace(/[^0-9A-Fa-f]/g, '');
  return clean.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? [];
}

/// A UTF-16BE string as written in a CMap: a destination is code units, not
/// bytes to be read one at a time.
function utf16be(text) {
  const clean = text.replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  for (let index = 0; index + 4 <= clean.length; index += 4) {
    out += String.fromCharCode(parseInt(clean.slice(index, index + 4), 16));
  }
  return out;
}

/// The glyph-code -> Unicode table a PDF carries for a subset font. Without
/// it the file still prints, but nothing can say which letters it drew.
export function parseToUnicode(text) {
  const map = new Map();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]*)>/g)) {
      const code = parseInt(pair[1].replace(/\s+/g, ''), 16);
      if (Number.isFinite(code)) map.set(code, utf16be(pair[2]));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(
      /<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>/g,
    )) {
      const first = parseInt(range[1].replace(/\s+/g, ''), 16);
      const last = parseInt(range[2].replace(/\s+/g, ''), 16);
      const target = parseInt(range[3].replace(/\s+/g, ''), 16);
      if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) continue;
      for (let code = first; code <= last; code += 1) {
        map.set(code, String.fromCharCode(target + (code - first)));
      }
    }
    for (const range of block[1].matchAll(
      /<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*\[([\s\S]*?)\]/g,
    )) {
      const first = parseInt(range[1].replace(/\s+/g, ''), 16);
      if (!Number.isFinite(first)) continue;
      [...range[3].matchAll(/<([0-9A-Fa-f\s]*)>/g)].forEach((item, offset) => {
        map.set(first + offset, utf16be(item[1]));
      });
    }
  }
  return map;
}

function toUnicodeOf(document, font) {
  const reference = font.lookup(PDFName.of('ToUnicode'));
  const stream = reference ? document.context.lookup(reference) : null;
  if (!(stream instanceof PDFRawStream)) return null;
  try {
    return parseToUnicode(new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()));
  } catch {
    return null;
  }
}

/// Every string shown by a piece of content, paired with the font selected
/// when it was shown. Hex strings are glyph codes; a Type0 (CID) font uses two
/// bytes per glyph, a simple font one.
export function shownStrings(text, fontsFor) {
  const shown = [];
  let current = null;
  const operator = /\/([^\s/\[\]()<>{}]+)\s+[-\d.]+\s+Tf|<([0-9A-Fa-f\s]+)>\s*Tj|\(((?:\\.|[^()\\])*)\)\s*Tj|\[((?:\\.|[^\[\]\\])*)\]\s*TJ/g;
  for (const match of text.matchAll(operator)) {
    if (match[1]) {
      current = fontsFor(match[1]);
      continue;
    }
    if (!current) continue;
    if (match[2] !== undefined) {
      shown.push({ font: current, codes: hexToBytes(match[2]), bits: codeWidth(current) });
    } else if (match[3] !== undefined) {
      shown.push({ font: current, codes: latin1Bytes(match[3]), bits: 8 });
    } else if (match[4] !== undefined) {
      // In the order they are written: a TJ array mixes hex and literal
      // strings, and their order is the order the letters are drawn in.
      for (const item of match[4].matchAll(/<([0-9A-Fa-f\s]+)>|\(((?:\\.|[^()\\])*)\)/g)) {
        if (item[1] !== undefined) {
          shown.push({ font: current, codes: hexToBytes(item[1]), bits: codeWidth(current) });
        } else {
          shown.push({ font: current, codes: latin1Bytes(item[2]), bits: 8 });
        }
      }
    }
  }
  return shown;
}

/// Type0 (composite) fonts address glyphs with two bytes; simple fonts with one.
function codeWidth(font) {
  if (!font) return 8;
  const subtype =
    typeof font.get === 'function'
      ? font.get(PDFName.of('Subtype'))?.toString()
      : font.subtype;
  return subtype === '/Type0' || subtype === 'Type0' ? 16 : 8;
}

function latin1Bytes(text) {
  const escaped = text.replace(/\\([nrtbf()\\])/g, (whole, letter) =>
    letter === 'n' ? '\n' : letter === 'r' ? '\r' : letter === 't' ? '\t' : letter,
  );
  return [...escaped].map((character) => character.charCodeAt(0) & 0xff);
}

function codesOf(entry) {
  const step = entry.bits / 8;
  const codes = [];
  for (let index = 0; index + step <= entry.codes.length; index += step) {
    let code = 0;
    for (let offset = 0; offset < step; offset += 1) code = (code << 8) | entry.codes[index + offset];
    codes.push(code);
  }
  return codes;
}

/// Whether the Arabic in the file is written in joined (contextual) forms.
///
/// A shaping engine turns one letter into different glyphs depending on where
/// it sits in the word, so a properly joined sheet shows the same letter as
/// several distinct glyphs. A sheet where every occurrence of a letter is the
/// same glyph was not joined - it was laid out letter by letter. Presentation
/// forms are folded back to their base letters first, because a PDF may name
/// either.
export function arabicForms(document, layers) {
  const samples = [];
  let unmapped = 0;
  for (const layer of layers) {
    for (const entry of shownStrings(layer.text, (name) => {
      const fonts = dictionaryOf(dictionaryOf(layer.resources)?.lookup(PDFName.of('Font')));
      return fonts ? dictionaryOf(fonts.lookup(PDFName.of(name))) : null;
    })) {
      const font = entry.font;
      if (!font || !/NotoNaskhArabic/.test(baseFontOf(font))) continue;
      const cmap = toUnicodeOf(document, font);
      if (!cmap) {
        unmapped += 1;
        continue;
      }
      const key = baseFontOf(font);
      for (const code of codesOf(entry)) {
        const unicode = cmap.get(code);
        if (!unicode) continue;
        const base = unicode.normalize('NFKC');
        if (!base || !ARABIC.test(base)) continue;
        samples.push({ font: key, unicode: base, code });
      }
    }
  }
  return summarizeForms(samples, unmapped);
}

/// Groups drawn Arabic by letter and says whether any letter ever takes more
/// than one shape. Kept separate from pdf-lib so the rule itself can be
/// tested with plain samples.
export function summarizeForms(samples, unmapped = 0) {
  const perFont = new Map();
  let mapped = 0;
  for (const sample of samples) {
    if (!perFont.has(sample.font)) perFont.set(sample.font, new Map());
    const forms = perFont.get(sample.font);
    mapped += 1;
    for (const character of String(sample.unicode).normalize('NFKC')) {
      if (!ARABIC.test(character)) continue;
      if (!forms.has(character)) forms.set(character, new Set());
      forms.get(character).add(sample.code);
    }
  }
  const letters = new Map();
  for (const forms of perFont.values()) {
    for (const [character, codes] of forms) {
      if (!letters.has(character)) letters.set(character, new Set());
      for (const code of codes) letters.get(character).add(code);
    }
  }
  const joined = [...letters.values()].filter((codes) => codes.size >= 2);
  return {
    fonts: [...perFont.keys()],
    mapped,
    unmapped,
    letters: letters.size,
    joinedLetters: joined.length,
    /// True only when the file shows real joined shapes. A file with no
    /// ToUnicode table cannot be judged and is reported as such, not as good.
    joined: joined.length > 0,
  };
}

async function main() {
  const file = process.argv[2];
  const maxArgument = process.argv.indexOf('--max-pages');
  const minArgument = process.argv.indexOf('--min-pages');
  const maxPages = maxArgument > 0 ? Number(process.argv[maxArgument + 1]) : Number.POSITIVE_INFINITY;
  const minPages = minArgument > 0 ? Number(process.argv[minArgument + 1]) : 1;
  if (!file) {
    console.error('usage: node verify-quotation-pdf.mjs <file.pdf> [--min-pages N] [--max-pages N]');
    process.exit(1);
  }
  if (!Number.isFinite(minPages) || minPages < 1 || minPages > maxPages) {
    console.error(`invalid page range: at least ${minPages}, at most ${maxPages}`);
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
  if (pages < minPages) {
    fail(`${pages} pages, fewer than the ${minPages} this offer has to run onto`);
  }

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
    } else if (!drawsWithNaskh(document, index)) {
      fail(`page ${index + 1} never draws with the bundled Arabic face: the Arabic fell back`);
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

  // The page numbers are stamped with a standard font, so they are found above
  // by their Latin digits. Arabic itself is checked separately: the letters
  // have to be there, and they have to be joined.
  const layers = document.getPages().flatMap((_, index) => pageLayers(document, index));
  const forms = arabicForms(document, layers);
  if (forms.mapped === 0 && forms.unmapped === 0) {
    // An English-only sheet is not a defect. The caller that needs Arabic
    // (the Windows smoke test) asks for it explicitly.
    note('the file draws no Arabic text, so joining is not applicable');
  } else if (forms.mapped === 0) {
    note('Arabic shaping not asserted: the file carries no readable ToUnicode table');
  } else if (!forms.joined && forms.letters >= 4) {
    fail(
      `the Arabic is not joined: ${forms.mapped} letters in ${forms.fonts.join(', ') || 'no font'} ` +
        'but no letter ever takes more than one shape',
    );
  } else if (!forms.joined) {
    // Too little Arabic to tell a letter's head from its tail; saying "joined"
    // here would be a guess, so it is reported as unjudged.
    note(`Arabic shaping not judged: only ${forms.letters} distinct letter(s) in the file`);
  }

  const raw = bytes.toString('latin1');
  if (/\/URI/.test(raw)) fail('the file contains a link annotation: something points at the network');
  if (/https?:\/\//.test(raw)) fail('the file contains a URL: something reached for the internet');

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAILED: ${failure}`);
    process.exit(1);
  }

  const shape =
    forms.mapped > 0
      ? `${forms.mapped} Arabic letters in ${forms.joinedLetters} joined shapes`
      : 'Arabic shaping not asserted';
  console.log(
    `::notice::Quotation PDF verified: ${bytes.length} bytes, ${pages} A4 page(s), ` +
      'a painted band, the logo, the bundled Naskh Arabic face and the right page number on every page, ' +
      `${shape}, and no reference to the network.`,
  );
  for (const message of notes) console.log(`::notice::${message}`);
  console.log(
    JSON.stringify({
      file,
      bytes: bytes.length,
      pages,
      checks: [
        'a4',
        'painted-band',
        'logo',
        'naskh-font',
        'naskh-drawn',
        'arabic-joined',
        'page-number',
        'offline',
        'page-range',
      ],
      minPages,
      maxPages: Number.isFinite(maxPages) ? maxPages : null,
      arabic: {
        mapped: forms.mapped,
        unmapped: forms.unmapped,
        letters: forms.letters,
        joinedLetters: forms.joinedLetters,
        joined: forms.joined,
      },
    }),
  );
}

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function note(message) {
  notes.push(message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAILED: ${error.message}`);
    process.exit(1);
  });
}
