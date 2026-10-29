// End-to-end tests for verify-quotation-pdf.mjs on real PDF files.
//
// A browser cannot run here, so the sheet is built with pdf-lib in the same
// shape Chromium writes one: A4 pages, a painted band, an image for the logo,
// a Type0 Arabic face with a ToUnicode table, and PDF-lib stamped page
// numbers. That is enough to prove the verifier reads a file - and to prove it
// still fails the two things it exists to catch: a missing design band and
// Arabic that was never joined.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { PDFArray, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';

const verifier = join(import.meta.dirname, 'verify-quotation-pdf.mjs');
const folder = mkdtempSync(join(tmpdir(), 'kayan-verify-pdf-'));
after(() => rmSync(folder, { recursive: true, force: true }));

/// The one-pixel PNG the Windows smoke test also uploads as a logo.
const LOGO =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABC0lEQVR4nO2asQ3CMBBFATFDWANqFqCBIViDFtZgCCoWoIY1YAoKN5Z9JLHvzM9J/3W2nOievxzbUubd/jzzzAJdgBYKoKEAGgqgoQCaZd712lzHP79+Hu2KqcF9AhRAQwE0FEAj7APmfLa7uNk97oYvbyuQlB53Wmm0EhBLzwfoNZqsgcHqK0b+4h9roIj37dQ/YHW4xE37BEonVRmC+8+osUDddGpCYAJoKIDGWKBuZ9Xsx0wgo3Q6lcchJiAxflL1p9FWh7lQWc8WO/X7QEDU8HQjC9hWnMBFjIYCaNwLTO5Sn9zZB3GfAAXQUAANBdBQAA0F0AhnIfj/G0W4T4ACaCiAhgJo3At8AQ4oMlkSCP3LAAAAAElFTkSuQmCC';

const cmap = (pairs) => `
/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${pairs.length} beginbfchar
${pairs.map(([code, unicode]) => `<${code}> <${unicode}>`).join('\n')}
endbfchar
endcmap
end
end
`;

/// A page as Chromium writes one: full-page background, the two bands, the
/// logo image, Arabic drawn with the bundled face, and a stamped "n / N".
async function sheet({ pages, arabic, band = true, drawn = '<00030004>' }) {
  const document = await PDFDocument.create();
  const helvetica = await document.embedFont(StandardFonts.Helvetica);
  const logo = await document.embedPng(Buffer.from(LOGO, 'base64'));

  const context = document.context;
  // ب in its isolated (0003) and initial (0004) shapes: what a shaping engine
  // produces for the same letter in two positions.
  const toUnicode = context.stream(cmap(arabic));
  const descendant = context.obj({
    Type: 'Font',
    Subtype: 'CIDFontType2',
    BaseFont: 'NotoNaskhArabic-Regular',
    CIDSystemInfo: { Registry: 'Adobe', Ordering: 'Identity', Supplement: 0 },
  });
  const naskh = context.obj({
    Type: 'Font',
    Subtype: 'Type0',
    BaseFont: 'NotoNaskhArabic-Regular',
    Encoding: 'Identity-H',
    DescendantFonts: [context.register(descendant)],
    ToUnicode: context.register(toUnicode),
  });
  const naskhReference = context.register(naskh);

  for (let index = 0; index < pages; index += 1) {
    const page = document.addPage([595.28, 841.89]);
    // Written as `re`, the operator Chromium uses for a painted band; pdf-lib's
    // own drawRectangle writes a path instead, which is not what this checks.
    page.node.set(
      PDFName.of('Contents'),
      document.context.register(document.context.stream('')),
    );
    if (band) {
      append(page, 'q 1 1 1 rg 0 0 595.28 841.89 re f Q');
      append(
        page,
        'q 0.05 0.2 0.4 rg 0 781 595.28 60 re f 0 0 595.28 70 re f Q',
      );
    }
    page.drawImage(logo, { x: 24, y: 786, width: 40, height: 40 });
    page.drawText('Quotation', { x: 80, y: 800, size: 12, font: helvetica });
    page.drawText(`${index + 1} / ${pages}`, {
      x: 280,
      y: 24,
      size: 9,
      font: helvetica,
    });

    // Arabic, through the Type0 face: the shape of every letter is the code.
    const fonts = page.node.Resources().lookup(PDFName.of('Font'));
    fonts.set(PDFName.of('F2'), naskhReference);
    append(page, `/F2 12 Tf 1 0 0 1 300 700 Tm ${drawn} Tj`);
  }

  const bytes = await document.save();
  const file = join(folder, `sheet-${pages}-${arabic.length}-${band ? 'band' : 'plain'}.pdf`);
  writeFileSync(file, bytes);
  return file;
}

/// Appends raw operators to a page's content, the way a producer would.
function append(page, operators) {
  const context = page.doc.context;
  const stream = context.register(context.stream(operators));
  const contents = page.node.Contents();
  if (contents instanceof PDFArray) {
    contents.push(stream);
  } else if (contents) {
    page.node.set(PDFName.of('Contents'), context.obj([contents, stream]));
  } else {
    page.node.set(PDFName.of('Contents'), stream);
  }
}

function run(file, ...args) {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [verifier, file, ...args], { encoding: 'utf8' }),
    };
  } catch (error) {
    return { status: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

const SHAPED = [
  ['0003', '0628'],
  ['0004', 'FE91'],
];

test('accepts a designed sheet and reports what it checked', async () => {
  const file = await sheet({ pages: 1, arabic: SHAPED });
  const result = run(file, '--min-pages', '1', '--max-pages', '2');
  assert.equal(result.status, 0, result.stderr ?? result.stdout);
  const summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(summary.pages, 1);
  assert.equal(summary.arabic.joined, true);
  assert.ok(summary.checks.includes('arabic-joined'));
  assert.ok(summary.checks.includes('naskh-drawn'));
});

test('a sheet that runs onto three pages passes a three-page minimum', async () => {
  const file = await sheet({ pages: 3, arabic: SHAPED });
  const result = run(file, '--min-pages', '3', '--max-pages', '4');
  assert.equal(result.status, 0, result.stderr ?? result.stdout);
  assert.match(result.stdout, /3 A4 page\(s\)/);
});

test('one page is rejected when the offer has to run onto three', async () => {
  const file = await sheet({ pages: 1, arabic: SHAPED });
  const result = run(file, '--min-pages', '3', '--max-pages', '4');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fewer than the 3/);
});

test('a sheet with no painted band is rejected as a missing background', async () => {
  const file = await sheet({ pages: 1, arabic: SHAPED, band: false });
  const result = run(file, '--min-pages', '1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no painted band/);
});

test('Arabic drawn with one shape per letter is rejected as unjoined', async () => {
  // Four letters, each always the same glyph: the letter-by-letter shape a
  // sheet without joining shows.
  const file = await sheet({
    pages: 1,
    arabic: [
      ['0003', '0628'],
      ['0004', '0645'],
      ['0005', '062D'],
      ['0006', '062F'],
    ],
    drawn: '<00030004000500060003000400050006>',
  });
  const result = run(file, '--min-pages', '1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not joined/);
});

test('a page range that cannot be met is refused before reading the file', async () => {
  const result = run(join(folder, 'missing.pdf'), '--min-pages', '5', '--max-pages', '2');
  assert.equal(result.status, 1);
});
