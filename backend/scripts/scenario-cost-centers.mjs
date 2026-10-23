#!/usr/bin/env node
/**
 * End-to-end cost-center scenario against a disposable PostgreSQL database.
 *
 * It creates a two-level hierarchy, proves the hierarchy refuses self-parents
 * and cycles and refuses to delete a referenced centre, posts a manual journal
 * with a split allocation, posts a purchase and a sale that name centres,
 * reverses the sale, returns part of it, and then checks that:
 *
 *  - the cost-center report reconciles with the ledger to the last decimal;
 *  - the unattributed bucket holds exactly what no centre claimed;
 *  - the drill-down lists the same lines the report counted;
 *  - a restricted user cannot read cost centers.
 *
 *   DATABASE_URL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... \
 *     node backend/scripts/scenario-cost-centers.mjs [apiBaseUrl]
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
const near = (value, expected, tolerance = 0.0001) =>
  Math.abs(Number(value ?? 0) - Number(expected)) <= tolerance;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${API}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
    });
    const type = response.headers.get('content-type') ?? '';
    const data = type.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();
    if (response.status !== 429 || attempt >= 6) return { status: response.status, data };
    const seconds = Number(/(\d+)\s*second/.exec(String(data?.detail ?? ''))?.[1] ?? 5);
    await sleep(Math.min(seconds + 1, 90) * 1000);
  }
}

async function must(label, path, options = {}) {
  const response = await api(path, options);
  if (response.status >= 200 && response.status < 300) return response.data;
  check(label, false, `${response.status} ${JSON.stringify(response.data)?.slice(0, 300)}`);
  return null;
}

const centerByCode = (report, code) =>
  (report?.items ?? []).find((row) => row.code === code) ?? null;

async function main() {
  const signedIn = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  check('sign in', signedIn.status === 201, `status ${signedIn.status}`);
  token = signedIn.data?.accessToken;
  if (!token) return;

  // ── hierarchy ────────────────────────────────────────────────────────
  const parent = await must('create a department cost center', '/accounting/cost-centers', {
    method: 'POST',
    json: {
      code: `CC-D-${stamp}`,
      nameEn: `Operations ${stamp}`,
      nameAr: `العمليات ${stamp}`,
      type: 'DEPARTMENT',
      responsiblePerson: 'Scenario runner',
      description: 'Created by scenario-cost-centers.mjs',
    },
  });
  if (!parent?.id) return;
  const project = await must('create a project child cost center', '/accounting/cost-centers', {
    method: 'POST',
    json: {
      code: `CC-P-${stamp}`,
      nameEn: `Project ${stamp}`,
      nameAr: `مشروع ${stamp}`,
      type: 'PROJECT',
      parentId: parent.id,
    },
  });
  const spare = await must('create an unreferenced cost center', '/accounting/cost-centers', {
    method: 'POST',
    json: {
      code: `CC-X-${stamp}`,
      nameEn: `Standby ${stamp}`,
      nameAr: `احتياطي ${stamp}`,
      type: 'ADMINISTRATIVE_UNIT',
    },
  });
  if (!project?.id || !spare?.id) return;

  const duplicate = await api('/accounting/cost-centers', {
    method: 'POST',
    json: { code: parent.code, nameEn: 'Duplicate', nameAr: 'مكرر' },
  });
  check(
    'a duplicate code is refused',
    duplicate.status === 409 || duplicate.status === 400,
    `status ${duplicate.status}`,
  );

  const selfParent = await api(`/accounting/cost-centers/${parent.id}`, {
    method: 'PATCH',
    json: { parentId: parent.id },
  });
  check('a centre cannot be its own parent', selfParent.status === 400, `status ${selfParent.status}`);

  const cycle = await api(`/accounting/cost-centers/${parent.id}`, {
    method: 'PATCH',
    json: { parentId: project.id },
  });
  check(
    'a hierarchy cycle is refused',
    cycle.status === 400,
    `status ${cycle.status}`,
  );

  const tree = await must('read the hierarchy tree', '/accounting/cost-centers/tree');
  const projectNode = (tree?.items ?? tree ?? []).find?.((row) => row.id === project.id);
  check(
    'the tree reports the parent of the child',
    projectNode?.parentId === parent.id,
    `parentId ${projectNode?.parentId}`,
  );

  // ── manual journal: a split allocation ───────────────────────────────
  const accounts = await must('read the chart of accounts', '/accounting/chart-of-accounts');
  const accountRows = accounts?.items ?? accounts ?? [];
  const cashAccount = accountRows.find((row) => row.code === '1101');
  const expenseAccount =
    accountRows.find((row) => row.code === '5101') ??
    accountRows.find((row) => row.type === 'EXPENSE' && row.isPostable !== false);
  if (!cashAccount || !expenseAccount) {
    check('the seeded chart has a cash and an expense account', false);
    return;
  }

  const splitEntry = await must('post a manual journal split across two centres', '/accounting/journal-entries', {
    method: 'POST',
    json: {
      entryDate: today,
      description: `Split expense ${stamp}`,
      lines: [
        {
          accountId: expenseAccount.id,
          debit: '300.0000',
          description: 'Shared expense',
          allocations: [
            { costCenterId: parent.id, amount: '100.0000' },
            { costCenterId: project.id, amount: '200.0000' },
          ],
        },
        { accountId: cashAccount.id, credit: '300.0000', description: 'Paid' },
      ],
    },
  });
  if (!splitEntry?.id) return;
  const posted = await api(`/accounting/journal-entries/${splitEntry.id}/post`, { method: 'POST' });
  check('the split journal posts', posted.status === 201 || posted.status === 200, `status ${posted.status}`);

  const badSplit = await api('/accounting/journal-entries', {
    method: 'POST',
    json: {
      entryDate: today,
      description: `Bad split ${stamp}`,
      lines: [
        {
          accountId: expenseAccount.id,
          debit: '100.0000',
          allocations: [
            { costCenterId: parent.id, amount: '40.0000' },
            { costCenterId: project.id, amount: '50.0000' },
          ],
        },
        { accountId: cashAccount.id, credit: '100.0000' },
      ],
    },
  });
  check(
    'allocations that do not add up are refused',
    badSplit.status === 400,
    `status ${badSplit.status} ${JSON.stringify(badSplit.data)?.slice(0, 160)}`,
  );

  const both = await api('/accounting/journal-entries', {
    method: 'POST',
    json: {
      entryDate: today,
      lines: [
        {
          accountId: expenseAccount.id,
          debit: '10.0000',
          costCenterId: parent.id,
          allocations: [{ costCenterId: project.id, amount: '10.0000' }],
        },
        { accountId: cashAccount.id, credit: '10.0000' },
      ],
    },
  });
  check(
    'one line cannot name a centre and a split at once',
    both.status === 400,
    `status ${both.status}`,
  );

  // ── an inactive centre cannot receive new postings ───────────────────
  const spareOff = await api(`/accounting/cost-centers/${spare.id}`, {
    method: 'PATCH',
    json: { isActive: false },
  });
  check('a centre can be deactivated', spareOff.status === 200, `status ${spareOff.status}`);
  const inactiveEntry = await api('/accounting/journal-entries', {
    method: 'POST',
    json: {
      entryDate: today,
      lines: [
        {
          accountId: expenseAccount.id,
          debit: '5.0000',
          costCenterId: spare.id,
        },
        { accountId: cashAccount.id, credit: '5.0000' },
      ],
    },
  });
  check(
    'an inactive centre is refused on a new posting',
    inactiveEntry.status === 400,
    `status ${inactiveEntry.status}`,
  );
  const spareDelete = await api(`/accounting/cost-centers/${spare.id}`, { method: 'DELETE' });
  check(
    'an unreferenced centre can be deleted',
    spareDelete.status === 200 || spareDelete.status === 204,
    `status ${spareDelete.status}`,
  );

  // ── purchase and sale, each pinned to a centre ──────────────────────
  const customer = await must('create a cost-center customer', '/parties/customers', {
    method: 'POST',
    json: {
      code: `CC-C-${stamp}`,
      nameEn: `Cost center customer ${stamp}`,
      nameAr: `عميل مراكز التكلفة ${stamp}`,
    },
  });
  const supplier = await must('create a cost-center supplier', '/parties/suppliers', {
    method: 'POST',
    json: {
      code: `CC-S-${stamp}`,
      nameEn: `Cost center supplier ${stamp}`,
      nameAr: `مورد مراكز التكلفة ${stamp}`,
    },
  });
  const item = await must('create a stocked item', '/inventory/items', {
    method: 'POST',
    json: {
      code: `CC-I-${stamp}`,
      nameEn: `Cost center item ${stamp}`,
      nameAr: `صنف مراكز التكلفة ${stamp}`,
      unit: 'piece',
      purchasePrice: '100.0000',
      salePrice: '150.0000',
      isStockTracked: true,
    },
  });
  if (!customer?.id || !supplier?.id || !item?.id) return;

  const purchase = await must('create a purchase invoice attributed to the project', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.id,
      lines: [
        {
          itemId: item.id,
          quantity: '10.0000',
          unitPrice: '100.0000',
          taxRate: '0.0000',
          costCenterId: project.id,
        },
      ],
    },
  });
  if (!purchase?.id) return;
  const purchaseDetail = await must('read the purchase line', `/purchases/invoices/${purchase.id}`);
  check(
    'the purchase line keeps its centre',
    purchaseDetail?.lines?.[0]?.costCenterId === project.id,
    `costCenterId ${purchaseDetail?.lines?.[0]?.costCenterId}`,
  );
  const purchasePosted = await api(`/purchases/invoices/${purchase.id}/post`, { method: 'POST' });
  check('the purchase posts', purchasePosted.status === 201 || purchasePosted.status === 200, `status ${purchasePosted.status}`);

  const sale = await must('create a sales invoice attributed to the project', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.id,
      lines: [
        { itemId: item.id, quantity: '8.0000', unitPrice: '150.0000', taxRate: '0.0000', costCenterId: project.id },
        { itemId: item.id, quantity: '2.0000', unitPrice: '150.0000', taxRate: '0.0000' },
      ],
    },
  });
  if (!sale?.id) return;
  const salePosted = await api(`/sales/invoices/${sale.id}/post`, { method: 'POST' });
  check('the sale posts', salePosted.status === 201 || salePosted.status === 200, `status ${salePosted.status}`);

  const saleDetail = await must('read the sale', `/sales/invoices/${sale.id}`);
  const attributedLine = saleDetail?.lines?.find((line) => line.costCenterId === project.id);
  const unattributedLine = saleDetail?.lines?.find((line) => !line.costCenterId);
  check(
    'the sale keeps one attributed and one unattributed line',
    Boolean(attributedLine) && Boolean(unattributedLine),
  );

  // ── a return inherits the original line's centre ────────────────────
  if (attributedLine?.id) {
    const salesReturn = await must('create a sales return on the attributed line', '/returns/sales', {
      method: 'POST',
      json: {
        originalInvoiceId: sale.id,
        returnDate: today,
        lines: [{ originalLineId: attributedLine.id, quantity: '1.0000' }],
      },
    });
    if (salesReturn?.id) {
      const returnPosted = await api(`/returns/sales/${salesReturn.id}/post`, { method: 'POST' });
      check(
        'the sales return posts',
        returnPosted.status === 201 || returnPosted.status === 200,
        `status ${returnPosted.status}`,
      );
      const returnDetail = await must('read the sales return', `/returns/sales/${salesReturn.id}`);
      check(
        'the return line inherits the original centre',
        returnDetail?.lines?.[0]?.costCenterId === project.id,
        `costCenterId ${returnDetail?.lines?.[0]?.costCenterId}`,
      );
      const returnEntry = await must(
        'read the return journal',
        `/accounting/journal-entries/${returnDetail?.journalEntryId}`,
      );
      const allocated = (returnEntry?.lines ?? []).filter((line) => line.costCenterId === project.id);
      check(
        'the return journal carries the centre instead of dropping it',
        allocated.length >= 2,
        `${allocated.length} attributed lines`,
      );
    }
  }

  // ── reverse a clean sale: the reversal carries the same centres ─────
  const reversalSale = await must('create a sale for the reversal test', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.id,
      lines: [
        { itemId: item.id, quantity: '1.0000', unitPrice: '150.0000', taxRate: '0.0000', costCenterId: parent.id },
      ],
    },
  });
  if (!reversalSale?.id) return;
  const reversalSalePosted = await api(`/sales/invoices/${reversalSale.id}/post`, { method: 'POST' });
  check(
    'the reversal sale posts',
    reversalSalePosted.status === 201 || reversalSalePosted.status === 200,
    `status ${reversalSalePosted.status}`,
  );
  const reversed = await api(`/sales/invoices/${reversalSale.id}/reverse`, { method: 'POST' });
  check('the sale reverses', reversed.status === 201 || reversed.status === 200, `status ${reversed.status}`);
  if (reversed.status < 300) {
    const reversalEntry = await must(
      'read the reversal journal',
      `/accounting/journal-entries/${reversed.data?.journalEntryId ?? reversed.data?.id}`,
    );
    const reversalCentres = new Set(
      (reversalEntry?.lines ?? []).map((line) => line.costCenterId).filter(Boolean),
    );
    check(
      'the reversal repeats the centres of the original entry',
      reversalCentres.has(parent.id),
      `${[...reversalCentres].length} centres`,
    );
    const reversalUnnamed = (reversalEntry?.lines ?? []).filter(
      (line) => line.accountCode === '4101' && !line.costCenterId && !(line.allocations ?? []).length,
    );
    check(
      'nothing in the reversal was pushed onto a centre that the sale did not name',
      reversalUnnamed.length === 0,
    );
  }

  // ── a cash payment carries the centre of its counter account ───────
  const cashBox = await must('create a cash box for the scenario', '/cash/accounts', {
    method: 'POST',
    json: {
      code: `CC-BOX-${stamp}`,
      nameEn: `Scenario box ${stamp}`,
      nameAr: `صندوق السيناريو ${stamp}`,
      kind: 'CASH',
      accountId: cashAccount.id,
    },
  });
  let voucherCostCenterOk = false;
  if (cashBox?.id) {
    const voucher = await must('create a payment voucher against an expense account', '/cash/vouchers', {
      method: 'POST',
      json: {
        kind: 'PAYMENT',
        cashAccountId: cashBox.id,
        voucherDate: today,
        amount: '50.0000',
        counterAccountId: expenseAccount.id,
        costCenterId: parent.id,
        description: `Cash expense ${stamp}`,
      },
    });
    if (voucher?.id) {
      const voucherPosted = await api(`/cash/vouchers/${voucher.id}/post`, { method: 'POST' });
      check(
        'the payment voucher posts',
        voucherPosted.status === 201 || voucherPosted.status === 200,
        `status ${voucherPosted.status}`,
      );
      const again = await api(`/cash/vouchers/${voucher.id}/post`, { method: 'POST' });
      check('a voucher cannot be posted twice', again.status >= 400, `status ${again.status}`);
      const voucherEntry = await must(
        'read the voucher journal',
        `/accounting/journal-entries/${voucherPosted.data?.journalEntryId ?? voucherPosted.data?.journal?.id}`,
      );
      voucherCostCenterOk = (voucherEntry?.lines ?? []).some(
        (line) => line.costCenterId === parent.id && Number(line.debit ?? 0) === 50,
      );
      check('the expense side of the voucher carries the centre', voucherCostCenterOk);
    }
  }
  const partnerVoucher = await api('/cash/vouchers', {
    method: 'POST',
    json: {
      kind: 'PAYMENT',
      cashAccountId: cashBox?.id,
      voucherDate: today,
      amount: '5.0000',
      counterAccountId: expenseAccount.id,
      costCenterId: spare.id,
    },
  });
  check(
    'a voucher cannot point at a deleted centre',
    partnerVoucher.status === 400,
    `status ${partnerVoucher.status}`,
  );

  // ── the report reconciles with the ledger ──────────────────────────
  const report = await must(
    'read the cost-center report',
    `/reports/cost-centers?from=${today}&to=${today}`,
  );
  if (!report) return;
  check(
    'the report reconciles with the ledger',
    report.reconciliation?.balanced === true,
    JSON.stringify(report.reconciliation),
  );
  const opex = centerByCode(report, parent.code);
  const proj = centerByCode(report, project.code);
  check('the report lists the parent', Boolean(opex));
  check('the report lists the project', Boolean(proj));

  // Expected, from the documents this scenario posted:
  //   split expense           parent 100, project 200
  //   payment voucher         parent 50
  //   sale A                  project revenue 1200 (8 x 150), unnamed 300 (2 x 150)
  //   sale A cost of goods    project expense 800, unnamed 200
  //   return on sale A        project revenue -150, project expense -100
  //   sale B + reversal       parent revenue 0 net, parent expense 0 net
  check(
    'the parent carries its share of the split expense',
    near(opex?.ownExpenses, 150),
    `ownExpenses ${opex?.ownExpenses}`,
  );
  check(
    'the parent has no net revenue after its sale was reversed',
    near(opex?.ownRevenue, 0),
    `ownRevenue ${opex?.ownRevenue}`,
  );
  check(
    'the project carries its share of the split expense, net of the return cost',
    near(proj?.ownExpenses, 900),
    `ownExpenses ${proj?.ownExpenses}`,
  );
  check(
    'the project revenue nets the return against the sale',
    near(proj?.ownRevenue, 1050),
    `ownRevenue ${proj?.ownRevenue}`,
  );
  check(
    'the parent rolls up the child expenses',
    near(opex?.expenses, 1050),
    `expenses ${opex?.expenses}`,
  );
  check(
    'the parent rolls up the child revenue',
    near(opex?.revenue, 1050),
    `revenue ${opex?.revenue}`,
  );
  check(
    'the report totals the visible rows',
    near(report.totals?.revenue, 1050) && near(report.totals?.expenses, 1050),
    `totals ${report.totals?.revenue}/${report.totals?.expenses}`,
  );
  check(
    'the visible totals plus the unattributed bucket equal the ledger',
    near(
      Number(report.totals?.revenue ?? 0) + Number(report.unallocated?.revenue ?? 0),
      Number(report.reconciliation?.ledgerRevenue ?? NaN),
    ) &&
      near(
        Number(report.totals?.expenses ?? 0) + Number(report.unallocated?.expenses ?? 0),
        Number(report.reconciliation?.ledgerExpenses ?? NaN),
      ),
    `totals ${report.totals?.revenue}/${report.totals?.expenses} + ` +
      `unallocated ${report.unallocated?.revenue}/${report.unallocated?.expenses}`,
  );
  check(
    'the unattributed bucket holds exactly the unnamed lines',
    near(report.unallocated?.revenue, 300) && near(report.unallocated?.expenses, 200),
    `unallocated ${report.unallocated?.revenue}/${report.unallocated?.expenses}`,
  );

  const lines = await must(
    'read the project drill-down',
    `/reports/cost-centers/${project.id}/transactions?from=${today}&to=${today}&pageSize=200`,
  );
  const drillRows = lines?.items ?? [];
  const signed = (row) =>
    row.accountType === 'REVENUE'
      ? row.isDebit
        ? -Number(row.amount)
        : Number(row.amount)
      : row.isDebit
        ? Number(row.amount)
        : -Number(row.amount);
  const drillRevenue = drillRows
    .filter((row) => row.accountType === 'REVENUE')
    .reduce((sum, row) => sum + signed(row), 0);
  const drillExpenses = drillRows
    .filter((row) => row.accountType === 'EXPENSE')
    .reduce((sum, row) => sum + signed(row), 0);
  check(
    'the drill-down revenue equals the centre own revenue',
    near(drillRevenue, Number(proj?.ownRevenue ?? 0)),
    `drill ${drillRevenue} vs own ${proj?.ownRevenue}`,
  );
  check(
    'the drill-down expenses equal the centre own expenses',
    near(drillExpenses, Number(proj?.ownExpenses ?? 0)),
    `drill ${drillExpenses} vs own ${proj?.ownExpenses}`,
  );
  check(
    'the drill-down signed result matches the centre result',
    near(drillRevenue - drillExpenses, Number(proj?.ownResult ?? 0)),
    `drill ${drillRevenue - drillExpenses} vs own ${proj?.ownResult}`,
  );
  check(
    'the split line appears in the drill-down with its own share, not the whole line',
    drillRows.some((row) => row.isAllocated && near(row.amount, 200)),
    `${drillRows.filter((row) => row.isAllocated).length} allocated rows`,
  );

  const unallocated = await must(
    'read the unattributed drill-down',
    `/reports/cost-centers/unallocated/transactions?from=${today}&to=${today}&pageSize=200`,
  );
  const unallocatedRows = unallocated?.items ?? [];
  const unallocatedRevenue = unallocatedRows
    .filter((row) => row.accountType === 'REVENUE')
    .reduce((sum, row) => sum + signed(row), 0);
  const unallocatedExpenses = unallocatedRows
    .filter((row) => row.accountType === 'EXPENSE')
    .reduce((sum, row) => sum + signed(row), 0);
  check(
    'the unattributed drill-down adds up to the unattributed bucket',
    near(unallocatedRevenue, Number(report.unallocated?.revenue ?? 0)) &&
      near(unallocatedExpenses, Number(report.unallocated?.expenses ?? 0)),
    `drill ${unallocatedRevenue}/${unallocatedExpenses}`,
  );

  // ── filters ────────────────────────────────────────────────────────
  const typed = await must(
    'read the report filtered by type',
    `/reports/cost-centers?from=${today}&to=${today}&type=PROJECT`,
  );
  check(
    'the type filter returns only projects',
    (typed?.items ?? []).length > 0 && (typed?.items ?? []).every((row) => row.type === 'PROJECT'),
    `${(typed?.items ?? []).length} rows`,
  );
  const one = await must(
    'read the report filtered to one centre',
    `/reports/cost-centers?from=${today}&to=${today}&costCenterId=${project.id}`,
  );
  check(
    'the centre filter returns exactly that centre',
    (one?.items ?? []).length === 1 && one.items[0].costCenterId === project.id,
  );

  // ── a referenced centre cannot be deleted ──────────────────────────
  const deleteUsed = await api(`/accounting/cost-centers/${project.id}`, { method: 'DELETE' });
  check(
    'a centre used by journal lines cannot be deleted',
    deleteUsed.status === 409 || deleteUsed.status === 400,
    `status ${deleteUsed.status}`,
  );
  const usage = await must('read the centre usage', `/accounting/cost-centers/${project.id}/usage`);
  check(
    'the usage endpoint counts the attributed lines',
    Number(usage?.journalLines ?? 0) > 0,
    `journalLines ${usage?.journalLines}`,
  );

  const deactivated = await api(`/accounting/cost-centers/${project.id}`, {
    method: 'PATCH',
    json: { isActive: false },
  });
  check(
    'a referenced centre can be deactivated instead',
    deactivated.status === 200,
    `status ${deactivated.status}`,
  );

  // ── restricted user ────────────────────────────────────────────────
  // A user with no roles is the honest way to prove the permission is
  // enforced: the seeded accountant legitimately holds the accounting module.
  const me = await must('read the signed-in user', '/auth/me');
  const branchId = me?.user?.branchId ?? me?.user?.branches?.[0]?.id ?? me?.user?.branch?.id;
  const restrictedUser = await must('create a user without roles', '/admin/users', {
    method: 'POST',
    json: {
      username: `ccrestricted${stamp}`,
      fullNameEn: `Restricted ${stamp}`,
      fullNameAr: `مقيد ${stamp}`,
      password: `Restricted@${stamp}`,
      roleIds: [],
      branchIds: branchId ? [branchId] : [],
    },
  });
  const restricted = await api('/auth/login', {
    method: 'POST',
    json: {
      username: restrictedUser?.username ?? `ccrestricted${stamp}`,
      password: `Restricted@${stamp}`,
    },
    noAuth: true,
  });
  if (restricted.status === 201) {
    const read = await api('/accounting/cost-centers', {
      headers: { Authorization: `Bearer ${restricted.data.accessToken}` },
    });
    check(
      'a user without the cost-center permission is refused',
      read.status === 403,
      `status ${read.status}`,
    );
  } else {
    check(
      'restricted-user check skipped: the seeded accountant is not available',
      false,
      `status ${restricted.status}`,
    );
  }

  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
