// Exact totals from the rows of a trial-balance response.
//
// The report's own `totals` block is withheld from logins that are not General
// or Finance Manager (company-aggregate-visibility), so a check run by the demo
// administrator derives them from the rows it may read. The service builds its
// own totals from the same rows: `rows` holds posting (postable) accounts only,
// never headings, and has no paging, so debit, credit and the net of the closing
// balances are the same sums the service would have reported. Amounts are four
// decimal strings; they are summed as integers (BigInt) so no float rounding can
// hide or invent a difference.
const SCALE = 4;

function units(value, label) {
  const text = String(value ?? '').trim();
  if (!/^-?\d+(\.\d{1,4})?$/.test(text)) {
    throw new Error(`${label} is not a four-decimal amount: ${JSON.stringify(value)}`);
  }
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const scaled = BigInt(whole) * 10n ** BigInt(SCALE) + BigInt(fraction.padEnd(SCALE, '0'));
  return negative ? -scaled : scaled;
}

function show(total) {
  const negative = total < 0n;
  const abs = negative ? -total : total;
  const whole = abs / 10n ** BigInt(SCALE);
  const fraction = String(abs % 10n ** BigInt(SCALE)).padStart(SCALE, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Returns exact `debit`, `credit`, `difference` (sum of closing balances) and the row count. */
export function booksOf(report) {
  if (!report || !Array.isArray(report.rows)) {
    throw new Error('the trial balance response has no rows array');
  }
  let debit = 0n;
  let credit = 0n;
  let closing = 0n;
  const seen = new Set();
  for (const row of report.rows) {
    if (row?.accountId) {
      if (seen.has(row.accountId)) throw new Error(`account ${row.code ?? row.accountId} appears twice in the trial balance`);
      seen.add(row.accountId);
    }
    debit += units(row?.debit, `debit of ${row?.code}`);
    credit += units(row?.credit, `credit of ${row?.code}`);
    closing += units(row?.closing, `closing of ${row?.code}`);
  }
  return { debit: show(debit), credit: show(credit), difference: show(closing), rows: report.rows.length };
}

export function balances(report) {
  const books = booksOf(report);
  return books.difference === show(0n) && books.debit === books.credit;
}
