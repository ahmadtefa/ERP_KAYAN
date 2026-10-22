#!/usr/bin/env node
/**
 * The reconciliation scenario: a small, fully hand-computed accounting
 * year whose every number is known in advance, closed at the end.
 *
 *   node backend/scripts/scenario-accounting-reconciliation.mjs [apiBaseUrl]
 *
 * `scenario-accounting.mjs` walks a trading day and checks each posting.
 * This one checks that the statements agree with each other and with
 * the ledger — the reconciliations an accountant actually signs:
 *
 *   1. an unbalanced entry is refused; a balanced one posts exactly once
 *   2. known 2024 movements: revenue 1,000, rent 300, capital 5,000
 *   3. trial balance balances (difference 0); the account ledger's
 *      closing equals the trial balance's closing, account by account
 *   4. the statement of changes in equity explains the movement and its
 *      closing total equals the balance sheet's equity
 *   5. the cash-flow statement's opening + net = closing, and its
 *      closing equals the cash ledger; counterpart lines carry their
 *      own amounts (revenue 1,000 in; rent 300 out; capital 5,000 in)
 *   6. receivables subledger total equals the AR control account;
 *      inventory valuation equals the inventory account
 *   7. year-end close transfers the 700 result to retained earnings,
 *      zeroes revenue/expense, and the next year opens on the closing
 *      balances of the year before
 *   8. nothing more can be posted into the closed year
 *   9. a posted entry can still be reversed — into the open present,
 *      not into the closed past — leaving both entries on the record
 *
 * The work happens in 2024, a year no other script touches, so the
 * numbers are absolute rather than deltas against an unknown history,
 * and closing that year cannot disturb the scripts that run after.
 */
const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';

const results = [];
let token = '';
const stamp = String(Date.now()).slice(-6);
const YEAR_FROM = '2024-01-01';
const YEAR_TO = '2024-12-31';
const today = new Date().toISOString().slice(0, 10);

const money = (value) => Number(Number(value ?? 0).toFixed(4));
const near = (a, b, tolerance = 0.005) => Math.abs(money(a) - money(b)) <= tolerance;

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (token && !options.noAuth) headers.Authorization = `Bearer ${token}`;
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${API}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
    const contentType = response.headers.get('content-type') ?? '';
    const data = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();
    if (response.status !== 429 || attempt >= 6) {
      return { status: response.status, data };
    }
    // The script before this one deliberately trips the login limiter;
    // wait out whatever window it names instead of failing on it.
    const wait = Number(/(\d+)\s*second/.exec(String(data?.detail ?? ''))?.[1] ?? 5) + 1;
    await sleep(Math.min(wait, 90) * 1000);
  }
}

async function must(label, path, options) {
  const response = await api(path, options);
  if (response.status >= 200 && response.status < 300) return response.data;
  check(label, false, `${response.status} ${JSON.stringify(response.data)?.slice(0, 240)}`);
  return null;
}

async function mustRefuse(label, path, options) {
  const response = await api(path, options);
  check(
    label,
    response.status >= 400 && response.status < 500,
    `status ${response.status} ${JSON.stringify(response.data)?.slice(0, 160)}`,
  );
  return response;
}

let chart = [];
const code = (c) => chart.find((row) => row.code === c)?.id;

async function trialBalance(fromDate, toDate) {
  const response = await api(`/reports/trial-balance?from=${fromDate}&to=${toDate}`);
  return response.data;
}
const rowOf = (trial, c) => (trial?.rows ?? []).find((r) => r.code === c);
const closingOf = (trial, c) => money(rowOf(trial, c)?.closing ?? 0);
const openingOf = (trial, c) => money(rowOf(trial, c)?.opening ?? 0);

async function postManualEntry(label, entryDate, lines) {
  const entry = await must(label, '/accounting/journal-entries', {
    method: 'POST',
    json: { entryDate, description: `${label} ${stamp}`, lines },
  });
  if (!entry) return null;
  await api(`/accounting/journal-entries/${entry.id}/submit`, { method: 'POST' });
  await must(`${label} — approved`, `/accounting/journal-entries/${entry.id}/approve`, { method: 'POST' });
  const posted = await must(`${label} — posted`, `/accounting/journal-entries/${entry.id}/post`, { method: 'POST' });
  return posted ?? entry;
}

async function main() {
  console.log(`Reconciliation scenario against ${API}\n`);

  const login = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  token = login.data?.accessToken ?? '';
  check('sign in as the administrator', login.status < 300 && Boolean(token), `status ${login.status}`);
  if (!token) return false;

  const chartResponse = await api('/accounting/chart-of-accounts');
  chart = chartResponse.data?.items ?? [];
  for (const needed of ['1101', '1103', '1104', '3101', '3102', '4101', '5103']) {
    if (!code(needed)) {
      check(`the chart of accounts contains account ${needed}`, false, 'missing: is the database seeded?');
      return false;
    }
  }

  // A cash box of our own, on its own ledger account, so the cash-flow
  // figures below are exactly this scenario's and nobody else's.
  const cashLedger = await must('add a cash account to the chart', '/accounting/chart-of-accounts', {
    method: 'POST',
    json: {
      code: `1101.REC${stamp}`,
      nameEn: `Reconciliation cash ${stamp}`,
      nameAr: `نقدية التسوية ${stamp}`,
      type: 'ASSET',
      parentId: code('1101'),
      isPostable: true,
    },
  });
  if (!cashLedger) return false;
  const cashCode = `1101.REC${stamp}`;
  await must('open a cash box on the new account', '/cash/accounts', {
    method: 'POST',
    json: {
      code: `RECBOX-${stamp}`,
      nameEn: `Reconciliation cash box ${stamp}`,
      nameAr: `خزينة التسوية ${stamp}`,
      kind: 'CASH',
      accountId: cashLedger.id,
    },
  });

  const period = await must('open the 2024 fiscal year', '/accounting/fiscal-periods', {
    method: 'POST',
    json: {
      code: `REC-${stamp}`,
      nameEn: `Reconciliation year ${stamp}`,
      nameAr: `سنة التسوية ${stamp}`,
      startDate: YEAR_FROM,
      endDate: YEAR_TO,
    },
  });
  if (!period) return false;

  // The year starts empty: nothing in this database predates it that
  // any earlier script wrote, and this script writes nothing earlier.
  const emptyTrial = await trialBalance(YEAR_FROM, YEAR_TO);
  const baselineEquity = (await api(`/reports/equity-changes?from=${YEAR_FROM}&to=${YEAR_TO}`)).data;
  check(
    'the reconciliation year opens empty',
    near(closingOf(emptyTrial, cashCode), 0) && near(baselineEquity?.totals?.closing ?? -1, 0),
    `cash ${closingOf(emptyTrial, cashCode)}, equity ${baselineEquity?.totals?.closing}`,
  );

  // ── 1. balance is not optional; posting is not repeatable ──────────────
  await mustRefuse('an unbalanced entry is refused (100 against 90)', '/accounting/journal-entries', {
    method: 'POST',
    json: {
      entryDate: '2024-02-01',
      description: `Unbalanced ${stamp}`,
      lines: [
        { accountId: cashLedger.id, debit: '100' },
        { accountId: code('4101'), credit: '90' },
      ],
    },
  });

  // ── 2. the year's whole story, three entries ───────────────────────────
  const revenue = await postManualEntry('collect revenue in cash', '2024-02-01', [
    { accountId: cashLedger.id, debit: '1000' },
    { accountId: code('4101'), credit: '1000' },
  ]);
  const rent = await postManualEntry('pay the rent', '2024-03-01', [
    { accountId: code('5103'), debit: '300' },
    { accountId: cashLedger.id, credit: '300' },
  ]);
  await postManualEntry('the owner puts capital in', '2024-04-01', [
    { accountId: cashLedger.id, debit: '5000' },
    { accountId: code('3101'), credit: '5000' },
  ]);
  if (!revenue || !rent) return false;

  await mustRefuse(
    'posting the same entry a second time is refused',
    `/accounting/journal-entries/${revenue.id}/post`,
    { method: 'POST' },
  );

  // ── 3. ledger and trial balance agree ──────────────────────────────────
  const trial = await trialBalance(YEAR_FROM, YEAR_TO);
  check(
    'the trial balance balances',
    near(trial?.totals?.difference, 0),
    `difference ${trial?.totals?.difference}`,
  );
  check(
    'the trial balance carries the known figures',
    near(closingOf(trial, cashCode), 5700) &&
      near(closingOf(trial, '4101'), -1000) &&
      near(closingOf(trial, '5103'), 300) &&
      near(closingOf(trial, '3101'), -5000),
    `cash ${closingOf(trial, cashCode)}, revenue ${closingOf(trial, '4101')}, rent ${closingOf(trial, '5103')}, capital ${closingOf(trial, '3101')}`,
  );
  for (const [label, c] of [['cash', cashCode], ['revenue', '4101'], ['capital', '3101']]) {
    const ledger = await api(`/reports/account-ledger/${code(c)}?from=${YEAR_FROM}&to=${YEAR_TO}`);
    check(
      `the ${label} ledger closing equals its trial-balance closing`,
      ledger.status === 200 && near(ledger.data?.closing, closingOf(trial, c)),
      `ledger ${ledger.data?.closing}, trial balance ${closingOf(trial, c)}`,
    );
  }

  // ── 4. the equity statement explains the year and ties out ─────────────
  const equity = (await api(`/reports/equity-changes?from=${YEAR_FROM}&to=${YEAR_TO}`)).data;
  const balanceSheet = (await api(`/reports/balance-sheet?asOf=${YEAR_TO}`)).data;
  check(
    'changes in equity: opening 0 + result 700 + capital 5,000 = closing 5,700',
    near(equity?.totals?.opening, 0) &&
      near(equity?.totals?.resultForPeriod, 700) &&
      near(equity?.totals?.otherMovements, 5000) &&
      near(equity?.totals?.closing, 5700) &&
      near(equity?.totals?.difference, 0),
    `opening ${equity?.totals?.opening}, result ${equity?.totals?.resultForPeriod}, other ${equity?.totals?.otherMovements}, closing ${equity?.totals?.closing}, difference ${equity?.totals?.difference}`,
  );
  check(
    'equity closing equals the balance sheet equity at the same date',
    near(equity?.totals?.closing, balanceSheet?.totals?.equity),
    `statement ${equity?.totals?.closing}, balance sheet ${balanceSheet?.totals?.equity}`,
  );
  check(
    'the balance sheet itself balances at year end',
    near(balanceSheet?.totals?.difference, 0) && balanceSheet?.isBalanced === true,
    `difference ${balanceSheet?.totals?.difference}`,
  );

  // ── 5. cash flow reconciles to the cash ledger ─────────────────────────
  const cashFlow = (await api(`/reports/cash-flow?from=${YEAR_FROM}&to=${YEAR_TO}`)).data;
  const mine = (cashFlow?.cashBalances ?? []).find((row) => row.code === cashCode);
  check(
    'cash flow: opening 0 + in 6,000 - out 300 = closing 5,700 on the new box',
    near(mine?.opening, 0) && near(mine?.inflow, 6000) && near(mine?.outflow, 300) && near(mine?.closing, 5700),
    `opening ${mine?.opening}, in ${mine?.inflow}, out ${mine?.outflow}, closing ${mine?.closing}`,
  );
  check(
    'cash-flow closing equals the cash ledger balance',
    near(mine?.closing, closingOf(trial, cashCode)),
    `statement ${mine?.closing}, ledger ${closingOf(trial, cashCode)}`,
  );
  const inflowOf = (c) => money((cashFlow?.inflows ?? []).find((r) => r.code === c)?.movement ?? 0);
  const outflowOf = (c) => money((cashFlow?.outflows ?? []).find((r) => r.code === c)?.movement ?? 0);
  check(
    'each counterpart line carries its own amount',
    near(inflowOf('4101'), 1000) && near(inflowOf('3101'), 5000) && near(outflowOf('5103'), 300),
    `revenue in ${inflowOf('4101')}, capital in ${inflowOf('3101')}, rent out ${outflowOf('5103')}`,
  );

  // ── 6. subledgers against their control accounts (today) ───────────────
  const trialToday = await trialBalance(`${today.slice(0, 4)}-01-01`, today);
  const customers = (await api(`/reports/customer-balances?asOf=${today}`)).data;
  const subledgerTotal = (customers?.rows ?? []).reduce((sum, r) => sum + money(r.balance), 0);
  check(
    'receivables subledger equals the AR control account',
    near(subledgerTotal, closingOf(trialToday, '1103')),
    `subledger ${subledgerTotal}, control ${closingOf(trialToday, '1103')}, difference ${money(subledgerTotal - closingOf(trialToday, '1103'))}`,
  );
  const valuation = (await api('/inventory/reports/valuation')).data;
  check(
    'inventory valuation equals the inventory account',
    near(valuation?.totals?.difference, 0) && near(valuation?.totals?.value, closingOf(trialToday, '1104')),
    `valuation ${valuation?.totals?.value}, ledger ${closingOf(trialToday, '1104')}, reported difference ${valuation?.totals?.difference}`,
  );

  // ── 7. close the year; the next year opens on its balances ─────────────
  const preview = await api(`/accounting/fiscal-periods/${period.id}/closing-preview`);
  check(
    'the closing preview has no blockers',
    preview.status === 200 && (preview.data?.blockers ?? []).length === 0,
    `blockers ${JSON.stringify(preview.data?.blockers ?? [])}`,
  );
  const closed = await must('close the 2024 year', `/accounting/fiscal-periods/${period.id}/close-year`, {
    method: 'POST',
    json: { reason: `Reconciliation scenario ${stamp}` },
  });
  if (!closed) return false;

  const afterClose = await trialBalance(YEAR_FROM, YEAR_TO);
  check(
    'closing zeroes revenue and expense and lands 700 in retained earnings',
    near(closingOf(afterClose, '4101'), 0) &&
      near(closingOf(afterClose, '5103'), 0) &&
      near(closingOf(afterClose, '3102'), -700) &&
      near(closingOf(afterClose, cashCode), 5700) &&
      near(afterClose?.totals?.difference, 0),
    `revenue ${closingOf(afterClose, '4101')}, rent ${closingOf(afterClose, '5103')}, retained ${closingOf(afterClose, '3102')}, cash ${closingOf(afterClose, cashCode)}`,
  );
  const equityAfter = (await api(`/reports/equity-changes?from=${YEAR_FROM}&to=${YEAR_TO}`)).data;
  check(
    'after closing, the equity statement shows the 700 as transferred, once',
    near(equityAfter?.result?.transferredToEquity, 700) &&
      near(equityAfter?.result?.forPeriod, 700) &&
      near(equityAfter?.result?.closingUnclosed, 0) &&
      near(equityAfter?.totals?.closing, 5700) &&
      near(equityAfter?.totals?.difference, 0),
    `transferred ${equityAfter?.result?.transferredToEquity}, period ${equityAfter?.result?.forPeriod}, unclosed ${equityAfter?.result?.closingUnclosed}, closing ${equityAfter?.totals?.closing}`,
  );
  const nextYear = await trialBalance('2025-01-01', '2025-01-31');
  check(
    '2025 opens on the 2024 closing balances',
    near(openingOf(nextYear, cashCode), 5700) &&
      near(openingOf(nextYear, '3102'), -700) &&
      near(openingOf(nextYear, '4101'), 0),
    `cash opening ${openingOf(nextYear, cashCode)}, retained ${openingOf(nextYear, '3102')}, revenue ${openingOf(nextYear, '4101')}`,
  );

  // ── 8. the closed year is closed ───────────────────────────────────────
  const lateEntry = await must('draft an entry dated inside the closed year', '/accounting/journal-entries', {
    method: 'POST',
    json: {
      entryDate: '2024-05-01',
      description: `Too late ${stamp}`,
      lines: [
        { accountId: cashLedger.id, debit: '10' },
        { accountId: code('4101'), credit: '10' },
      ],
    },
  });
  if (lateEntry) {
    await api(`/accounting/journal-entries/${lateEntry.id}/submit`, { method: 'POST' });
    await api(`/accounting/journal-entries/${lateEntry.id}/approve`, { method: 'POST' });
    await mustRefuse(
      'posting into the closed year is refused',
      `/accounting/journal-entries/${lateEntry.id}/post`,
      { method: 'POST' },
    );
  }

  // ── 9. reversal happens in the open present, on the record ─────────────
  const reversal = await must('reverse the rent entry', `/accounting/journal-entries/${rent.id}/reverse`, {
    method: 'POST',
  });
  const originalAfter = await api(`/accounting/journal-entries/${rent.id}`);
  check(
    'the original is marked reversed and the mirror entry exists',
    Boolean(reversal) && String(originalAfter.data?.status).toUpperCase() === 'REVERSED',
    `original status ${originalAfter.data?.status}`,
  );
  const stillClosed = await trialBalance(YEAR_FROM, YEAR_TO);
  check(
    'the reversal did not rewrite the closed year',
    near(closingOf(stillClosed, '3102'), -700) && near(closingOf(stillClosed, cashCode), 5700),
    `retained ${closingOf(stillClosed, '3102')}, cash ${closingOf(stillClosed, cashCode)}`,
  );

  const failed = results.filter((row) => !row.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed` +
      (failed.length ? `\nFAILED:\n  - ${failed.map((row) => `${row.name} (${row.detail})`).join('\n  - ')}` : ''),
  );
  return failed.length === 0;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error('\nThe scenario stopped with an unexpected error:');
    console.error(error);
    process.exit(2);
  });
