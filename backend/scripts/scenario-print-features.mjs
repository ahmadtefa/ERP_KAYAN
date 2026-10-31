#!/usr/bin/env node
/**
 * The print policy and the attached artwork, end to end, against a disposable
 * PostgreSQL database and the real HTTP API.
 *
 * The unit tests prove the precedence table and the merge arithmetic. This
 * proves the parts a person would notice, which only the running program can
 * show:
 *
 *   * a saved print setting comes back from the database, so it survives a
 *     restart and travels in a backup;
 *   * a role without `inventory.cost.read` cannot see a cost in a printed
 *     sheet by asking for it in the URL, and cannot save a setting that would
 *     grant itself one;
 *   * the same endpoint still prints the figures for somebody who may see
 *     them, and the stored prices are untouched either way;
 *   * a two-page, mixed-size letterhead uploads, is stored with its measured
 *     geometry, downloads byte-for-byte, and is used as the page itself - the
 *     page box of the artwork is preserved and the sequence rule is visible in
 *     the sizes of the printed pages;
 *   * a damaged or non-PDF file is refused and leaves nothing behind.
 *
 *   DATABASE_URL=postgresql://... ADMIN_USERNAME=... ADMIN_PASSWORD=... \
 *     node backend/scripts/scenario-print-features.mjs [apiBaseUrl]
 */
import { createHash } from 'node:crypto';

import pg from 'pg';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required: this scenario must run on disposable PostgreSQL, never a customer database.',
  );
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const results = [];
let token = '';
const stamp = String(Date.now()).slice(-7);
const today = new Date().toISOString().slice(0, 10);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

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
  // A scenario signs in several times, and the program throttles that on
  // purpose. Waiting for the moment it names is how the scenario tests the
  // product instead of testing the throttle.
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${API}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
    const type = response.headers.get('content-type') ?? '';
    const binary =
      type.startsWith('application/pdf') ||
      type.includes('octet-stream') ||
      type.includes('application/zip') ||
      type.includes('application/octet-stream');
    const data = type.includes('application/json')
      ? await response.json().catch(() => null)
      : binary
        ? Buffer.from(await response.arrayBuffer())
        : await response.text();
    if (response.status !== 429 || attempt >= 6) {
      if (response.status === 429) {
        console.log(`  WAIT  ${path} stayed throttled after ${attempt} attempts`);
      }
      return { status: response.status, data, type };
    }
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

async function sql(query, values = []) {
  const result = await pool.query(query, values);
  return result.rows;
}

/// Two pages of different sizes, each with a band of one colour the programme
/// never prints by accident, so a page can be recognised by its geometry.
async function letterhead() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  const magenta = rgb(0.867, 0.059, 0.518);
  const first = document.addPage([600, 800]);
  first.drawRectangle({ x: 0, y: 720, width: 600, height: 80, color: magenta });
  first.drawText('KAYAN LETTERHEAD', { x: 40, y: 748, size: 18, font, color: rgb(1, 1, 1) });
  const second = document.addPage([620, 820]);
  second.drawRectangle({ x: 0, y: 740, width: 620, height: 80, color: magenta });
  second.drawText('KAYAN LETTERHEAD 2', { x: 40, y: 768, size: 18, font, color: rgb(1, 1, 1) });
  return Buffer.from(await document.save());
}

async function pageSizes(pdf) {
  const document = await PDFDocument.load(new Uint8Array(pdf), { updateMetadata: false });
  return document.getPages().map((page) => {
    const size = page.getSize();
    return [Math.round(size.width * 10) / 10, Math.round(size.height * 10) / 10];
  });
}

async function main() {
  const login = await api('/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
    noAuth: true,
  });
  token = login.data?.accessToken ?? '';
  check('the administrator can sign in', Boolean(token), `status ${login.status}`);
  if (!token) return false;

  const [me] = await sql(`SELECT "companyId"::text FROM users WHERE username = $1`, [USERNAME]);
  if (!me) {
    check('the administrator belongs to a company', false, 'no user row');
    return false;
  }
  const companyId = me.companyId;

  // ── 1. the saved print policy ────────────────────────────────────────
  const policy = await must('read the print policy', '/company/print-settings');
  check(
    'the policy names the prints the program can produce and starts unlocked for an administrator',
    Array.isArray(policy?.types) &&
      policy.types.length > 10 &&
      policy.types.some((type) => type.key === 'sales-quotation') &&
      policy.costLocked === false,
    `${policy?.types?.length ?? 0} types`,
  );
  check(
    'an installation that never opened the screen keeps printing everything',
    policy?.default?.documentType === 'default' &&
      policy.default.showSalePrice === true &&
      policy.default.showCost === true,
    JSON.stringify(policy?.default),
  );

  const savedOfferPolicy = await must(
    'save a policy for offers',
    '/company/print-settings',
    { method: 'PUT', json: { settings: [{ documentType: 'sales-quotation', showSalePrice: false, showCost: true }] } },
  );
  check(
    'the offer policy is saved',
    savedOfferPolicy?.settings?.some(
      (row) => row.documentType === 'sales-quotation' && row.showSalePrice === false,
    ),
  );
  await must('save the general default', '/company/print-settings', {
    method: 'PUT',
    json: { settings: [{ documentType: 'default', showSalePrice: true, showCost: false }] },
  });
  const reread = await must('read the policy again', '/company/print-settings');
  check(
    'what was saved is what a new request reads back',
    reread?.settings?.some(
      (row) => row.documentType === 'sales-quotation' && row.showSalePrice === false,
    ) && reread?.default?.showCost === false,
    JSON.stringify(reread?.default),
  );
  const storedRows = await sql(
    `SELECT "documentType", "showSalePrice", "showCost" FROM print_price_settings
      WHERE "companyId" = $1::uuid ORDER BY "documentType"`,
    [companyId],
  );
  check(
    'the policy is a database row, not a file on one machine',
    storedRows.some((row) => row.documentType === 'sales-quotation' && row.showSalePrice === false) &&
      storedRows.some((row) => row.documentType === 'default' && row.showCost === false),
    `${storedRows.length} rows`,
  );
  const unknown = await api('/company/print-settings', {
    method: 'PUT',
    json: { settings: [{ documentType: 'not-a-print', showSalePrice: true, showCost: true }] },
  });
  check('a type nothing prints by is refused', unknown.status === 400, `status ${unknown.status}`);

  // ── 2. the permission floor ──────────────────────────────────────────
  const role = await must('create a warehouse role with no cost permission', '/admin/roles', {
    method: 'POST',
    json: {
      code: `WHSE-${stamp}`,
      nameEn: `Warehouse ${stamp}`,
      nameAr: `مخزن ${stamp}`,
      permissions: [
        'inventory.stock.read',
        'inventory.items.read',
        'sales.quotations.read',
        'reports.read',
      ],
    },
  });
  const [branch] = await sql(
    `SELECT id::text FROM branches WHERE "companyId" = $1::uuid ORDER BY "createdAt" LIMIT 1`,
    [companyId],
  );
  const clerk = role
    ? await must('create the warehouse clerk', '/admin/users', {
        method: 'POST',
        json: {
          username: `clerk-${stamp}`,
          fullNameEn: `Clerk ${stamp}`,
          fullNameAr: `موظف ${stamp}`,
          password: `Temp-${stamp}-Password1`,
          roleIds: [role.id],
          branchIds: branch ? [branch.id] : [],
        },
      })
    : null;
  const clerkLogin = clerk
    ? await api('/auth/login', {
        method: 'POST',
        json: { username: `clerk-${stamp}`, password: `Temp-${stamp}-Password1` },
        noAuth: true,
      })
    : { data: {} };
  const clerkToken = clerkLogin.data?.accessToken ?? '';
  check('the clerk signs in without the cost permission', Boolean(clerkToken));
  if (!clerkToken) return false;

  const clerkPolicy = await api('/company/print-settings', { token: clerkToken });
  check(
    'the clerk is told the cost box is locked rather than being offered one that is ignored',
    clerkPolicy.status === 200 && clerkPolicy.data?.costLocked === true,
    `status ${clerkPolicy.status}, locked ${clerkPolicy.data?.costLocked}`,
  );
  const clerkSaves = await api('/company/print-settings', {
    token: clerkToken,
    method: 'PUT',
    json: { settings: [{ documentType: 'stock-ledger', showSalePrice: true, showCost: true }] },
  });
  check(
    'the clerk cannot write a policy that would grant a cost',
    clerkSaves.status === 403,
    `status ${clerkSaves.status}`,
  );

  // The quantity must differ from the unit cost, or "10.0000" on the sheet
  // could be the quantity and the check would pass while the cost leaked.
  const [movement] = await sql(
    `SELECT m."itemId"::text AS "itemId", m."unitCost"::text AS "unitCost"
       FROM stock_movements m
      WHERE m."companyId" = $1::uuid
        AND m."unitCost" > 0
        AND m."quantity" <> m."unitCost"
      ORDER BY m."createdAt" DESC LIMIT 1`,
    [companyId],
  );
  if (!movement) {
    check('there is a stock movement to print', false, 'no movement with a cost');
    return false;
  }
  const ledgerFor = (who, request) =>
    api(
      `/exports/lists/stock-ledger/print?itemId=${movement.itemId}&lang=en&${request}`,
      { token: who },
    );
  // A sheet's columns and its header figures, read out of the page that is
  // handed to the printer - not guessed at by looking for a number, because a
  // plain quantity can be written the same way a cost can.
  const sheetShape = (html) => ({
    headers: [...String(html).matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1].trim()),
    meta: [...String(html).matchAll(/<span class="label">([^<]*)<\/span>/g)].map((m) => m[1].trim()),
  });
  const COST_HEADERS = /Unit cost|Running value|Stock value|Cost|Average cost|تكلفة|القيمة/i;

  const clerkSheet = await ledgerFor(clerkToken, 'showCost=true&showSalePrice=true');
  const clerkShape = sheetShape(clerkSheet.data);
  check(
    'a clerk who asks for the cost in the URL still gets a sheet without it',
    clerkSheet.status === 200 &&
      String(clerkSheet.data).includes('<table') &&
      !clerkShape.headers.some((header) => COST_HEADERS.test(header)) &&
      !clerkShape.meta.some((label) => COST_HEADERS.test(label)),
    `status ${clerkSheet.status}, headers ${clerkShape.headers.join(', ')}`,
  );

  // The floor is the permission, not the URL: asking for the cost and being
  // refused it must produce exactly the page this caller gets when they ask
  // for nothing. A byte comparison is too strict (the page carries a
  // timestamp), so the columns and the header figures are compared.
  const clerkPlain = await ledgerFor(clerkToken, 'showCost=false');
  check(
    'asking for the cost changes nothing for a caller who may not read it',
    JSON.stringify(sheetShape(clerkPlain.data)) === JSON.stringify(clerkShape),
    'the page is the same either way',
  );

  const adminSheet = await ledgerFor(token, 'showCost=true');
  const adminShape = sheetShape(adminSheet.data);
  check(
    'the same sheet still carries the cost for somebody who may read it',
    adminSheet.status === 200 &&
      adminShape.headers.some((header) => /Unit cost|Running value|تكلفة/i.test(header)),
    `status ${adminSheet.status}, headers ${adminShape.headers.join(', ')}`,
  );
  const adminHidden = await ledgerFor(token, 'showCost=false');
  check(
    'hiding the cost takes those columns off even for somebody allowed to see them',
    !sheetShape(adminHidden.data).headers.some((header) => /Unit cost|Running value|تكلفة/i.test(header)),
    sheetShape(adminHidden.data).headers.join(', '),
  );

  const [afterMovement] = await sql(
    `SELECT "unitCost"::text AS "unitCost" FROM stock_movements WHERE "itemId" = $1::uuid
      AND "unitCost" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`,
    [movement.itemId],
  );
  check(
    'hiding a figure changes no stored price',
    afterMovement?.unitCost === movement.unitCost,
    `${movement.unitCost} -> ${afterMovement?.unitCost}`,
  );
  const exportsAfter = await api(
    `/exports/lists/stock-ledger/download?itemId=${movement.itemId}&format=csv&lang=en&showCost=true`,
    { token: clerkToken },
  );
  const exportText = String(exportsAfter.data ?? '');
  // The file carries the same column labels as the page, so the same rule
  // decides it: no cost column heading, in either language, anywhere in it.
  const COST_LABELS = /Unit cost|Running value|Stock value|Average cost|Purchase price|تكلفة|قيمة المخزون|سعر الشراء/i;
  check(
    'the exported file obeys the same floor as the printed sheet',
    exportsAfter.status === 200 && !COST_LABELS.test(exportText),
    `status ${exportsAfter.status}, ${exportText.split('\n').length} lines`,
  );

  // ── 3. the artwork library ───────────────────────────────────────────
  const pdf = await letterhead();
  const form = new FormData();
  form.append('name', `Letterhead ${stamp}`);
  form.append(
    'file',
    new Blob([pdf], { type: 'application/pdf' }),
    `letterhead-${stamp}.pdf`,
  );
  const uploaded = await must('upload a two-page letterhead', '/sales/quotation-backgrounds', {
    method: 'POST',
    body: form,
  });
  if (!uploaded) return false;
  check(
    'the upload is measured from the file itself',
    uploaded?.pageCount === 2 &&
      Math.abs(Number(uploaded.pageWidth) - 600) < 0.5 &&
      Math.abs(Number(uploaded.pageHeight) - 800) < 0.5 &&
      Number(uploaded.byteSize) === pdf.length,
    JSON.stringify({
      pages: uploaded?.pageCount,
      size: `${uploaded?.pageWidth}x${uploaded?.pageHeight}`,
    }),
  );
  const listed = await must('read the artwork library', '/sales/quotation-backgrounds');
  check(
    'the letterhead is offered in the library',
    Array.isArray(listed) && listed.some((row) => row.id === uploaded?.id),
  );
  const file = await api(`/sales/quotation-backgrounds/${uploaded.id}/file`);
  check(
    'the stored file downloads byte-for-byte',
    file.status === 200 &&
      Buffer.isBuffer(file.data) &&
      sha256(file.data) === sha256(pdf),
    `status ${file.status}, ${file.data?.length ?? 0} bytes`,
  );
  const [storedBlob] = await sql(
    `SELECT "byteSize", sha256, "pageCount", "companyId"::text AS "companyId"
       FROM quotation_backgrounds WHERE id = $1::uuid`,
    [uploaded.id],
  );
  check(
    'the artwork is stored against the company with the hash that was measured',
    storedBlob?.sha256 === sha256(pdf) &&
      storedBlob?.byteSize === pdf.length &&
      storedBlob?.companyId === companyId,
    `${storedBlob?.byteSize ?? 0} bytes`,
  );

  const damaged = new FormData();
  damaged.append('file', new Blob([Buffer.from('%PDF-1.7\nnot really a pdf')], { type: 'application/pdf' }), 'damaged.pdf');
  const damagedUpload = await api('/sales/quotation-backgrounds', { method: 'POST', body: damaged });
  check(
    'a damaged file is refused with a reason instead of crashing the screen',
    damagedUpload.status === 400 &&
      /PDF|pdf/.test(JSON.stringify(damagedUpload.data ?? '')),
    `status ${damagedUpload.status}`,
  );
  const notPdf = new FormData();
  notPdf.append('file', new Blob([Buffer.from('hello')], { type: 'image/png' }), 'logo.png');
  const notPdfUpload = await api('/sales/quotation-backgrounds', { method: 'POST', body: notPdf });
  check(
    'a file that is not a PDF is refused by extension',
    notPdfUpload.status === 400,
    `status ${notPdfUpload.status}`,
  );
  const [artworkCount] = await sql(
    `SELECT count(*)::int AS count FROM quotation_backgrounds WHERE "companyId" = $1::uuid AND "deletedAt" IS NULL`,
    [companyId],
  );
  check(
    'the refused uploads left nothing behind',
    artworkCount?.count === 1,
    `${artworkCount?.count} artwork files`,
  );

  // ── 4. an offer printed on it ────────────────────────────────────────
  const [customer] = await sql(
    `SELECT id::text FROM customers WHERE "companyId" = $1::uuid ORDER BY "createdAt" LIMIT 1`,
    [companyId],
  );
  const [item] = await sql(
    `SELECT id::text FROM items WHERE "companyId" = $1::uuid ORDER BY "createdAt" LIMIT 1`,
    [companyId],
  );
  if (!customer || !item) {
    check('there is a customer and an item to quote', false, 'no customer or item');
    return false;
  }
  const lines = Array.from({ length: 40 }, (_, index) => ({
    itemId: item.id,
    quantity: '1',
    unitPrice: String(100 + index),
    unit: 'piece',
  }));
  // An edit replaces the document, so the whole document is sent back with the
  // artwork fields added: the API validates what it is about to store, and
  // rightly refuses a body that names no customer and no tables.
  const offerBody = (extra = {}) => ({
    quotationDate: today,
    customerId: customer.id,
    subject: `Artwork offer ${stamp}`,
    tables: [{ title: `Printing ${stamp}`, lines }],
    ...extra,
  });
  const offer = await must('create an offer with enough lines to overflow a page', '/sales/quotations', {
    method: 'POST',
    json: offerBody(),
  });
  if (!offer) return false;

  const plainPdf = await api(`/sales/quotations/${offer.id}/pdf?lang=en`);
  const plainSizes = Buffer.isBuffer(plainPdf.data) ? await pageSizes(plainPdf.data) : [];
  check(
    'the offer prints without artwork first, on A4, over more than one page',
    plainPdf.status === 200 &&
      plainSizes.length >= 2 &&
      Math.abs(plainSizes[0][0] - 595.3) < 2,
    `status ${plainPdf.status}, ${plainSizes.length} pages, ${plainSizes[0]?.join('x')}`,
  );
  if (plainSizes.length < 2) return false;

  const attached = await must('attach the letterhead to the offer', `/sales/quotations/${offer.id}`, {
    method: 'PUT',
    json: offerBody({
      backgroundFileId: uploaded.id,
      background: { mode: 'REPEAT', showPageNumbers: true, marginMm: { top: 20, bottom: 18, left: 12, right: 12 } },
    }),
  });
  check(
    'the offer remembers its letterhead and how to use it',
    attached?.backgroundFileId === uploaded.id && attached?.background?.mode === 'REPEAT',
    JSON.stringify(attached?.background ?? null),
  );

  const onArtwork = await api(`/sales/quotations/${offer.id}/pdf?lang=en`);
  const artworkSizes = Buffer.isBuffer(onArtwork.data) ? await pageSizes(onArtwork.data) : [];
  check(
    'the printed offer is the artwork: same page count, artwork page box',
    onArtwork.status === 200 &&
      artworkSizes.length === plainSizes.length &&
      artworkSizes.every((size) => Math.abs(size[0] - 600) < 1 && Math.abs(size[1] - 800) < 1),
    `${artworkSizes.length} pages, ${artworkSizes.map((size) => size.join('x')).join(' ')}`,
  );

  await must('switch the offer to the sequence rule', `/sales/quotations/${offer.id}`, {
    method: 'PUT',
    json: offerBody({ backgroundFileId: uploaded.id, background: { mode: 'SEQUENCE' } }),
  });
  const sequenced = await api(`/sales/quotations/${offer.id}/pdf?lang=ar`);
  const sequenceSizes = Buffer.isBuffer(sequenced.data) ? await pageSizes(sequenced.data) : [];
  check(
    'the second artwork page follows the first, and the last one holds after that',
    sequenceSizes.length === plainSizes.length &&
      Math.abs(sequenceSizes[0][0] - 600) < 1 &&
      sequenceSizes.slice(1).every((size) => Math.abs(size[0] - 620) < 1 && Math.abs(size[1] - 820) < 1),
    sequenceSizes.map((size) => size.join('x')).join(' '),
  );

  // SINGLE_PAGE names one artwork page and uses it behind every page of the
  // offer. The two pages of this letterhead are deliberately different sizes,
  // so "which page was used" is visible in the printed sheet itself.
  const singlePage = await must('print the offer on one chosen artwork page', `/sales/quotations/${offer.id}`, {
    method: 'PUT',
    json: offerBody({
      backgroundFileId: uploaded.id,
      background: { mode: 'SINGLE_PAGE', page: 2, showPageNumbers: true },
    }),
  });
  check(
    'the offer remembers the single page it was told to use',
    singlePage?.background?.mode === 'SINGLE_PAGE' && Number(singlePage?.background?.page) === 2,
    JSON.stringify(singlePage?.background ?? null),
  );
  const singlePdf = await api(`/sales/quotations/${offer.id}/pdf?lang=en`);
  const singleSizes = Buffer.isBuffer(singlePdf.data) ? await pageSizes(singlePdf.data) : [];
  check(
    'SINGLE_PAGE puts the second artwork page behind every page, and the first behind none',
    singlePdf.status === 200 &&
      singleSizes.length === plainSizes.length &&
      singleSizes.every((size) => Math.abs(size[0] - 620) < 1 && Math.abs(size[1] - 820) < 1),
    singleSizes.map((size) => size.join('x')).join(' '),
  );

  // A page the file does not have is clamped to the last page that exists,
  // rather than producing a sheet with no artwork on it.
  await must('ask for an artwork page that does not exist', `/sales/quotations/${offer.id}`, {
    method: 'PUT',
    json: offerBody({
      backgroundFileId: uploaded.id,
      background: { mode: 'SINGLE_PAGE', page: 99 },
    }),
  });
  const clampedPdf = await api(`/sales/quotations/${offer.id}/pdf?lang=en`);
  const clampedSizes = Buffer.isBuffer(clampedPdf.data) ? await pageSizes(clampedPdf.data) : [];
  check(
    'a page beyond the file falls back to the last page it has',
    clampedSizes.length === plainSizes.length &&
      clampedSizes.every((size) => Math.abs(size[0] - 620) < 1),
    clampedSizes.map((size) => size.join('x')).join(' '),
  );

  await must('detach the letterhead', `/sales/quotations/${offer.id}`, {
    method: 'PUT',
    json: offerBody({ backgroundFileId: null, background: null }),
  });
  const detached = await api(`/sales/quotations/${offer.id}/pdf?lang=en`);
  const detachedSizes = Buffer.isBuffer(detached.data) ? await pageSizes(detached.data) : [];
  check(
    'removing the letterhead returns the offer to its drawn design',
    detached.status === 200 &&
      Math.abs(detachedSizes[0]?.[0] - 595.3) < 2,
    `${detachedSizes[0]?.join('x') ?? 'no page'}`,
  );

  // ── 5. the offer print obeys the saved policy ────────────────────────
  await must('restore a policy that prints the offer price', '/company/print-settings', {
    method: 'PUT',
    json: { settings: [{ documentType: 'sales-quotation', showSalePrice: true, showCost: true }] },
  });
  const pricedSheet = await api(`/sales/quotations/${offer.id}/print?lang=en`);
  const pricedHtml = String(pricedSheet.data ?? '');
  const firstLineTotal = (100).toFixed(2);
  check(
    'the offer prints its prices when the policy and the request both allow it',
    pricedSheet.status === 200 && pricedHtml.includes(firstLineTotal),
    `status ${pricedSheet.status}`,
  );
  const bareSheet = await api(
    `/sales/quotations/${offer.id}/print?lang=en&showSalePrice=false`,
  );
  const bareHtml = String(bareSheet.data ?? '');
  check(
    'a copy asked for without prices carries none of them',
    bareSheet.status === 200 && !bareHtml.includes(firstLineTotal) && bareHtml.includes('<table'),
    `status ${bareSheet.status}`,
  );
  await must('put the offer policy back as it was found', '/company/print-settings', {
    method: 'PUT',
    json: { settings: [{ documentType: 'sales-quotation', showSalePrice: false, showCost: true }] },
  });
  const [priceStillThere] = await sql(
    `SELECT l."unitPrice"::text AS "unitPrice"
       FROM quotation_lines l
       JOIN quotation_tables t ON t.id = l."tableId"
      WHERE t."quotationId" = $1::uuid
      ORDER BY l."lineNumber" LIMIT 1`,
    [offer.id],
  );
  check(
    'the price is still on the stored offer after being hidden from copies',
    Number(priceStillThere?.unitPrice) === 100,
    priceStillThere?.unitPrice,
  );

  // ── 6. it survives a backup and a restore ────────────────────────────
  // A letterhead is only durable if the copy that comes back from a dump is the
  // same file. The policy is only durable if it comes back as the same row.
  const created = await must('take a full backup', '/backup/full', { method: 'POST' });
  const backupName = created?.file?.name ?? '';
  const dumpResponse = backupName
    ? await api(`/backup/full/${encodeURIComponent(backupName)}/download`)
    : { status: 0, data: null };
  const dump = Buffer.isBuffer(dumpResponse.data) ? dumpResponse.data : null;
  check(
    'the backup downloads as a real dump',
    Boolean(dump) && dump.length > 1024,
    `${backupName ?? 'no file name'} · ${dump?.length ?? 0} bytes`,
  );
  if (!dump || !backupName) return false;

  const restoreForm = new FormData();
  restoreForm.append('confirm', 'true');
  restoreForm.append('file', new Blob([dump]), 'print-features.dump');
  const restored = await api('/backup/full/restore', { method: 'POST', body: restoreForm });
  check(
    'the dump restores, after a rehearsal in a scratch database',
    restored.status === 201 &&
      restored.data?.restored === true &&
      restored.data?.rehearsed === true,
    `status ${restored.status}, rehearsed ${restored.data?.rehearsed}`,
  );

  const afterRestore = await api(`/sales/quotation-backgrounds/${uploaded.id}/file`);
  check(
    'the letterhead comes back from the backup byte for byte',
    afterRestore.status === 200 &&
      Buffer.isBuffer(afterRestore.data) &&
      sha256(afterRestore.data) === sha256(pdf),
    `status ${afterRestore.status}`,
  );
  const [restoredBlob] = await sql(
    `SELECT sha256, "byteSize" FROM quotation_backgrounds WHERE id = $1::uuid`,
    [uploaded.id],
  );
  check(
    'the restored database holds the artwork itself, not a reference to a file',
    restoredBlob?.sha256 === sha256(pdf) && restoredBlob?.byteSize === pdf.length,
    `${restoredBlob?.byteSize ?? 0} bytes`,
  );
  const policyAfterRestore = await api('/company/print-settings');
  check(
    'the print policy is still the saved one after the restore',
    policyAfterRestore.data?.settings?.some(
      (row) => row.documentType === 'sales-quotation' && row.showSalePrice === false,
    ),
    `status ${policyAfterRestore.status}`,
  );

  // ── 7. the company's own JSON file carries the artwork and the policy ─
  // The full dump above is the database's copy. This is the company file a
  // person downloads to move the books to another machine, and it is a
  // different format: JSON has no binary type, so the artwork has to travel as
  // base64 and the policy as rows. Both were missing before version 2, and a
  // file that looks complete while dropping them is how a new machine ends up
  // printing every sheet with costs the company had hidden.
  const companyFile = await api('/backup/download');
  // The route answers with JSON, so the helper has already parsed it.
  const parsed = (() => {
    if (companyFile.data && typeof companyFile.data === 'object') return companyFile.data;
    try {
      return JSON.parse(String(companyFile.data ?? ''));
    } catch {
      return null;
    }
  })();
  check(
    'the company backup downloads as readable JSON',
    companyFile.status === 200 && parsed?.format === 'kayan-backup',
    `status ${companyFile.status}`,
  );
  const storedArtwork = parsed?.tables?.quotationBackground?.find(
    (row) => row.id === uploaded.id,
  );
  check(
    'the company file carries the letterhead artwork, as base64 under its marker',
    typeof storedArtwork?.data === 'string' &&
      storedArtwork.data === `base64:${pdf.toString('base64')}`,
    `${typeof storedArtwork?.data === 'string' ? storedArtwork.data.length : 0} chars`,
  );
  check(
    'the company file carries the print policy it was saved with',
    parsed?.tables?.printPriceSetting?.some?.(
      (row) => row.documentType === 'sales-quotation' && row.showSalePrice === false,
    ) === true,
    `${parsed?.tables?.printPriceSetting?.length ?? 0} rows`,
  );
  check(
    'the company file says which format it is, so an older program refuses it clearly',
    parsed?.version === 2,
    `version ${parsed?.version}`,
  );

  return true;
}

try {
  await main();
} catch (error) {
  check('the scenario ran to the end', false, error instanceof Error ? error.message : String(error));
  console.error(error);
} finally {
  await pool.end();
  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) process.exitCode = 1;
}
