#!/usr/bin/env node
/**
 * Minimal real-API proof of the eight digit chart of accounts.
 *
 *   node backend/scripts/scenario-eight-digit-chart.mjs [apiBaseUrl]
 *
 * Expects a database seeded with the default (eight digit) starter chart. It checks:
 *   1. a new company's chart is eight digit: every code is 2, 4, 6 or 8 digits,
 *      each child code starts with its parent's code, only 8-digit accounts post
 *   2. the accounts automatic postings use exist under their eight digit codes
 *   3. an entry on a 2/4/6-digit (total) account is refused
 *   4. a bad new account (wrong length, wrong parent prefix, postable total) is refused
 *      and a correct 8-digit child is accepted
 *   5. a manual entry between 8-digit accounts goes through submit/approve/post
 *   6. a purchase and a sale post, and their journal lines use the eight digit
 *      role accounts (receivable, payable, inventory, revenue, cost of goods)
 */
const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
const results = [];
let token = '';
const stamp = String(Date.now()).slice(-6);
const today = new Date().toISOString().slice(0, 10);

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function api(path, options = {}) {
  const headers = {};
  if (token && !options.noAuth) headers.Authorization = `Bearer ${token}`;
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${API}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
    });
    const data = (response.headers.get('content-type') ?? '').includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();
    if (response.status !== 429 || attempt >= 6) return { status: response.status, data };
    await new Promise((r) => setTimeout(r, 6000));
  }
}
async function must(label, path, options) {
  const r = await api(path, options);
  if (r.status >= 200 && r.status < 300) return r.data;
  check(label, false, `${r.status} ${JSON.stringify(r.data)?.slice(0, 240)}`);
  return null;
}
async function refuses(label, path, options) {
  const r = await api(path, options);
  check(label, r.status >= 400 && r.status < 500, `status ${r.status} ${JSON.stringify(r.data)?.slice(0, 160)}`);
}

async function main() {
  const session = await must('an administrator can sign in', '/auth/login', {
    method: 'POST', noAuth: true, json: { username: USERNAME, password: PASSWORD },
  });
  if (!session?.accessToken) { process.exitCode = 1; return; }
  token = session.accessToken;

  const chart = await must('the chart of accounts is readable', '/accounting/chart-of-accounts');
  const items = chart?.items ?? [];
  const byCode = new Map(items.map((a) => [a.code, a]));
  const shape = items.length >= 20 && items.every((a) => /^[0-9]+$/.test(a.code) && [2, 4, 6, 8].includes(a.code.length));
  check('a new company starts with the eight digit chart (2/4/6/8 digit codes only)', shape, `${items.length} accounts`);
  const parentsOk = items.every((a) => a.code.length === 2 || (byCode.get(a.code.slice(0, -2)) && a.parentId === byCode.get(a.code.slice(0, -2)).id));
  check('every account sits under the account whose code is its prefix', parentsOk);
  const postingOk = items.every((a) => (a.code.length === 8) === Boolean(a.isPostable));
  check('only eight digit accounts are postable', postingOk);

  const role = {
    receivable: '01010201', payable: '02010101', inventory: '01010301',
    revenue: '04010101', cogs: '05010101',
  };
  for (const [name, c] of Object.entries(role)) {
    check(`the ${name} posting account exists as ${c}`, byCode.has(c) && byCode.get(c).isPostable);
  }

  const parent = items.find((a) => a.code.length === 6 && !a.isPostable);
  const debit = items.find((a) => a.code === '05010102');
  const credit = items.find((a) => a.code === '02010201');
  if (!parent || !debit || !credit) { check('fixture accounts are present', false); process.exitCode = 1; return; }

  await refuses('an entry on a total (non-posting) account is refused', '/accounting/journal-entries', {
    method: 'POST',
    json: { entryDate: today, description: `Parent ${stamp}`, lines: [
      { accountId: parent.id, debit: '10' }, { accountId: credit.id, credit: '10' }] },
  });

  await refuses('a 4-digit code under a 6-digit parent is refused', '/accounting/chart-of-accounts', {
    method: 'POST',
    json: { code: `9${stamp.slice(-3)}`, nameEn: `Bad ${stamp}`, nameAr: `خطأ ${stamp}`, type: parent.type.toUpperCase(), parentId: parent.id, isPostable: true },
  });
  await refuses('an 8-digit code that does not start with its parent code is refused', '/accounting/chart-of-accounts', {
    method: 'POST',
    json: { code: `99${String(stamp).padStart(6, '0')}`, nameEn: `Bad2 ${stamp}`, nameAr: `خطأ٢ ${stamp}`, type: parent.type.toUpperCase(), parentId: parent.id, isPostable: true },
  });
  const used = items.filter((a) => a.parentId === parent.id).map((a) => Number(a.code.slice(-2)));
  const next = String(Math.max(0, ...used) + 1).padStart(2, '0');
  const child = await must('a correct 8-digit child under the 6-digit parent is accepted', '/accounting/chart-of-accounts', {
    method: 'POST',
    json: { code: `${parent.code}${next}`, nameEn: `Scenario child ${stamp}`, nameAr: `حساب فرعي ${stamp}`, type: parent.type.toUpperCase(), parentId: parent.id, isPostable: true },
  });
  check('the new child keeps the eight digit code', child?.code === `${parent.code}${next}`, child?.code);

  const entry = await must('a manual entry between 8-digit accounts can be written', '/accounting/journal-entries', {
    method: 'POST',
    json: { entryDate: today, description: `Eight digit entry ${stamp}`, lines: [
      { accountId: debit.id, debit: '50' }, { accountId: credit.id, credit: '50' }] },
  });
  if (entry) {
    await must('the entry is submitted', `/accounting/journal-entries/${entry.id}/submit`, { method: 'POST' });
    await must('the entry is approved', `/accounting/journal-entries/${entry.id}/approve`, { method: 'POST' });
    await must('the entry is posted', `/accounting/journal-entries/${entry.id}/post`, { method: 'POST' });
    const posted = await api(`/accounting/journal-entries/${entry.id}`);
    check('the manual entry is posted', String(posted.data?.status).toUpperCase() === 'POSTED', `status ${posted.data?.status}`);
  }

  // Documents: purchase then sale, and look at the accounts their entries used.
  const customer = await must('a customer can be created', '/parties/customers', {
    method: 'POST', json: { code: `E8C-${stamp}`, nameEn: `Customer ${stamp}`, nameAr: `عميل ${stamp}` } });
  const supplier = await must('a supplier can be created', '/parties/suppliers', {
    method: 'POST', json: { code: `E8S-${stamp}`, nameEn: `Supplier ${stamp}`, nameAr: `مورد ${stamp}` } });
  const item = await must('an item can be created', '/inventory/items', {
    method: 'POST', json: { code: `E8I-${stamp}`, nameEn: `Item ${stamp}`, nameAr: `صنف ${stamp}`, unit: 'piece',
      salePrice: '150.0000', purchasePrice: '100.0000', isStockTracked: true } });
  if (customer && supplier && item) {
    const purchase = await must('a purchase invoice can be created', '/purchases/invoices', {
      method: 'POST', json: { invoiceDate: today, supplierId: supplier.id, lines: [{ itemId: item.id, quantity: '5', unitPrice: '100', taxRate: '0' }] } });
    const sale = purchase && await must('the purchase is posted', `/purchases/invoices/${purchase.id}/post`, { method: 'POST' }).then(async () =>
      must('a sales invoice can be created', '/sales/invoices', {
        method: 'POST', json: { invoiceDate: today, customerId: customer.id, lines: [{ itemId: item.id, quantity: '2', unitPrice: '150', taxRate: '0' }] } }));
    if (sale) await must('the sale is posted', `/sales/invoices/${sale.id}/post`, { method: 'POST' });
    const codesUsed = async (invoiceKind, id) => {
      const inv = (await api(`/${invoiceKind}/invoices/${id}`)).data;
      const je = inv?.journalEntryId ?? inv?.journalEntry?.id;
      const full = je ? (await api(`/accounting/journal-entries/${je}`)).data : null;
      return new Set((full?.lines ?? []).map((l) => l.account?.code ?? l.accountCode ?? l.code).filter(Boolean));
    };
    if (purchase) {
      const used8 = await codesUsed('purchases', purchase.id);
      check('the posted purchase used the eight digit inventory and payable accounts',
        used8.has(role.inventory) && used8.has(role.payable), [...used8].join(', '));
    }
    if (sale) {
      const used8 = await codesUsed('sales', sale.id);
      check('the posted sale used the eight digit receivable, revenue and cost accounts',
        used8.has(role.receivable) && used8.has(role.revenue) && used8.has(role.cogs), [...used8].join(', '));
    }
  }

  // Opening balance, bank account and cash box on the eight digit chart.
  // Accounts are resolved by their role (cash on hand, current bank account,
  // opening balance equity), not by the legacy 4-digit codes, so these business
  // paths are proven on the modern chart and not through a legacy fixture.
  const roleCodes = { cash: '01010101', bank: '01010102', openingEquity: '03010301' };
  const cashLedger = byCode.get(roleCodes.cash);
  const bankLedger = byCode.get(roleCodes.bank);
  const equityLedger = byCode.get(roleCodes.openingEquity);
  const totalLedger = items.find((a) => a.code === '010101');
  check('the cash, bank and opening-equity role accounts exist and post',
    [cashLedger, bankLedger, equityLedger].every((a) => a && a.isPostable),
    Object.entries(roleCodes).map(([k, c]) => `${k}=${byCode.has(c)}`).join(' '));
  if (cashLedger && bankLedger && equityLedger && totalLedger) {
    const countDrafts = async () =>
      ((await api('/accounting/opening-balances')).data?.items ?? []).length;
    const before = await countDrafts();
    const opening = await api('/accounting/opening-balances', {
      method: 'POST',
      json: { asOfDate: '2026-01-01', description: `eight digit opening ${stamp}`,
        lines: [{ accountId: cashLedger.id, debit: '100.0000' }, { accountId: equityLedger.id, credit: '100.0000' }] },
    });
    check('an opening balance between eight digit accounts is created as a draft',
      opening.status === 201 && String(opening.data?.status).toLowerCase() === 'draft',
      opening.data?.detail ?? `status ${opening.status}`);
    if (opening.status === 201) {
      const openingPost = await api(`/accounting/opening-balances/${opening.data.id}/post`, { method: 'POST' });
      check('the eight digit opening balance posts and has a journal entry',
        openingPost.status === 201 && Boolean(openingPost.data?.journalEntryId),
        openingPost.data?.detail ?? `status ${openingPost.status}`);
    }
    const unbalanced = await api('/accounting/opening-balances', {
      method: 'POST',
      json: { asOfDate: '2026-01-01', description: `eight digit unbalanced ${stamp}`,
        lines: [{ accountId: cashLedger.id, debit: '10.0000' }, { accountId: equityLedger.id, credit: '9.0000' }] },
    });
    const after = await countDrafts();
    check('an unbalanced opening balance is refused and leaves no extra draft',
      unbalanced.status === 400 && after === before + (opening.status === 201 ? 1 : 0),
      `status ${unbalanced.status}, drafts ${before} -> ${after}`);
    const onTotal = await api('/accounting/opening-balances', {
      method: 'POST',
      json: { asOfDate: '2026-01-01', description: `eight digit total ${stamp}`,
        lines: [{ accountId: totalLedger.id, debit: '5.0000' }, { accountId: equityLedger.id, credit: '5.0000' }] },
    });
    check('an opening balance line on a total (non-posting) account is refused',
      onTotal.status >= 400 && onTotal.status < 500, `status ${onTotal.status}`);

    const bank = await api('/cash/accounts', { method: 'POST',
      json: { code: `E8BK${stamp}`, nameEn: 'Eight digit bank', nameAr: 'بنك', kind: 'BANK', accountId: bankLedger.id } });
    check('a bank account is created on the eight digit bank account and reported as a bank',
      bank.status === 201 && String(bank.data?.kind).toLowerCase() === 'bank', bank.data?.detail ?? `status ${bank.status}`);
    const cash = await api('/cash/accounts', { method: 'POST',
      json: { code: `E8CS${stamp}`, nameEn: 'Eight digit cash box', nameAr: 'صندوق', kind: 'CASH', accountId: cashLedger.id } });
    check('a cash box is created on the eight digit cash account',
      cash.status === 201, cash.data?.detail ?? `status ${cash.status}`);
    const onTotalCash = await api('/cash/accounts', { method: 'POST',
      json: { code: `E8TT${stamp}`, nameEn: 'Bad cash box', nameAr: 'صندوق خطأ', kind: 'CASH', accountId: totalLedger.id } });
    check('a cash box on a total (non-posting) account is refused',
      onTotalCash.status >= 400 && onTotalCash.status < 500, `status ${onTotalCash.status}`);
    if (bank.status === 201 && cash.status === 201) {
      const transfer = await api('/cash/transfers', { method: 'POST',
        json: { fromCashAccountId: cash.data.id, toCashAccountId: bank.data.id, transferDate: '2026-01-02',
          amount: '25.0000', description: `eight digit transfer ${stamp}` } });
      check('a transfer between the eight digit cash box and bank is created as a draft',
        transfer.status === 201 && String(transfer.data?.status).toLowerCase() === 'draft',
        transfer.data?.detail ?? `status ${transfer.status}`);
      if (transfer.status === 201) {
        const posted = await api(`/cash/transfers/${transfer.data.id}/post`, { method: 'POST' });
        check('the transfer posts (cash box funded by the posted opening balance)',
          posted.status === 201 && Boolean(posted.data?.journalEntryId),
          posted.data?.detail ?? `status ${posted.status}`);
        const balances = await api('/cash/accounts/balances');
        const rows = balances.data?.rows ?? [];
        const bankRow = rows.find((r) => r.code === `E8BK${stamp}`);
        const cashRow = rows.find((r) => r.code === `E8CS${stamp}`);
        check('the bank balance is 25.0000 and the cash box balance is 75.0000 after the transfer',
          bankRow?.balance === '25.0000' && cashRow?.balance === '75.0000',
          `bank ${bankRow?.balance} cash ${cashRow?.balance}`);
        if (posted.data?.journalEntryId) {
          const je = (await api(`/accounting/journal-entries/${posted.data.journalEntryId}`)).data;
          const lines = je?.lines ?? [];
          const sum = (k) => lines.reduce((t, l) => t + Number(l[k] ?? 0), 0);
          const codes = new Set(lines.map((l) => l.account?.code ?? l.accountCode ?? l.code));
          check('the transfer journal entry is balanced and sits on the eight digit bank and cash accounts',
            lines.length >= 2 && Math.abs(sum('debit') - sum('credit')) < 0.00005 && sum('debit') === 25
              && codes.has(roleCodes.bank) && codes.has(roleCodes.cash),
            `debit ${sum('debit')} credit ${sum('credit')} accounts ${[...codes].join(',')}`);
        }
        const overdraw = await api('/cash/transfers', { method: 'POST',
          json: { fromCashAccountId: cash.data.id, toCashAccountId: bank.data.id, transferDate: '2026-01-03',
            amount: '1000.0000', description: `eight digit overdraw ${stamp}` } });
        const overdrawPost = overdraw.status === 201
          ? await api(`/cash/transfers/${overdraw.data.id}/post`, { method: 'POST' }) : overdraw;
        check('a transfer larger than the cash box balance is refused with a client error (cash never negative)',
          overdrawPost.status >= 400 && overdrawPost.status < 500, `status ${overdrawPost.status}`);
      }
    }
  }

  const failures = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length > 0) {
    console.log('Failed checks:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
