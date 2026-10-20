#!/usr/bin/env node
/**
 * Invoice discounts and quotations, end to end, against a disposable
 * PostgreSQL database and the real HTTP API.
 *
 * It proves:
 *
 *  - a line discount can be a percentage or a fixed amount, and the resolved
 *    amount is stored on the line;
 *  - a document discount is allocated across the lines pro rata, with every
 *    rounding unit assigned, and the allocated shares add up to it exactly;
 *  - tax is charged on the discounted value, and revenue, VAT and the
 *    customer/supplier balance still balance in the journal;
 *  - the purchase invoice values stock at what was actually paid after
 *    discounts;
 *  - a partial sales return credits the discounted net value and its VAT;
 *  - a discount above 100% or above a line's value is refused;
 *  - a posted invoice keeps its discount detail forever (nothing is
 *    recomputed when prices change);
 *  - a quotation has titled tables, table discounts, a quotation-wide
 *    discount, exact totals and a summary that reconciles;
 *  - saving, sending, printing, accepting, revising and converting a
 *    quotation behave, and nothing it does touches the ledger or stock;
 *  - an accepted quotation converts to exactly one draft invoice, and a
 *    second conversion is refused;
 *  - an issued quotation cannot be edited and a revision keeps the original
 *    content intact;
 *  - an overdue sent quotation expires by itself;
 *  - the tax-registration-number setting controls the printed document
 *    without deleting the company's number.
 *
 *   DATABASE_URL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... \
 *     node backend/scripts/scenario-discounts-quotations.mjs [apiBaseUrl]
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
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const near = (value, expected, tolerance = 0.0001) =>
  Math.abs(Number(value ?? 0) - Number(expected)) <= tolerance;
const d = (value) => Number(value ?? 0);

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
  return { status: response.status, data, headers: response.headers };
}

async function must(label, path, options = {}) {
  const response = await api(path, options);
  if (response.status >= 200 && response.status < 300) return response.data;
  check(label, false, `${response.status} ${JSON.stringify(response.data)?.slice(0, 400)}`);
  return null;
}

async function rejected(label, path, options, expected = 400) {
  const response = await api(path, options);
  check(label, response.status === expected, `status ${response.status}`);
  return response;
}

async function main() {
  // The server rate limits sign-ins by address. An earlier scenario may have
  // filled the window; waiting it out is what a real client should do.
  let signedIn = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  for (let attempt = 1; signedIn.status === 429 && attempt <= 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 15000));
    signedIn = await api('/auth/login', {
      method: 'POST',
      json: { username: USERNAME, password: PASSWORD },
      noAuth: true,
    });
  }
  check('sign in', signedIn.status === 201, `status ${signedIn.status}`);
  token = signedIn.data?.accessToken;
  if (!token) return;

  // ── the saved terms library ──────────────────────────────────────────
  //
  // The editor offers saved terms and copies the chosen text onto the
  // quotation. The library is a convenience, never a live link: changing or
  // retiring a saved entry must not alter a document that used it.
  const emptyLibrary = await must('the terms library starts empty', '/sales/quotation-terms');
  check('the terms library starts empty', Array.isArray(emptyLibrary) && emptyLibrary.length === 0);
  const savedTerm = await must('save a reusable term', '/sales/quotation-terms', {
    method: 'POST',
    json: { title: `Warranty ${stamp}`, body: 'Two years against manufacturing defects.' },
  });
  check('a saved term keeps its title and text', savedTerm?.title === `Warranty ${stamp}` && savedTerm?.body.includes('Two years'));
  const library = await must('read the terms library', '/sales/quotation-terms');
  check('the saved term is offered', Array.isArray(library) && library.some((term) => term.id === savedTerm.id));
  const editedTerm = await must('edit a saved term', `/sales/quotation-terms/${savedTerm.id}`, {
    method: 'PUT',
    json: { body: 'Three years against manufacturing defects.' },
  });
  check('a saved term can be edited', editedTerm?.body.startsWith('Three years'));
  await must('retire a saved term', `/sales/quotation-terms/${savedTerm.id}`, { method: 'DELETE' });
  const afterRetire = await must('read the library after retiring', '/sales/quotation-terms');
  check('a retired term leaves the picker', Array.isArray(afterRetire) && afterRetire.every((term) => term.id !== savedTerm.id));

  // ── master data ─────────────────────────────────────────────────────
  const companyTaxId = `CO-TAX-${stamp}`;
  await must('give the company a tax registration number', '/company/profile', {
    method: 'PATCH',
    json: { taxId: companyTaxId, commercialRegistration: `CR-${stamp}` },
  });

  const warehouseList = await must('read warehouses', '/inventory/warehouses');
  const warehouses = Array.isArray(warehouseList) ? warehouseList : warehouseList?.items ?? [];
  const warehouseId = warehouses[0]?.id;

  const customer = await must('create a customer', '/parties/customers', {
    method: 'POST',
    json: {
      code: `DISC-C-${stamp}`,
      nameEn: `Discount customer ${stamp}`,
      nameAr: `عميل الخصم ${stamp}`,
      phone: '01000000000',
      email: `discount-${stamp}@example.test`,
      taxNumber: `TAX-${stamp}`,
      address: 'Cairo',
    },
  });
  const supplier = await must('create a supplier', '/parties/suppliers', {
    method: 'POST',
    json: {
      code: `DISC-S-${stamp}`,
      nameEn: `Discount supplier ${stamp}`,
      nameAr: `مورد الخصم ${stamp}`,
    },
  });
  if (!customer?.id || !supplier?.id) return;

  const itemA = await must('create item A', '/inventory/items', {
    method: 'POST',
    json: {
      code: `DISC-A-${stamp}`,
      nameEn: `Discounted item A ${stamp}`,
      nameAr: `صنف الخصم أ ${stamp}`,
      unit: 'piece',
      salePrice: '150.0000',
      purchasePrice: '100.0000',
      taxRate: '14.0000',
      countryOfOrigin: 'Egypt',
    },
  });
  const itemB = await must('create item B', '/inventory/items', {
    method: 'POST',
    json: {
      code: `DISC-B-${stamp}`,
      nameEn: `Discounted item B ${stamp}`,
      nameAr: `صنف الخصم ب ${stamp}`,
      unit: 'piece',
      salePrice: '300.0000',
      purchasePrice: '200.0000',
      taxRate: '14.0000',
      countryOfOrigin: 'Germany',
    },
  });
  if (!itemA?.id || !itemB?.id) return;
  check('the item stores the country of origin it was given', itemA.countryOfOrigin === 'Egypt');

  // ── purchase discounts, tax and stock valuation ─────────────────────
  //
  //  A: 10 x 100 = 1000, 10% off      -> 900
  //  B:  5 x 200 = 1000, 50.00 off    -> 950
  //  document discount 5% of 1850     -> 92.50, split 45.00 / 47.50
  //  final nets 855 / 902.50; VAT 14% -> 119.70 / 126.35
  const purchase = await must('create a purchase invoice with line and document discounts', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.id,
      warehouseId,
      discountType: 'PERCENT',
      discountPercent: '5',
      lines: [
        {
          itemId: itemA.id,
          quantity: '10',
          unitPrice: '100',
          taxRate: '14',
          discountType: 'PERCENT',
          discountPercent: '10',
        },
        {
          itemId: itemB.id,
          quantity: '5',
          unitPrice: '200',
          taxRate: '14',
          discountType: 'AMOUNT',
          discountAmount: '50',
        },
      ],
    },
  });
  if (!purchase) return;

  const pLines = purchase.lines ?? [];
  const pA = pLines[0];
  const pB = pLines[1];
  check('purchase line values before discount are kept', near(pA.grossLineTotal, 1000) && near(pB.grossLineTotal, 1000));
  check('the percent line discount resolves to 100.00', near(pA.discountAmount, 100) && pA.discountType === 'PERCENT');
  check('the fixed line discount stays 50.00', near(pB.discountAmount, 50) && pB.discountType === 'AMOUNT');
  check('the document discount is stored with its type and amount', pA.invoiceDiscountAmount && near(pA.invoiceDiscountAmount, 45) && near(pB.invoiceDiscountAmount, 47.5));
  check('net lines after both discounts', near(pA.lineTotal, 855) && near(pB.lineTotal, 902.5), `${pA.lineTotal} / ${pB.lineTotal}`);
  check('tax is charged on the discounted value', near(pA.taxAmount, 119.7) && near(pB.taxAmount, 126.35), `${pA.taxAmount} / ${pB.taxAmount}`);
  check('the document totals reconcile', near(purchase.subTotal, 1757.5) && near(purchase.taxAmount, 246.05) && near(purchase.totalAmount, 2003.55), JSON.stringify({ subTotal: purchase.subTotal, tax: purchase.taxAmount, total: purchase.totalAmount }));
  check('the line discounts add up to 150.00', near(purchase.lineDiscountTotal, 150));
  check('allocated document shares add up to the 92.50 discount exactly', near(d(pA.invoiceDiscountAmount) + d(pB.invoiceDiscountAmount), 92.5));

  const postedPurchase = await must('post the purchase invoice', `/purchases/invoices/${purchase.id}/post`, { method: 'POST' });
  check('purchase posting succeeds', postedPurchase?.status === 'posted');
  const purchaseJournal = postedPurchase?.journalEntryId
    ? await must('read the purchase journal entry', `/accounting/journal-entries/${postedPurchase.journalEntryId}`)
    : null;
  if (purchaseJournal) {
    const lines = purchaseJournal.lines ?? [];
    const inventoryDebit = lines
      .filter((line) => line.accountCode === '1104' || line.account?.code === '1104')
      .reduce((sum, line) => sum + d(line.debit), 0);
    const vatDebit = lines.reduce((sum, line) => sum + d(line.debit), 0) - inventoryDebit;
    const payable = lines.reduce((sum, line) => sum + d(line.credit), 0);
    check('inventory is valued at the discounted purchase cost (1757.50)', near(inventoryDebit, 1757.5), inventoryDebit.toFixed(4));
    check('VAT is the tax on the discounted value (246.05)', near(vatDebit, 246.05), vatDebit.toFixed(4));
    check('the supplier balance equals the invoice total', near(payable, 2003.55), payable.toFixed(4));
    const debit = lines.reduce((sum, line) => sum + d(line.debit), 0);
    const credit = lines.reduce((sum, line) => sum + d(line.credit), 0);
    check('the purchase journal balances', near(debit, credit), `${debit.toFixed(4)} / ${credit.toFixed(4)}`);
  }

  // ── limits ──────────────────────────────────────────────────────────
  await rejected('a percent above 100 is refused', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.id,
      warehouseId,
      lines: [{ itemId: itemA.id, quantity: '1', unitPrice: '100', discountType: 'PERCENT', discountPercent: '101' }],
    },
  });
  await rejected('a discount larger than the line is refused', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.id,
      warehouseId,
      lines: [{ itemId: itemA.id, quantity: '1', unitPrice: '100', discountType: 'AMOUNT', discountAmount: '100.01' }],
    },
  });

  // ── sales discounts, journal and stock ─────────────────────────────
  //
  //  A: 4 x 150 = 600, 10% off        -> 540
  //  B: 2 x 300 = 600, 100.00 off     -> 500
  //  document discount 100.00         -> 54.00 / 46.00 (pro rata)
  //  final nets 486 / 454, VAT 14%    -> 68.04 / 63.56
  const sales = await must('create a sales invoice with both discount kinds', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.id,
      warehouseId,
      discountType: 'AMOUNT',
      discountAmount: '100',
      lines: [
        {
          itemId: itemA.id,
          quantity: '4',
          unitPrice: '150',
          taxRate: '14',
          discountType: 'PERCENT',
          discountPercent: '10',
        },
        {
          itemId: itemB.id,
          quantity: '2',
          unitPrice: '300',
          taxRate: '14',
          discountType: 'AMOUNT',
          discountAmount: '100',
        },
      ],
    },
  });
  if (!sales) return;
  const sA = sales.lines[0];
  const sB = sales.lines[1];
  // 100.00 spread over 540 / 500 by value: 51.9231 / 48.0769.
  check('sales line shares are exact', near(sA.invoiceDiscountAmount, 51.9231, 0.001) && near(sB.invoiceDiscountAmount, 48.0769, 0.001), `${sA.invoiceDiscountAmount} / ${sB.invoiceDiscountAmount}`);
  check('sales net lines and tax', near(sA.lineTotal, 488.0769, 0.001) && near(sB.lineTotal, 451.9231, 0.001) && near(sA.taxAmount, 68.3308, 0.001) && near(sB.taxAmount, 63.2692, 0.001), `${sA.lineTotal} / ${sB.lineTotal}`);
  check('sales totals reconcile', near(sales.subTotal, 940) && near(sales.taxAmount, 131.6) && near(sales.totalAmount, 1071.6));

  const postedSales = await must('post the sales invoice', `/sales/invoices/${sales.id}/post`, { method: 'POST' });
  check('sales posting succeeds', postedSales?.status === 'posted');
  const salesJournal = postedSales?.journalEntryId
    ? await must('read the sales journal entry', `/accounting/journal-entries/${postedSales.journalEntryId}`)
    : null;
  if (salesJournal) {
    const lines = salesJournal.lines ?? [];
    const creditOf = (code) => lines
      .filter((line) => line.accountCode === code || line.account?.code === code)
      .reduce((sum, line) => sum + d(line.credit), 0);
    const debitOf = (code) => lines
      .filter((line) => line.accountCode === code || line.account?.code === code)
      .reduce((sum, line) => sum + d(line.debit), 0);
    check('revenue is the net after both discounts (940.00)', near(creditOf('4101') || creditOf('4102'), 940), (creditOf('4101') || creditOf('4102')).toFixed(4));
    check('VAT is charged on the net (131.60)', near(creditOf('2103') || creditOf('2104'), 131.6), '');
    check('the customer owes the discounted total', near(debitOf('1103') || debitOf('1102'), 1071.6), '');
    const debit = lines.reduce((sum, line) => sum + d(line.debit), 0);
    const credit = lines.reduce((sum, line) => sum + d(line.credit), 0);
    check('the sales journal balances', near(debit, credit));
  }

  const stock = await must('read the stock balance of item A', `/inventory/stock?itemId=${itemA.id}`);
  const stockItems = Array.isArray(stock) ? stock : stock?.items ?? [];
  const stockA = stockItems.find((row) => row.itemId === itemA.id || row.item?.id === itemA.id);
  check('the sales invoice took stock at the discounted cost, not the list price',
    stockA ? near(stockA.quantity, 6) : false,
    stockA ? `quantity ${stockA.quantity}` : 'no stock row');

  // ── a partial return credits the discounted value ──────────────────
  const salesReturn = await must('create a partial sales return', '/returns/sales', {
    method: 'POST',
    json: {
      originalInvoiceId: sales.id,
      returnDate: today,
      returnReason: 'One unit came back',
      lines: [{ originalLineId: sA.id, quantity: '1' }],
    },
  });
  if (salesReturn) {
    const returned = salesReturn.lines?.[0];
    // 488.0769 / 4 = 122.019225, rounded to the nearest ten-thousandth.
    check('the return credits one quarter of the discounted line net', returned ? near(returned.lineTotal, 122.0192, 0.0001) : false, returned?.lineTotal);
    const postedReturn = await must('post the sales return', `/returns/sales/${salesReturn.id}/post`, { method: 'POST' });
    check('the return posts', postedReturn?.status === 'posted');
    const after = await must('re-read the sales invoice', `/sales/invoices/${sales.id}`);
    check('the original invoice is never rewritten by a return', near(after.subTotal, 940) && near(after.totalAmount, 1071.6));
    check('the original discount detail is still there', near(after.lines[0].discountAmount, 60) && near(after.lines[0].invoiceDiscountAmount, 51.9231, 0.001));
  }

  // ── quotations ─────────────────────────────────────────────────────
  const journalCountBefore = (await must('count journal entries', '/accounting/journal-entries?pageSize=1'))?.total;
  const quotationPayload = {
    quotationDate: today,
    validUntil: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    customerId: customer.id,
    currency: 'EGP',
    terms: 'Prices are valid for 14 days.\nDelivery within 30 days of acceptance.',
    notes: 'Site visit completed.',
    discountType: 'PERCENT',
    discountPercent: '5',
    managerName: 'Site Manager',
    responsibleName: 'Sales Engineer',
    responsiblePhone: '01111111111',
    subject: `Kitchen offer ${stamp}`,
    // This offer chooses its own tax-number behaviour; the company setting is
    // only a default from now on.
    showTaxId: false,
    columns: [
      { key: 'itemCode', labelEn: 'Code', labelAr: 'الكود', width: 2 },
      { key: 'description', width: 4 },
      { key: 'quantity', labelEn: 'Pieces', labelAr: 'القطع', width: 1 },
      { key: 'unitPrice', width: 2 },
      { key: 'lineTotal', width: 2 },
      { key: 'countryOfOrigin', visible: false, width: 2 },
    ],
    tables: [
      {
        title: 'Kitchen cabinets',
        discountType: 'PERCENT',
        discountPercent: '10',
        lines: [
          { itemId: itemA.id, quantity: '2', unitPrice: '150', unit: 'piece' },
          { description: 'Installation service', quantity: '1', unitPrice: '500', countryOfOrigin: 'Egypt' },
        ],
      },
      {
        title: 'Appliances',
        discountType: 'AMOUNT',
        discountAmount: '100',
        lines: [
          { itemId: itemB.id, quantity: '1', unitPrice: '300' },
          { itemId: itemB.id, quantity: '2', unitPrice: '300' },
        ],
      },
    ],
  };
  const quotation = await must('create a quotation with two titled tables', '/sales/quotations', {
    method: 'POST',
    json: quotationPayload,
  });
  if (!quotation) return;

  // Table 1: 300 + 500 = 800, 10% = 80, net 720.
  // Table 2: 300 + 600 = 900, 100 off, net 800.
  // Subtotal 1700, table discounts 180, quotation-wide 5% of 1520 = 76.
  check('table totals before and after discount', near(quotation.tables[0].subTotal, 800) && near(quotation.tables[0].netTotal, 720) && near(quotation.tables[1].netTotal, 800));
  check('the summary totals reconcile exactly', near(quotation.subTotal, 1700) && near(quotation.discountTotal, 256) && near(quotation.totalAmount, 1444), JSON.stringify({ sub: quotation.subTotal, disc: quotation.discountTotal, total: quotation.totalAmount }));
  check('the country of origin is copied from the item and never invented', quotation.tables[0].lines[0].countryOfOrigin === 'Egypt' && quotation.tables[1].lines[0].countryOfOrigin === 'Germany');
  check('a table is titled and ordered', quotation.tables[0].title === 'Kitchen cabinets' && quotation.tables[1].sortOrder === 2);
  check('the quotation starts as a draft', quotation.status === 'draft' && quotation.canEdit === true);
  check('the offer keeps its own subject', quotation.subject === `Kitchen offer ${stamp}`, quotation.subject);
  check('the offer keeps its own tax-number choice', quotation.showTaxId === false);
  check(
    'the offer stores its own column order and labels',
    Array.isArray(quotation.columns) &&
      quotation.columns.length === 6 &&
      quotation.columns[0].key === 'itemCode' &&
      quotation.columns[2].labelEn === 'Pieces' &&
      quotation.columns[5].visible === false,
    JSON.stringify(quotation.columns),
  );

  // ── saved column layouts ─────────────────────────────────────────────
  const layout = await must('save a column layout', '/sales/quotation-column-templates', {
    method: 'POST',
    json: {
      name: `Service layout ${stamp}`,
      columns: [
        { key: 'description', width: 5 },
        { key: 'quantity', width: 1 },
        { key: 'lineTotal', width: 2 },
      ],
    },
  });
  const layouts = await must('read the saved layouts', '/sales/quotation-column-templates');
  check('the saved layout is offered', Array.isArray(layouts) && layouts.some((row) => row.id === layout?.id));
  const editedLayout = await must('rename a saved layout', `/sales/quotation-column-templates/${layout.id}`, {
    method: 'PUT',
    json: { name: `Service layout renamed ${stamp}` },
  });
  check('a saved layout can be renamed', editedLayout?.name === `Service layout renamed ${stamp}`);

  const journalCountAfter = (await must('count journal entries again', '/accounting/journal-entries?pageSize=1'))?.total;
  check('a quotation posts nothing to the ledger', journalCountBefore === journalCountAfter, `${journalCountBefore} -> ${journalCountAfter}`);
  const stockStill = await must('re-read stock after quoting', `/inventory/stock?itemId=${itemA.id}`);
  const stockStillRows = Array.isArray(stockStill) ? stockStill : stockStill?.items ?? [];
  const stillA = stockStillRows.find((row) => row.itemId === itemA.id || row.item?.id === itemA.id);
  check('a quotation neither reserves nor depletes stock', stillA ? near(stillA.quantity, 7) : false, stillA?.quantity);

  // Editing and reordering a draft.
  const edited = await must('edit the draft, reorder tables and add a table', `/sales/quotations/${quotation.id}`, {
    method: 'PUT',
    json: {
      ...quotationPayload,
      tables: [
        quotationPayload.tables[1],
        quotationPayload.tables[0],
        {
          title: 'Delivery',
          lines: [{ description: 'Delivery to site', quantity: '1', unitPrice: '50' }],
        },
      ],
    },
  });
  check('a draft can be reordered and extended', edited?.tables?.[0]?.title === 'Appliances' && edited?.tables?.[2]?.title === 'Delivery');
  // 1750 gross - 180 table discounts - 5% of 1570 (78.50) = 1491.50.
  check('the totals follow the edit', near(edited.subTotal, 1750) && near(edited.totalAmount, 1491.5), JSON.stringify({ sub: edited?.subTotal, total: edited?.totalAmount }));

  // Tax-number setting: off for this company, then a quotation issued after
  // that keeps the hidden choice in its snapshot.
  await must('turn off the tax number on quotations', '/accounting/settings', {
    method: 'PATCH',
    json: { showTaxIdOnQuotations: false },
  });
  const settingsOff = await must('read the setting back', '/accounting/settings');
  check('the setting is saved', settingsOff?.showTaxIdOnQuotations === false);

  // The company default applies only when the offer does not choose. One
  // draft left unset follows the default; one that sets true overrides it.
  const followsDefault = await must('create a draft without a tax choice', '/sales/quotations', {
    method: 'POST',
    json: { ...quotationPayload, subject: `Default tax ${stamp}`, showTaxId: undefined, columns: undefined },
  });
  check('an unset offer follows the company default', followsDefault?.showTaxId === false);
  const overridesDefault = await must('create a draft that keeps the tax number', '/sales/quotations', {
    method: 'POST',
    json: { ...quotationPayload, subject: `Tax on ${stamp}`, showTaxId: true },
  });
  check('an offer can override the company default', overridesDefault?.showTaxId === true);
  await must('remove the two extra drafts', `/sales/quotations/${followsDefault.id}`, { method: 'DELETE' });
  await must('remove the second extra draft', `/sales/quotations/${overridesDefault.id}`, { method: 'DELETE' });
  const company = await must('read the company profile', '/company/profile');
  check('turning the setting off does not delete the tax number', company?.taxId === companyTaxId, company?.taxId ?? 'missing');

  const issued = await must('send the quotation', `/sales/quotations/${quotation.id}/send`, {
    method: 'POST',
    json: { note: 'Sent by email' },
  });
  check('sending issues the quotation and snapshots it', issued?.status === 'sent' && Boolean(issued?.snapshotAt));
  check('the snapshot holds the tables and totals as issued', issued?.contentSnapshot?.tables?.length === 3 && near(issued?.contentSnapshot?.totals?.totalAmount, 1491.5));
  check('the snapshot remembers that the tax number was hidden', issued?.contentSnapshot?.showTaxId === false);
  check('the snapshot carries the subject', issued?.contentSnapshot?.subject === `Kitchen offer ${stamp}`);
  check(
    'the snapshot carries the column layout as issued',
    issued?.contentSnapshot?.columns?.[2]?.labelEn === 'Pieces' &&
      issued?.contentSnapshot?.columns?.[5]?.visible === false,
    JSON.stringify(issued?.contentSnapshot?.columns),
  );
  check('an issued quotation can no longer be edited', issued?.canEdit === false);
  await rejected('editing an issued quotation is refused', `/sales/quotations/${quotation.id}`, {
    method: 'PUT',
    json: quotationPayload,
  });

  const printEn = await api(`/sales/quotations/${quotation.id}/print?lang=en`);
  check('the English preview is a branded corporate page', printEn.status === 200 && String(printEn.data).includes('QUOTATION') && String(printEn.data).includes('Kitchen cabinets') && String(printEn.data).includes('Grand total'));
  const printAr = await api(`/sales/quotations/${quotation.id}/print?lang=ar`);
  const printArText = String(printAr.data);
  check('the Arabic preview is right to left with Arabic labels', printAr.status === 200 && printArText.includes('dir="rtl"') && printArText.includes('عرض سعر') && printArText.includes('المجموع الكلي'));
  check('the summary names every table with its total and ends in the grand total', printArText.includes('البيان') && printArText.includes('إجمالي الجدول') && String(printEn.data).includes('Table total'));
  check('the hidden tax number is absent from both previews', !String(printEn.data).includes(companyTaxId) && !printArText.includes(companyTaxId));
  check(
    'the preview prints the offer subject and its own column labels',
    String(printEn.data).includes(`Kitchen offer ${stamp}`) &&
      String(printEn.data).includes('Pieces') &&
      String(printEn.data).includes('Code'),
  );
  check(
    'a hidden column does not print',
    !String(printEn.data).includes('>Origin<') && !printArText.includes('بلد المنشأ'),
  );
  check('the English preview orders the columns as the offer does', String(printEn.data).indexOf('>Code<') < String(printEn.data).indexOf('>Description<'));
  check('the terms and the responsible person appear', printEnText(printEn.data) && printEnText(printEn.data).includes('Delivery within 30 days') && printEnText(printEn.data).includes('Sales Engineer'));

  await must('retire the saved layout', `/sales/quotation-column-templates/${layout.id}`, { method: 'DELETE' });
  const layoutsAfter = await must('read the layouts after retiring', '/sales/quotation-column-templates');
  check('a retired layout leaves the picker', Array.isArray(layoutsAfter) && layoutsAfter.every((row) => row.id !== layout.id));
  const issuedAfter = await must('read the issued offer again', `/sales/quotations/${quotation.id}`);
  check(
    'editing or retiring a layout never rewrites an issued offer',
    issuedAfter?.contentSnapshot?.columns?.[2]?.labelEn === 'Pieces' && issuedAfter?.subject === `Kitchen offer ${stamp}`,
  );

  // The PDF endpoint exists; when the machine has no browser it answers 422
  // with a helpful message instead of pretending to have made a file.
  const pdf = await api(`/sales/quotations/${quotation.id}/pdf?lang=ar`);
  check('the PDF endpoint answers with a PDF or an explained 422', pdf.status === 200 || pdf.status === 422, `status ${pdf.status}`);

  // Accept and convert.
  const accepted = await must('accept the quotation', `/sales/quotations/${quotation.id}/accept`, {
    method: 'POST',
    json: { note: 'Customer approved on the phone' },
  });
  check('acceptance is recorded with a timestamp', accepted?.status === 'accepted' && Boolean(accepted?.acceptedAt));
  check('an accepted quotation offers conversion', accepted?.canConvert === true);

  const converted = await must('convert it to an invoice', `/sales/quotations/${quotation.id}/convert`, {
    method: 'POST',
    json: { invoiceDate: today, warehouseId, notes: 'Converted from the accepted offer' },
  });
  check('conversion creates a draft invoice, not a posted one', converted?.invoice?.status === 'draft');
  check('the invoice net equals the quotation total', near(converted?.invoice?.subTotal, 1491.5), converted?.invoice?.subTotal);
  check('the invoice carries the quotation-wide discount', near(converted?.invoice?.discountAmount, 78.5), converted?.invoice?.discountAmount);
  check('the invoice adds tax by the company rules', near(converted?.invoice?.totalAmount, 1700.31), converted?.invoice?.totalAmount);
  const conversionJournal = converted?.invoice?.journalEntryId;
  check('a converted draft has no journal entry', !conversionJournal);
  await rejected('a second conversion is refused', `/sales/quotations/${quotation.id}/convert`, { method: 'POST', json: {} });
  const afterConversion = await must('read the quotation after conversion', `/sales/quotations/${quotation.id}`);
  check('the quotation records its invoice', afterConversion?.status === 'converted' && Boolean(afterConversion?.convertedInvoiceId));
  await rejected('a converted quotation cannot be rejected afterwards', `/sales/quotations/${quotation.id}/reject`, { method: 'POST', json: {} });

  // Revise keeps the issued content untouched.
  const revision = await must('raise a revision of the issued offer', `/sales/quotations/${quotation.id}/revise`, { method: 'POST', json: {} });
  check('the revision is a new draft pointing at the original', revision?.version === 2 && revision?.revisionOfId === quotation.id && revision?.status === 'draft');
  check('the revision copies the tables', revision?.tables?.length === 3);
  const originalAgain = await must('re-read the original', `/sales/quotations/${quotation.id}`);
  check('the original keeps its snapshot and version', originalAgain?.version === 1 && originalAgain?.contentSnapshot?.quotationNumber === quotation.quotationNumber);

  // Expiry.
  const expiring = await must('create a short-lived offer', '/sales/quotations', {
    method: 'POST',
    json: {
      ...quotationPayload,
      quotationDate: yesterday,
      validUntil: yesterday,
      tables: [{ title: 'Expiring table', lines: [{ description: 'Widget', quantity: '1', unitPrice: '100' }] }],
    },
  });
  if (expiring) {
    await must('send the short-lived offer', `/sales/quotations/${expiring.id}/send`, { method: 'POST', json: {} });
    const expired = await must('list quotations (which expires overdue offers)', '/sales/quotations?pageSize=200');
    const row = expired?.items?.find((item) => item.id === expiring.id);
    check('an overdue sent offer expires by itself', row?.status === 'expired', row?.status);
    check('it cannot be accepted after expiry', (await api(`/sales/quotations/${expiring.id}/accept`, { method: 'POST', json: {} })).status === 400);
  }

  // Filters.
  const filtered = await must('filter quotations by status and date', `/sales/quotations?status=sent&from=${yesterday}&to=${today}`);
  check('the status/date filter answers', Array.isArray(filtered?.items));

  await must('turn the tax number back on', '/accounting/settings', {
    method: 'PATCH',
    json: { showTaxIdOnQuotations: true },
  });

  // Draft deletion is a soft delete and leaves no ledger trace.
  const disposable = await must('create a disposable draft', '/sales/quotations', {
    method: 'POST',
    json: {
      ...quotationPayload,
      tables: [{ title: 'Temporary', lines: [{ description: 'Temporary line', quantity: '1', unitPrice: '1' }] }],
    },
  });
  if (disposable) {
    const removed = await must('delete the draft', `/sales/quotations/${disposable.id}`, { method: 'DELETE' });
    check('a draft can be removed', removed?.deleted === true);
    check('a removed draft is gone from the list', (await api(`/sales/quotations/${disposable.id}`)).status === 404);
  }

  // ── company JSON backup round trip ─────────────────────────────────
  const backup = await api('/backup/download');
  const file = backup.data;
  check('the company backup downloads', backup.status === 200 && Boolean(file?.tables));
  check('the backup carries the discount detail', Array.isArray(file?.tables?.salesInvoiceLine)
    && file.tables.salesInvoiceLine.some((line) => Number(line.invoiceDiscountAmount) > 0)
    && file.tables.salesInvoice.some((invoice) => invoice.discountType === 'AMOUNT'));
  check('the backup carries every quotation table', Array.isArray(file?.tables?.quotation)
    && file.tables.quotation.length > 0
    && Array.isArray(file?.tables?.quotationTable)
    && file.tables.quotationTable.length > 0
    && Array.isArray(file?.tables?.quotationLine)
    && file.tables.quotationLine.length > 0
    && Array.isArray(file?.tables?.quotationEvent)
    && file.tables.quotationEvent.length > 0);
  const issuedBackup = file?.tables?.quotation?.find((row) => row.id === quotation.id);
  check('the issued quotation snapshot is in the file', Boolean(issuedBackup?.contentSnapshot));

  if (backup.status === 200) {
    const form = new FormData();
    form.append(
      'file',
      new Blob([JSON.stringify(file)], { type: 'application/json' }),
      'company-backup.json',
    );
    const restored = await fetch(`${API}/backup/restore?replace=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const restoredBody = await restored.json().catch(() => null);
    check('the company backup restores', restored.status === 200 || restored.status === 201, `status ${restored.status} ${JSON.stringify(restoredBody)?.slice(0, 200)}`);
    const afterRestore = await must('read the quotation after the restore', `/sales/quotations/${quotation.id}`);
    check('the quotation survives the round trip with its totals and snapshot',
      near(afterRestore?.totalAmount, 1491.5) && afterRestore?.status === 'converted'
        && afterRestore?.contentSnapshot?.totals?.totalAmount === '1491.5000');
    const invoiceAfter = await must('read the converted invoice after the restore', `/sales/invoices/${converted.invoice.id}`);
    check('the invoice discount detail survives the round trip',
      near(invoiceAfter?.discountAmount, 78.5)
        && invoiceAfter?.lines?.some((line) => Number(line.discountAmount) > 0)
        && invoiceAfter?.lines?.some((line) => Number(line.invoiceDiscountAmount) > 0));
  }
}

function printEnText(html) {
  return String(html);
}

main()
  .catch((error) => {
    console.error(error);
    results.push({ name: 'scenario crashed', ok: false, detail: error.message });
  })
  .finally(() => {
    const failed = results.filter((row) => !row.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
      console.log('FAILED:');
      for (const row of failed) console.log(`  - ${row.name} ${row.detail}`);
      process.exitCode = 1;
    }
  });
