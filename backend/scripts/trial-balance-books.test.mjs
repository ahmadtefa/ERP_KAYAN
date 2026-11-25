import test from 'node:test';
import assert from 'node:assert/strict';
import { booksOf, balances } from './trial-balance-books.mjs';

const row = (id, debit, credit, closing) => ({ accountId: id, code: id, debit, credit, closing });
function fixture() {
  return { rows: [
    row('a', '1000.0000', '0.0000', '1000.0000'),
    row('b', '0.0000', '400.5000', '-400.5000'),
    row('c', '0.0000', '599.5000', '-599.5000'),
  ] };
}

test('a balanced ledger passes with exact figures', () => {
  const books = booksOf(fixture());
  assert.deepEqual(books, { debit: '1000.0000', credit: '1000.0000', difference: '0.0000', rows: 3 });
  assert.equal(balances(fixture()), true);
});
test('an unbalanced ledger fails', () => {
  const report = fixture();
  report.rows[1].credit = '400.0000';
  report.rows[1].closing = '-400.0000';
  assert.equal(balances(report), false);
  assert.equal(booksOf(report).difference, '0.5000');
});
test('a dropped row fails', () => {
  const report = fixture();
  report.rows.pop();
  assert.equal(balances(report), false);
});
test('a restored amount that changed by one cent is seen', () => {
  const before = booksOf(fixture());
  const report = fixture();
  report.rows[0].debit = '1000.0100';
  report.rows[0].closing = '1000.0100';
  const after = booksOf(report);
  assert.notEqual(after.debit, before.debit);
  assert.equal(balances(report), false);
});
test('a duplicated row is refused, not double counted', () => {
  const report = fixture();
  report.rows.push({ ...report.rows[0] });
  assert.throws(() => booksOf(report), /appears twice/);
});
test('float-sized differences are not hidden', () => {
  const report = { rows: [row('a', '0.1000', '0.0000', '0.1000'), row('b', '0.0000', '0.1000', '-0.1000'), row('c', '0.2000', '0.0000', '0.2000'), row('d', '0.0000', '0.2000', '-0.2000')] };
  assert.equal(balances(report), true);
  report.rows[3].credit = '0.2001';
  report.rows[3].closing = '-0.2001';
  assert.equal(balances(report), false);
});
test('a malformed or missing response is an error, never a pass', () => {
  assert.throws(() => booksOf({}), /no rows array/);
  assert.throws(() => booksOf({ rows: [row('a', undefined, '0.0000', '0.0000')] }), /not a four-decimal amount/);
  assert.throws(() => booksOf(null), /no rows array/);
});
