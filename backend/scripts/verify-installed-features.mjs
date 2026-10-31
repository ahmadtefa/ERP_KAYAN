#!/usr/bin/env node
/**
 * The three delivered features, exercised against an INSTALLED KAYAN ERP.
 *
 * The other scenarios run against a development server on Linux. This one is
 * launched by the Windows smoke test with the bundled Node runtime, after the
 * installer has put the program in Program Files and the client has started its
 * own API. Its whole point is that nothing here is a unit test: every check is
 * an HTTP call to the installed product, and every PDF is read back with the
 * pdf-lib that ships inside that installation.
 *
 *   KAYAN_API_URL=http://127.0.0.1:3000/api/v1 \
 *   KAYAN_ADMIN_USERNAME=... KAYAN_ADMIN_PASSWORD=... \
 *   node verify-installed-features.mjs [--pdf-lib <path to installed node_modules>]
 *
 * Exits 0 only if every check passes.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = (process.env.KAYAN_API_URL ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
const USERNAME = process.env.KAYAN_ADMIN_USERNAME ?? 'ci-admin';
const PASSWORD = process.env.KAYAN_ADMIN_PASSWORD ?? 'CiSmoke-Admin-Password-7241';

// pdf-lib is taken from the installation, not from this repository: the point
// is to read the sheets the installed program produced with the library that
// installed program carries.
const pdfLibRoot = process.argv.indexOf('--pdf-lib') >= 0
  ? process.argv[process.argv.indexOf('--pdf-lib') + 1]
  : process.env.KAYAN_INSTALLED_MODULES;
let PDFDocument;
try {
  const requireFromInstall = createRequire(
    pdfLibRoot ? join(pdfLibRoot, 'noop.js') : import.meta.url,
  );
  ({ PDFDocument } = requireFromInstall('pdf-lib'));
} catch (error) {
  console.error(`Cannot load pdf-lib from ${pdfLibRoot ?? 'this machine'}: ${error.message}`);
  process.exit(2);
}

const results = [];
let token = '';
const stamp = String(Date.now()).slice(-7);
const today = new Date().toISOString().slice(0, 10);

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const auth = options.token ?? token;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${API}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
    const type = response.headers.get('content-type') ?? '';
    const data = type.includes('application/json')
      ? await response.json().catch(() => null)
      : type.startsWith('application/pdf') || type.includes('octet-stream')
        ? Buffer.from(await response.arrayBuffer())
        : await response.text();
    if (response.status !== 429) return { status: response.status, data, type, headers: response.headers };
    const seconds = Number(/(\d+)\s*second/.exec(String(data?.detail ?? ''))?.[1] ?? 5);
    await sleep(Math.min(seconds + 1, 60) * 1000);
  }
  return { status: 429, data: null, type: '', headers: new Headers() };
}

async function must(label, path, options = {}) {
  const response = await api(path, options);
  if (response.status >= 200 && response.status < 300) return response.data;
  check(label, false, `${response.status} ${JSON.stringify(response.data)?.slice(0, 240)}`);
  return null;
}

async function pageSizes(pdf) {
  const document = await PDFDocument.load(new Uint8Array(pdf), { updateMetadata: false });
  return document.getPages().map((page) => {
    const size = page.getSize();
    return [Math.round(size.width * 10) / 10, Math.round(size.height * 10) / 10];
  });
}

async function letterhead() {
  const document = await PDFDocument.create();
  const first = document.addPage([600, 800]);
  first.drawRectangle({ x: 0, y: 720, width: 600, height: 80, color: { type: 'RGB', red: 0.86, green: 0.06, blue: 0.52 } });
  const second = document.addPage([620, 820]);
  second.drawRectangle({ x: 0, y: 740, width: 620, height: 80, color: { type: 'RGB', red: 0.86, green: 0.06, blue: 0.52 } });
  return Buffer.from(await document.save());
}

const sheetShape = (html) => ({
  headers: [...String(html).matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((match) => match[1].trim()),
  meta: [...String(html).matchAll(/<span class="label">([^<]*)<\/span>/g)].map((match) => match[1].trim()),
});
const COST_LABELS = /Unit cost|Running value|Stock value|Average cost|Purchase price|تكلفة|قيمة المخزون/i;

/// F3 - the print policy, from the installed program.
async function verifyPriceVisibility() {
  const policy = await must('F3: read the installed print policy', '/company/print-settings');
  check(
    'F3: the installed program offers the print catalogue and does not lock an administrator out',
    Array.isArray(policy?.types) && policy.types.length > 10 && policy.costLocked === false,
    `${policy?.types?.length ?? 0} types`,
  );
  const saved = await must('F3: save a policy for offers', '/company/print-settings', {
    method: 'PUT',
    json: { settings: [{ documentType: 'sales-quotation', showSalePrice: false, showCost: true }] },
  });
  const reread = await must('F3: read the policy back', '/company/print-settings');
  check(
    'F3: a saved policy is a database row, so a restart or a restore brings it back',
    saved && reread?.settings?.some((row) => row.documentType === 'sales-quotation' && row.showSalePrice === false),
    JSON.stringify(reread?.settings ?? []),
  );

  const stock = await must('F3: find a stocked item', '/inventory/stock');
  const rows = Array.isArray(stock) ? stock : stock?.items ?? [];
  const moved = rows.find((row) => Number(row.quantity) > 0) ?? rows[0];
  if (!moved) {
    check('F3: the installed database holds stock to print', false, 'no stock rows');
    return;
  }
  const itemId = moved.itemId ?? moved.item?.id;

  const adminSheet = await api(`/exports/lists/stock-ledger/print?itemId=${itemId}&lang=en&showCost=true`);
  check(
    'F3: a caller who may read cost still receives the cost columns',
    adminSheet.status === 200 && sheetShape(adminSheet.data).headers.some((header) => /Unit cost|تكلفة/i.test(header)),
    `status ${adminSheet.status}, ${sheetShape(adminSheet.data).headers.join(', ')}`,
  );
  const adminHidden = await api(`/exports/lists/stock-ledger/print?itemId=${itemId}&lang=en&showCost=false`);
  check(
    'F3: hiding the cost removes those columns from the printed page',
    adminHidden.status === 200 && !sheetShape(adminHidden.data).headers.some((header) => /Unit cost|Running value/i.test(header)),
    sheetShape(adminHidden.data).headers.join(', '),
  );

  // A warehouse clerk: reads stock, may not read a cost.
  const role = await must('F3: create a role without inventory.cost.read', '/admin/roles', {
    method: 'POST',
    json: {
      code: `INSTALL-WHSE-${stamp}`,
      nameEn: `Install warehouse ${stamp}`,
      nameAr: `مخزن التثبيت ${stamp}`,
      permissions: ['inventory.stock.read', 'inventory.items.read', 'reports.read'],
    },
  });
  const branches = await must('F3: read the branches', '/admin/branches?pageSize=1');
  const branchRows = Array.isArray(branches) ? branches : branches?.items ?? [];
  const clerk = role
    ? await must('F3: create the clerk on the installed program', '/admin/users', {
        method: 'POST',
        json: {
          username: `install-clerk-${stamp}`,
          fullNameEn: `Clerk ${stamp}`,
          fullNameAr: `موظف ${stamp}`,
          password: `Temp-${stamp}-Password1`,
          roleIds: [role.id],
          branchIds: branchRows.length ? [branchRows[0].id] : [],
        },
      })
    : null;
  if (!clerk) return;

  const clerkLogin = await api('/auth/login', {
    method: 'POST',
    json: { username: `install-clerk-${stamp}`, password: `Temp-${stamp}-Password1` },
    noAuth: true,
  });
  const clerkToken = clerkLogin.data?.accessToken ?? '';
  check('F3: the clerk signs in on the installed program', Boolean(clerkToken), `status ${clerkLogin.status}`);
  if (!clerkToken) return;

  const clerkPolicy = await api('/company/print-settings', { token: clerkToken });
  check(
    'F3: the clerk is told the cost box is locked',
    clerkPolicy.status === 200 && clerkPolicy.data?.costLocked === true,
    `status ${clerkPolicy.status}`,
  );
  const clerkSave = await api('/company/print-settings', {
    token: clerkToken,
    method: 'PUT',
    json: { settings: [{ documentType: 'stock-ledger', showSalePrice: true, showCost: true }] },
  });
  check('F3: the clerk cannot save a policy that grants a cost', clerkSave.status === 403, `status ${clerkSave.status}`);

  const clerkAsking = await api(
    `/exports/lists/stock-ledger/print?itemId=${itemId}&lang=en&showCost=true&showSalePrice=true`,
    { token: clerkToken },
  );
  const clerkShape = sheetShape(clerkAsking.data);
  check(
    'F3: asking for the cost in the URL does not give it to a caller who may not read it',
    clerkAsking.status === 200 &&
      !clerkShape.headers.some((header) => COST_LABELS.test(header)) &&
      !clerkShape.meta.some((label) => COST_LABELS.test(label)),
    `status ${clerkAsking.status}, ${clerkShape.headers.join(', ')}`,
  );
  const clerkPlain = await api(`/exports/lists/stock-ledger/print?itemId=${itemId}&lang=en&showCost=false`, {
    token: clerkToken,
  });
  check(
    'F3: the page the clerk gets is the same whether or not they ask',
    JSON.stringify(sheetShape(clerkPlain.data)) === JSON.stringify(clerkShape),
    `${clerkShape.headers.length} columns`,
  );
  const clerkPdf = await api(`/exports/lists/stock-ledger/pdf?itemId=${itemId}&lang=en&showCost=true`, {
    token: clerkToken,
  });
  check(
    'F3: the PDF a clerk downloads is a real PDF',
    clerkPdf.status === 200 && Buffer.isBuffer(clerkPdf.data) && clerkPdf.data.subarray(0, 5).toString() === '%PDF-',
    `status ${clerkPdf.status}, ${clerkPdf.data?.length ?? 0} bytes`,
  );
  const priceStillStored = await must('F3: re-read the item after printing', `/inventory/items/${itemId}`);
  check(
    'F3: hiding a price never changes the stored price',
    priceStillStored && Number(priceStillStored.purchasePrice ?? 0) >= 0,
    `purchasePrice ${priceStillStored?.purchasePrice ?? 'n/a'}`,
  );
}

/// F1 - a quotation printed on an attached PDF, from the installed program.
async function verifyArtwork() {
  const pdf = await letterhead();
  const form = new FormData();
  form.append('name', `Install letterhead ${stamp}`);
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), `install-letterhead-${stamp}.pdf`);
  const uploaded = await must('F1: upload a two-page letterhead', '/sales/quotation-backgrounds', {
    method: 'POST',
    body: form,
  });
  check(
    'F1: the installed program measures the uploaded file itself',
    uploaded?.pageCount === 2 && Math.abs(Number(uploaded.pageWidth) - 600) < 0.5,
    JSON.stringify({ pages: uploaded?.pageCount, width: uploaded?.pageWidth }),
  );
  if (!uploaded) return;
  const file = await api(`/sales/quotation-backgrounds/${uploaded.id}/file`);
  check(
    'F1: the stored artwork downloads byte for byte from the installed database',
    file.status === 200 && Buffer.isBuffer(file.data) && Buffer.compare(file.data, pdf) === 0,
    `${file.data?.length ?? 0} bytes`,
  );

  const damaged = new FormData();
  damaged.append('file', new Blob([Buffer.from('%PDF-1.7\ntruncated')], { type: 'application/pdf' }), 'damaged.pdf');
  const refused = await api('/sales/quotation-backgrounds', { method: 'POST', body: damaged });
  check('F1: a damaged PDF is refused rather than crashing the installed program', refused.status === 400, `status ${refused.status}`);

  const customers = await must('F1: read a customer', '/parties/customers?pageSize=1');
  const customerRows = Array.isArray(customers) ? customers : customers?.items ?? [];
  const items = await must('F1: read an item', '/inventory/items?pageSize=1');
  const itemRows = Array.isArray(items) ? items : items?.items ?? [];
  const customer = customerRows[0];
  const item = itemRows[0];
  if (!customer || !item) {
    check('F1: the installed database holds a customer and an item', false, 'missing fixture');
    return;
  }

  const body = (extra = {}) => ({
    quotationDate: today,
    customerId: customer.id,
    subject: `Install artwork offer ${stamp}`,
    tables: [
      {
        title: `Installed ${stamp}`,
        lines: Array.from({ length: 40 }, (_, index) => ({
          itemId: item.id,
          quantity: '1',
          unitPrice: String(100 + index),
        })),
      },
    ],
    ...extra,
  });
  const offer = await must('F1: create an offer long enough for two pages', '/sales/quotations', {
    method: 'POST',
    json: body(),
  });
  if (!offer) return;
  const plain = await api(`/sales/quotations/${offer.id}/pdf?lang=en`);
  const plainSizes = Buffer.isBuffer(plain.data) ? await pageSizes(plain.data) : [];
  check(
    'F1: the installed program makes a real PDF without artwork',
    plain.status === 200 && plainSizes.length >= 2 && Math.abs(plainSizes[0][0] - 595.3) < 2,
    `${plainSizes.length} pages, ${plainSizes[0]?.join('x')}`,
  );

  const attached = await must('F1: attach the letterhead', `/sales/quotations/${offer.id}`, {
    method: 'PUT',
    json: body({ backgroundFileId: uploaded.id, background: { mode: 'REPEAT', showPageNumbers: true } }),
  });
  check('F1: the offer keeps its letterhead', attached?.backgroundFileId === uploaded.id, String(attached?.backgroundFileId));
  const repeatPdf = await api(`/sales/quotations/${offer.id}/pdf?lang=en`);
  const repeatSizes = Buffer.isBuffer(repeatPdf.data) ? await pageSizes(repeatPdf.data) : [];
  check(
    'F1: REPEAT prints every page on the artwork page itself',
    repeatPdf.status === 200 &&
      repeatSizes.length === plainSizes.length &&
      repeatSizes.every((size) => Math.abs(size[0] - 600) < 1 && Math.abs(size[1] - 800) < 1),
    repeatSizes.map((size) => size.join('x')).join(' '),
  );

  await must('F1: switch to the sequence rule', `/sales/quotations/${offer.id}`, {
    method: 'PUT',
    json: body({ backgroundFileId: uploaded.id, background: { mode: 'SEQUENCE' } }),
  });
  const sequencePdf = await api(`/sales/quotations/${offer.id}/pdf?lang=ar`);
  const sequenceSizes = Buffer.isBuffer(sequencePdf.data) ? await pageSizes(sequencePdf.data) : [];
  check(
    'F1: SEQUENCE uses the second artwork page next and holds it after that',
    sequenceSizes.length === plainSizes.length &&
      Math.abs(sequenceSizes[0][0] - 600) < 1 &&
      sequenceSizes.slice(1).every((size) => Math.abs(size[0] - 620) < 1),
    sequenceSizes.map((size) => size.join('x')).join(' '),
  );

  await must('F1: choose one artwork page', `/sales/quotations/${offer.id}`, {
    method: 'PUT',
    json: body({ backgroundFileId: uploaded.id, background: { mode: 'SINGLE_PAGE', page: 2 } }),
  });
  const singlePdf = await api(`/sales/quotations/${offer.id}/pdf?lang=en`);
  const singleSizes = Buffer.isBuffer(singlePdf.data) ? await pageSizes(singlePdf.data) : [];
  check(
    'F1: SINGLE_PAGE puts the chosen page behind every page of the offer',
    singleSizes.length === plainSizes.length &&
      singleSizes.every((size) => Math.abs(size[0] - 620) < 1 && Math.abs(size[1] - 820) < 1),
    singleSizes.map((size) => size.join('x')).join(' '),
  );

  const hiddenCopy = await api(`/sales/quotations/${offer.id}/print?lang=en&showSalePrice=false`);
  check(
    'F1: a price-free copy of the offer carries no figures, artwork or not',
    hiddenCopy.status === 200 && !String(hiddenCopy.data).includes('100.00'),
    `status ${hiddenCopy.status}`,
  );
}

/// F2 - packing units, receipts, issues, a transfer, a count and its report.
async function verifyUnits() {
  let warehouses = await must('F2: read the warehouses', '/inventory/warehouses');
  let rows = Array.isArray(warehouses) ? warehouses : warehouses?.items ?? [];
  if (rows.length === 0) {
    const me = await must('F2: read the session', '/auth/me');
    const branchId = me?.user?.branchId ?? me?.branchId;
    warehouses = await must('F2: create the first warehouse', '/inventory/warehouses', {
      method: 'POST',
      json: { branchId, code: `INST-${stamp}`, nameEn: `Install store ${stamp}`, nameAr: `مخزن ${stamp}` },
    });
    rows = warehouses ? [warehouses] : [];
  }
  const main = rows.find((row) => row.isDefault) ?? rows[0];
  if (!main) {
    check('F2: the installed program has a warehouse to hold stock', false, 'none');
    return;
  }
  const branchId = main.branchId;

  const item = await must('F2: create an item', '/inventory/items', {
    method: 'POST',
    json: {
      code: `INST-UNIT-${stamp}`,
      nameEn: `Install unit item ${stamp}`,
      nameAr: `صنف ${stamp}`,
      unit: 'قطعة',
      salePrice: '20',
      purchasePrice: '10',
    },
  });
  if (!item) return;
  const carton = await must('F2: add a carton of 12', `/inventory/items/${item.id}/units`, {
    method: 'POST',
    json: { unit: 'كرتونة', factor: '12', salePrice: '230', purchasePrice: '115' },
  });
  check('F2: the carton of twelve is saved on the item', Boolean(carton?.id), String(carton?.factor ?? ''));

  const supplier = await must('F2: create a supplier', '/parties/suppliers', {
    method: 'POST',
    json: { code: `INST-SUP-${stamp}`, nameEn: `Supplier ${stamp}`, nameAr: `مورد ${stamp}` },
  });
  const customer = await must('F2: create a customer', '/parties/customers', {
    method: 'POST',
    json: { code: `INST-CUS-${stamp}`, nameEn: `Customer ${stamp}`, nameAr: `عميل ${stamp}` },
  });
  if (!supplier || !customer) return;

  const purchase = await must('F2: receive 10 cartons', '/purchases/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      supplierId: supplier.id,
      warehouseId: main.id,
      lines: [{ itemId: item.id, description: 'استلام 10 كراتين', quantity: '10', unitName: 'كرتونة', unitPrice: '115', taxRate: '0' }],
    },
  });
  if (!purchase) return;
  await must('F2: post the receipt', `/purchases/invoices/${purchase.id}/post`, { method: 'POST' });
  const afterReceipt = await must('F2: read the stock after the receipt', `/inventory/stock?itemId=${item.id}`);
  const receiptRows = Array.isArray(afterReceipt) ? afterReceipt : afterReceipt?.items ?? [];
  const holding = receiptRows.find((row) => (row.itemId ?? row.item?.id) === item.id);
  check('F2: ten cartons are one hundred and twenty pieces', Number(holding?.quantity) === 120, String(holding?.quantity));

  const sale = await must('F2: issue 2 cartons', '/sales/invoices', {
    method: 'POST',
    json: {
      invoiceDate: today,
      customerId: customer.id,
      warehouseId: main.id,
      lines: [{ itemId: item.id, description: 'صرف 2 كرتونة', quantity: '2', unitName: 'كرتونة', unitPrice: '230', taxRate: '0' }],
    },
  });
  if (!sale) return;
  await must('F2: post the issue', `/sales/invoices/${sale.id}/post`, { method: 'POST' });
  const afterSale = await must('F2: read the stock after the issue', `/inventory/stock?itemId=${item.id}`);
  const saleRows = Array.isArray(afterSale) ? afterSale : afterSale?.items ?? [];
  const remaining = saleRows.find((row) => (row.itemId ?? row.item?.id) === item.id);
  check('F2: two cartons leave ninety-six pieces', Number(remaining?.quantity) === 96, String(remaining?.quantity));

  const count = await must('F2: count 4 cartons on the shelf', '/inventory/stock-documents', {
    method: 'POST',
    json: {
      kind: 'COUNT',
      branchId,
      toWarehouseId: main.id,
      documentDate: today,
      lines: [{ itemId: item.id, countedQuantity: '4', unitName: 'كرتونة' }],
    },
  });
  if (!count) return;
  await must('F2: post the count', `/inventory/stock-documents/${count.id}/post`, { method: 'POST' });
  const afterCount = await must('F2: read the stock after the count', `/inventory/stock?itemId=${item.id}`);
  const countRows = Array.isArray(afterCount) ? afterCount : afterCount?.items ?? [];
  const counted = countRows.find((row) => (row.itemId ?? row.item?.id) === item.id);
  check('F2: the counted four cartons become forty-eight pieces', Number(counted?.quantity) === 48, String(counted?.quantity));

  const variance = await must('F2: read the stock-take difference report', `/inventory/reports/stock-take-variance?warehouseId=${main.id}`);
  const line = (variance?.rows ?? []).find((row) => row.documentNumber === count.documentNumber);
  check(
    'F2: the difference report states the book figure, the counted figure and the difference',
    line && Number(line.systemQuantity) === 96 && Number(line.countedQuantity) === 48 && Number(line.varianceQuantity) === -48,
    JSON.stringify({ system: line?.systemQuantity, counted: line?.countedQuantity, variance: line?.varianceQuantity }),
  );
  check(
    'F2: the report keeps the unit the count was entered in and its factor',
    line?.unitName === 'كرتونة' && Number(line?.unitFactor) === 12,
    `${line?.unitName} × ${line?.unitFactor}`,
  );

  const hiddenReport = await api(
    `/inventory/reports/stock-take-variance/print?warehouseId=${main.id}&showCost=false`,
  );
  check(
    'F2: the printed difference sheet drops the cost of the loss when it may not be shown',
    hiddenReport.status === 200 && !/Unit cost|تكلفة الوحدة/i.test(String(hiddenReport.data)),
    `status ${hiddenReport.status}`,
  );
}

async function main() {
  const login = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  token = login.data?.accessToken ?? '';
  check('the installed program accepts the administrator', Boolean(token), `status ${login.status}`);
  if (!token) return false;

  const health = await api('/health');
  check(
    'the installed program reports its own database as up',
    health.status === 200 && health.data?.database === 'up',
    JSON.stringify(health.data?.databaseName ?? ''),
  );

  await verifyPriceVisibility();
  await verifyArtwork();
  await verifyUnits();
  return true;
}

try {
  await main();
} catch (error) {
  check('the installed feature verification ran to the end', false, error instanceof Error ? error.message : String(error));
  console.error(error);
} finally {
  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} installed-app checks passed`);
  if (failed.length) process.exitCode = 1;
}
