#!/usr/bin/env node
/**
 * Budgets and inventory cost-center attribution, end to end, against a
 * disposable PostgreSQL database.
 *
 * It proves:
 *
 *  - a budget is created for a revenue or expense account only;
 *  - a duplicate definition is refused with 409;
 *  - an inactive cost center and a balance-sheet account are refused with 400;
 *  - actuals are read from posted ledger lines and the variance is exact;
 *  - a retired budget disappears from the default list and still appears when
 *    asked for, and its history is never rewritten;
 *  - a stock adjustment posts its inventory difference to the chosen centre,
 *    leaves the inventory line unattributed, and a transfer refuses a centre;
 *  - reversing the adjustment keeps the same attribution on the reversal;
 *  - a user without the budget permission is refused by the API, not merely
 *    by the screen.
 *
 *   DATABASE_URL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... \
 *     node backend/scripts/scenario-budgets.mjs [apiBaseUrl]
 */
const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required; this scenario must use disposable PostgreSQL.');
}

const results = [];
let token = '';
const stamp = String(Date.now()).slice(-7);
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;
const monthEnd = (() => {
  const [year, month] = today.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
})();
const near = (value, expected, tolerance = 0.0001) =>
  Math.abs(Number(value ?? 0) - Number(expected)) <= tolerance;

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
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();
  return { status: response.status, data };
}

async function must(label, path, options = {}) {
  const response = await api(path, options);
  if (response.status >= 200 && response.status < 300) return response.data;
  check(label, false, `${response.status} ${JSON.stringify(response.data)?.slice(0, 300)}`);
  return null;
}

async function main() {
  const signedIn = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  check('sign in', signedIn.status === 201, `status ${signedIn.status}`);
  token = signedIn.data?.accessToken;
  if (!token) return;

  // ── chart of accounts ───────────────────────────────────────────────
  const chart = await must('read the chart of accounts', '/accounting/chart-of-accounts');
  const accounts = Array.isArray(chart) ? chart : chart?.items ?? [];
  const expense = accounts.find((row) => row.code === '5101') ??
    accounts.find((row) => row.type === 'EXPENSE' && row.isPostable);
  const revenue = accounts.find((row) => row.code === '4101') ??
    accounts.find((row) => row.type === 'REVENUE' && row.isPostable);
  const asset = accounts.find((row) => row.code === '1104');
  const cash = accounts.find((row) => row.code === '1101');
  check('the chart has the accounts the scenario needs', Boolean(expense && revenue && asset && cash));
  if (!expense || !revenue || !asset || !cash) return;

  // ── cost centers ────────────────────────────────────────────────────
  const parent = await must('create a department', '/accounting/cost-centers', {
    method: 'POST',
    json: {
      code: `BUD-D-${stamp}`,
      nameEn: `Budget department ${stamp}`,
      nameAr: `إدارة الموازنة ${stamp}`,
      type: 'DEPARTMENT',
    },
  });
  const project = await must('create a project under it', '/accounting/cost-centers', {
    method: 'POST',
    json: {
      code: `BUD-P-${stamp}`,
      nameEn: `Budget project ${stamp}`,
      nameAr: `مشروع الموازنة ${stamp}`,
      type: 'PROJECT',
      parentId: parent?.id,
    },
  });
  if (!parent?.id || !project?.id) return;

  // ── create, validate, compare ───────────────────────────────────────
  const budget = await must('create a budget for the expense account', '/accounting/budgets', {
    method: 'POST',
    json: {
      costCenterId: project.id,
      accountId: expense.id,
      periodStart: monthStart,
      periodEnd: monthEnd,
      amount: '300.0000',
      notes: 'Monthly plan',
    },
  });
  check(
    'the budget keeps its centre, account and period',
    budget?.costCenterId === project.id &&
      budget?.accountId === expense.id &&
      budget?.periodStart === monthStart &&
      budget?.periodEnd === monthEnd,
    `${budget?.periodStart}..${budget?.periodEnd}`,
  );

  const duplicate = await api('/accounting/budgets', {
    method: 'POST',
    json: {
      costCenterId: project.id,
      accountId: expense.id,
      periodStart: monthStart,
      periodEnd: monthEnd,
      amount: '10',
    },
  });
  check('a duplicate definition is refused', duplicate.status === 409, `status ${duplicate.status}`);

  const balanceSheet = await api('/accounting/budgets', {
    method: 'POST',
    json: {
      costCenterId: project.id,
      accountId: asset.id,
      periodStart: monthStart,
      periodEnd: monthEnd,
      amount: '10',
    },
  });
  check(
    'a balance-sheet account is refused',
    balanceSheet.status === 400,
    `status ${balanceSheet.status}`,
  );

  const inactive = await must('create a centre to deactivate', '/accounting/cost-centers', {
    method: 'POST',
    json: {
      code: `BUD-X-${stamp}`,
      nameEn: `Retired centre ${stamp}`,
      nameAr: `مركز موقوف ${stamp}`,
      type: 'ADMINISTRATIVE_UNIT',
    },
  });
  if (inactive?.id) {
    await api(`/accounting/cost-centers/${inactive.id}`, {
      method: 'PATCH',
      json: { isActive: false },
    });
    const refused = await api('/accounting/budgets', {
      method: 'POST',
      json: {
        costCenterId: inactive.id,
        accountId: expense.id,
        periodStart: monthStart,
        periodEnd: monthEnd,
        amount: '10',
      },
    });
    check(
      'an inactive centre cannot receive a new budget',
      refused.status === 400,
      `status ${refused.status}`,
    );
  }

  // ── post a ledger entry that the budget can compare with ────────────
  const entry = await must('create a journal entry attributed to the project', '/accounting/journal-entries', {
    method: 'POST',
    json: {
      entryDate: today,
      description: 'Budget actual',
      lines: [
        { accountId: expense.id, debit: '120.0000', costCenterId: project.id },
        { accountId: cash.id, credit: '120.0000' },
      ],
    },
  });
  const posted = entry?.id
    ? await api(`/accounting/journal-entries/${entry.id}/post`, { method: 'POST' })
    : { status: 0 };
  check('the entry posts', posted.status === 201 || posted.status === 200, `status ${posted.status}`);

  const report = await must(
    'read the budget report',
    `/reports/budgets?from=${monthStart}&to=${monthEnd}`,
  );
  const row = (report?.rows ?? []).find((line) => line.budgetId === budget?.id);
  check('the report lists the budget', Boolean(row));
  check('the actual comes from the posted entry', near(row?.actual, 120), `actual ${row?.actual}`);
  check('the variance is budget minus actual', near(row?.variance, -180), `variance ${row?.variance}`);
  check('the variance percentage is exact', row?.variancePercent === '-60.00', `${row?.variancePercent}%`);
  check('spending less than planned is favourable', row?.favorable === true);
  check(
    'the totals agree with the row',
    near(report?.totals?.expense?.budget, 300) && near(report?.totals?.expense?.actual, 120),
    `${report?.totals?.expense?.budget} / ${report?.totals?.expense?.actual}`,
  );

  // ── editing and retiring ────────────────────────────────────────────
  const edited = await api(`/accounting/budgets/${budget.id}`, {
    method: 'PATCH',
    json: { amount: '100.0000' },
  });
  check('the amount can be edited', edited.status === 200 && near(edited.data?.amount, 100));

  const afterEdit = await must('re-read the report', `/reports/budgets?from=${monthStart}&to=${monthEnd}`);
  const editedRow = (afterEdit?.rows ?? []).find((line) => line.budgetId === budget?.id);
  check(
    'the new plan changes the variance, never the actual',
    near(editedRow?.actual, 120) && near(editedRow?.variance, 20),
    `actual ${editedRow?.actual}, variance ${editedRow?.variance}`,
  );

  const retired = await api(`/accounting/budgets/${budget.id}`, { method: 'DELETE' });
  check('a budget is retired, not deleted', retired.status === 200, `status ${retired.status}`);
  const activeList = await must('list active budgets', '/accounting/budgets');
  check(
    'a retired budget leaves the default list',
    !(activeList?.items ?? []).some((line) => line.id === budget.id),
  );
  const allList = await must(
    'list budgets including retired ones',
    '/accounting/budgets?includeInactive=true',
  );
  check(
    'the retired budget is still there when asked for',
    (allList?.items ?? []).some((line) => line.id === budget.id),
  );
  const afterRetire = await must(
    'read the report including retired budgets',
    `/reports/budgets?from=${monthStart}&to=${monthEnd}&includeInactive=true`,
  );
  check(
    'a retired budget keeps its posted actuals for history',
    (afterRetire?.rows ?? []).some((line) => line.budgetId === budget.id && near(line.actual, 120)),
  );

  // ── inventory attribution ───────────────────────────────────────────
  const item = await must('create a stocked item', '/inventory/items', {
    method: 'POST',
    json: {
      code: `BUD-I-${stamp}`,
      nameEn: `Budget item ${stamp}`,
      nameAr: `صنف الموازنة ${stamp}`,
      unit: 'piece',
      purchasePrice: '20.0000',
      salePrice: '30.0000',
      isStockTracked: true,
    },
  });
  if (!item?.id) return;

  const adjustment = await must('create a stock adjustment with a centre', '/inventory/stock-documents', {
    method: 'POST',
    json: {
      kind: 'ADJUSTMENT',
      documentDate: today,
      reason: 'Opening the shelf',
      costCenterId: project.id,
      lines: [{ itemId: item.id, quantity: '5.0000', unitCost: '20.0000' }],
    },
  });
  if (!adjustment?.id) return;
  check(
    'the document keeps its centre',
    adjustment.costCenterId === project.id && adjustment.costCenter?.code === project.code,
    `${adjustment.costCenter?.code}`,
  );

  const transfer = await api('/inventory/stock-documents', {
    method: 'POST',
    json: {
      kind: 'TRANSFER',
      documentDate: today,
      fromBranchId: undefined,
      costCenterId: project.id,
      lines: [{ itemId: item.id, quantity: '1.0000', unitCost: '20.0000' }],
    },
  });
  check(
    'a transfer refuses a cost center: it is not a cost',
    transfer.status === 400 &&
      /cost center/i.test(JSON.stringify(transfer.data ?? {})),
    `status ${transfer.status} ${JSON.stringify(transfer.data ?? {})?.slice(0, 160)}`,
  );

  const adjustmentPosted = await api(`/inventory/stock-documents/${adjustment.id}/post`, {
    method: 'POST',
  });
  check('the adjustment posts', adjustmentPosted.status === 201 || adjustmentPosted.status === 200, `status ${adjustmentPosted.status}`);

  const postedDoc = await must('read the posted adjustment', `/inventory/stock-documents/${adjustment.id}`);
  const journal = postedDoc?.journalEntryId
    ? await must('read the adjustment journal', `/accounting/journal-entries/${postedDoc.journalEntryId}`)
    : null;
  const differenceLine = (journal?.lines ?? []).find((line) => line.accountId !== asset.id);
  const inventoryLine = (journal?.lines ?? []).find((line) => line.accountId === asset.id);
  check(
    'the inventory-difference line carries the centre',
    differenceLine?.costCenterId === project.id,
    `costCenterId ${differenceLine?.costCenterId}`,
  );
  check(
    'the inventory line stays unattributed: it is not a cost',
    inventoryLine != null && !inventoryLine.costCenterId,
  );

  const reversed = await api(`/inventory/stock-documents/${adjustment.id}/reverse`, { method: 'POST' });
  check('the adjustment reverses', reversed.status === 201 || reversed.status === 200, `status ${reversed.status}`);
  // The reversal is a new entry pointing at the original through
  // `reversalOfId`; the document keeps the original entry's id.
  const journalList = await must(
    'list journal entries to find the reversal',
    '/accounting/journal-entries?pageSize=200',
  );
  const reversalEntry = (journalList?.items ?? []).find(
    (entry) => entry.reversalOfId === postedDoc?.journalEntryId,
  );
  const reversal = reversalEntry
    ? await must('read the reversal entry', `/accounting/journal-entries/${reversalEntry.id}`)
    : null;
  check(
    'the reversal keeps the same attribution',
    (reversal?.lines ?? []).some((line) => line.costCenterId === project.id),
    `${(reversal?.lines ?? []).filter((line) => line.costCenterId === project.id).length} attributed line(s)`,
  );

  // ── permissions ─────────────────────────────────────────────────────
  const me = await must('read the signed-in user', '/auth/me');
  const branchId = me?.user?.branchId ?? me?.user?.branches?.[0]?.id ?? me?.user?.branch?.id;
  const restricted = await must('create a user without roles', '/admin/users', {
    method: 'POST',
    json: {
      username: `budrestricted${stamp}`,
      fullNameEn: `Restricted ${stamp}`,
      fullNameAr: `مقيد ${stamp}`,
      password: `Restricted@${stamp}`,
      roleIds: [],
      branchIds: branchId ? [branchId] : [],
    },
  });
  const restrictedLogin = await api('/auth/login', {
    method: 'POST',
    json: {
      username: restricted?.username ?? `budrestricted${stamp}`,
      password: `Restricted@${stamp}`,
    },
    noAuth: true,
  });
  if (restrictedLogin.status === 201) {
    const restrictedToken = restrictedLogin.data.accessToken;
    const list = await api('/accounting/budgets', {
      headers: { Authorization: `Bearer ${restrictedToken}` },
    });
    const reportAttempt = await api('/reports/budgets', {
      headers: { Authorization: `Bearer ${restrictedToken}` },
    });
    const createAttempt = await api('/accounting/budgets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${restrictedToken}`,
        'Content-Type': 'application/json',
      },
      json: {
        costCenterId: project.id,
        accountId: expense.id,
        periodStart: monthStart,
        periodEnd: monthEnd,
        amount: '10',
      },
    });
    check('a restricted user cannot list budgets', list.status === 403, `status ${list.status}`);
    check('a restricted user cannot read the budget report', reportAttempt.status === 403, `status ${reportAttempt.status}`);
    check('a restricted user cannot create a budget', createAttempt.status === 403, `status ${createAttempt.status}`);
  } else {
    check('the restricted-user check could not sign in', false, `status ${restrictedLogin.status}`);
  }

  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
