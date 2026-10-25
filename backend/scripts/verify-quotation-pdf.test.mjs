// Unit tests for the parts of the PDF verifier that read a file rather than
// draw one: the ToUnicode table, the text-showing operators and the rule that
// decides whether Arabic letters are joined.
//
// A real sheet cannot be produced here (no browser), so the rule itself is
// pinned with samples taken from what a shaped font does: one letter, several
// distinct glyphs for its head, middle and tail.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseToUnicode,
  shownStrings,
  summarizeForms,
} from './verify-quotation-pdf.mjs';

const BAA = '\u0628'; // ب joins on both sides
const MEEM = '\u0645'; // م joins on both sides

test('reads a glyph-to-Unicode table written with bfchar', () => {
  const table = parseToUnicode(`
    1 beginbfchar
    <0003> <0628>
    <0004> <FE91>
    endbfchar
  `);
  assert.equal(table.get(3), BAA);
  assert.equal(table.get(4), '\uFE91'); // ب in its initial form
});

test('reads a table written with bfrange, both forms', () => {
  const table = parseToUnicode(`
    2 beginbfrange
    <0010> <0012> <0645>
    <0020> <0021> [<0645> <0628>]
    endbfrange
  `);
  assert.equal(table.get(0x10), MEEM);
  assert.equal(table.get(0x12), '\u0647');
  assert.equal(table.get(0x20), MEEM);
  assert.equal(table.get(0x21), BAA);
});

test('ignores a broken range instead of inventing letters', () => {
  const table = parseToUnicode('<0010> <0002> <0645> endbfrange');
  assert.equal(table.size, 0);
});

test('pairs text-showing with the font that was selected', () => {
  const fonts = { F1: { name: 'Helvetica' }, F2: { name: 'NotoNaskhArabic-Regular', subtype: 'Type0' } };
  const shown = shownStrings(
    '/F2 11 Tf <00480069> Tj /F1 8 Tf <00310020002F00200032> Tj',
    (name) => fonts[name],
  );
  assert.equal(shown.length, 2);
  assert.equal(shown[0].font.name, 'NotoNaskhArabic-Regular');
  assert.deepEqual(shown[0].codes, [0x00, 0x48, 0x00, 0x69]);
  assert.equal(shown[1].font.name, 'Helvetica');
  assert.equal(shown[1].bits, 8);
});

test('reads strings inside a TJ array and ignores operators before any font', () => {
  const shown = shownStrings('q 1 0 0 1 0 0 cm <01> Tj /F1 9 Tf [(A) -20 <0048>] TJ', () => ({
    name: 'F',
  }));
  assert.equal(shown.length, 2);
  assert.deepEqual(
    shown.map((entry) => entry.codes),
    [[0x41], [0x00, 0x48]],
  );
});

test('two shapes for one letter is joined Arabic', () => {
  const summary = summarizeForms([
    { font: 'Naskh', unicode: BAA, code: 3 },
    { font: 'Naskh', unicode: BAA, code: 4 },
    { font: 'Naskh', unicode: MEEM, code: 9 },
  ]);
  assert.equal(summary.mapped, 3);
  assert.equal(summary.joinedLetters, 1);
  assert.equal(summary.joined, true);
});

test('presentation forms count as the same letter, so joining is still seen', () => {
  // A PDF may name the head of ب as U+FE91 rather than as U+0628.
  const summary = summarizeForms([
    { font: 'Naskh', unicode: '\uFE91', code: 4 },
    { font: 'Naskh', unicode: BAA, code: 3 },
  ]);
  assert.equal(summary.letters, 1);
  assert.equal(summary.joined, true);
});

test('one glyph per letter means the Arabic was not joined', () => {
  const summary = summarizeForms([
    { font: 'Naskh', unicode: BAA, code: 3 },
    { font: 'Naskh', unicode: BAA, code: 3 },
    { font: 'Naskh', unicode: MEEM, code: 9 },
    { font: 'Naskh', unicode: MEEM, code: 9 },
  ]);
  assert.equal(summary.joinedLetters, 0);
  assert.equal(summary.joined, false);
});

test('the same letter in two different faces is not mistaken for joining', () => {
  const summary = summarizeForms([
    { font: 'Naskh-Regular', unicode: BAA, code: 3 },
    { font: 'Naskh-Bold', unicode: BAA, code: 3 },
  ]);
  assert.equal(summary.joinedLetters, 0);
  assert.equal(summary.joined, false);
  assert.deepEqual(summary.fonts, ['Naskh-Regular', 'Naskh-Bold']);
});

test('non-Arabic text is not counted at all', () => {
  const summary = summarizeForms([
    { font: 'Naskh', unicode: 'A', code: 3 },
    { font: 'Naskh', unicode: '1', code: 4 },
  ]);
  assert.equal(summary.mapped, 2);
  assert.equal(summary.letters, 0);
  assert.equal(summary.joined, false);
});
