#!/usr/bin/env node
/**
 * Builds the demo company «شركة النخيل للتجارة والتوزيع» through the program's
 * own HTTP API, then exports it with the program's own company-backup service.
 *
 * Why through the API and not by writing rows: every document in this file has
 * to be one the program can produce. A sales invoice written straight into the
 * table has no stock movements, no journal entry and no document number, and a
 * demo company made of those looks right until somebody opens an invoice and
 * finds nothing behind it. Posting through the routes means the ledger, the
 * stock balances, the customer balances and the returns are all real, and the
 * export then simply describes what the program did.
 *
 * Usage (against an isolated database - never a customer's):
 *
 *   KAYAN_API=http://127.0.0.1:3000/api/v1 \
 *   KAYAN_OUT=demo-data/KAYAN-Demo-Company-Backup-v2.json \
 *     node tools/seed-demo-company-v2.mjs
 *
 * The script is safe to re-run: the company it creates carries a marker in its
 * own settings, and a second run refuses instead of doubling the data. Use a
 * fresh database (or `--force` after a reset) to rebuild.
 *
 * Nothing here is real: every name, phone number, tax registration, address and
 * e-mail belongs to a fictional company. The addresses use the reserved
 * `.test` domain and `+20 100 000 …` numbers that cannot reach anybody.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// The drawing library travels with the program, not with this repository's
// root, so it is resolved from the backend's own dependencies.
const requireFromBackend = createRequire(new URL('../backend/package.json', import.meta.url));
const { PDFDocument, StandardFonts, rgb } = requireFromBackend('pdf-lib');

const API = (process.env.KAYAN_API ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
const OUT = resolve(root, process.env.KAYAN_OUT ?? 'demo-data/KAYAN-Demo-Company-Backup-v2.json');
const ADMIN_USERNAME = process.env.KAYAN_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.KAYAN_ADMIN_PASSWORD ?? 'Nakheel@2026';
const COMPANY_CODE = process.env.KAYAN_COMPANY_CODE ?? 'NAKHEL';
const FORCE = process.argv.includes('--force');

/// A marker stored in the company's own settings, so a second run on the same
/// database stops instead of creating a second set of books.
const SEED_MARKER = 'KAYAN_DEMO_SEED_V2';

let token = '';
const created = { customers: [], suppliers: [], items: [], warehouses: [], cash: [] };

// ─────────────────────────────────────────────────────────────── plumbing

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const auth = options.token ?? token;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  for (let attempt = 0; ; attempt += 1) {
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
    // The program throttles repeated sign-ins and failed logins; a seed run
    // that is told to wait a minute does so rather than failing the build.
    if (response.status !== 429 || attempt >= 8) {
      return { status: response.status, data };
    }
    const seconds = Number(/(\d+)\s*second/.exec(String(data?.detail ?? ''))?.[1] ?? 5);
    await sleep(Math.min(seconds + 1, 90) * 1000);
  }
}

class SeedError extends Error {}

async function must(label, path, options = {}) {
  const response = await api(path, options);
  if (response.status >= 200 && response.status < 300) return response.data;
  throw new SeedError(
    `${label} failed (HTTP ${response.status}): ${JSON.stringify(response.data)?.slice(0, 600)}`,
  );
}

let step = 0;
function phase(title) {
  step += 1;
  console.log(`\n[${String(step).padStart(2, '0')}] ${title}`);
}

const money = (value) => Number(Number(value).toFixed(4));
const text = (value) => String(value).replace(/\s+/g, ' ').trim();

// ──────────────────────────────────────────────────────────── the scenario

/// The company's year is the year this script runs in, but the documents are
/// spread over the seven months before today so the dashboard, the monthly
/// chart and the ageing reports have something to show.
const NOW = new Date();
const YEAR = NOW.getUTCFullYear();
const MONTHS_BACK = 7;

function day(monthsAgo, dayOfMonth = 12) {
  const date = new Date(Date.UTC(YEAR, NOW.getUTCMonth() - monthsAgo, dayOfMonth));
  return date.toISOString().slice(0, 10);
}

const CUSTOMERS = [
  ['شركة الدلتا للتجارة', 'Delta Trading Co.', 'المنصورة', 60, '450000'],
  ['مؤسسة النور للتوزيع', 'Al Nour Distribution', 'القاهرة', 30, '300000'],
  ['سوبر ماركت الأمانة', 'Al Amana Supermarket', 'الجيزة', 15, '120000'],
  ['شركة القاهرة للأغذية', 'Cairo Foods Co.', 'القاهرة', 45, '600000'],
  ['مؤسسة الجيزة التجارية', 'Giza Commercial Est.', 'الجيزة', 30, '250000'],
  ['شركة الإسكندرية للمشروبات', 'Alexandria Beverages', 'الإسكندرية', 60, '380000'],
  ['بقالة الحاج محمود', 'Hag Mahmoud Grocery', 'القاهرة', 0, '20000'],
  ['شركة المستقبل للتجزئة', 'Future Retail Co.', 'القاهرة', 45, '500000'],
  ['مؤسسة الوفاء للتجارة', 'Al Wafaa Trading Est.', 'طنطا', 30, '150000'],
  ['شركة الصعيد للتجارة', 'Upper Egypt Trading', 'أسيوط', 60, '280000'],
  ['مؤسسة الأهرام التجارية', 'Al Ahram Commercial', 'المنيا', 30, '180000'],
  ['سوبر ماركت المدينة', 'Al Madina Supermarket', 'المنصورة', 15, '90000'],
  ['شركة النيل للتموين', 'Nile Catering Co.', 'القاهرة', 45, '420000'],
  ['مؤسسة الشروق للتوزيع', 'Al Shorouk Distribution', 'الإسكندرية', 30, '210000'],
  ['شركة أطياب للضيافة', 'Atyab Hospitality Co.', 'القاهرة', 30, '160000'],
  ['محلات البركة', 'Al Baraka Stores', 'الجيزة', 0, '45000'],
  ['شركة الرياض للتجزئة', 'Al Riyadh Retail Co.', 'الإسكندرية', 45, '320000'],
  ['مؤسسة الأمل التجارية', 'Al Amal Trading Est.', 'الفيوم', 30, '110000'],
  ['شركة المنصورة للتوزيع', 'Mansoura Distribution', 'المنصورة', 60, '340000'],
  ['سوبر ماركت السلام', 'Al Salam Supermarket', 'طنطا', 15, '75000'],
  ['شركة الهرم للتجارة', 'Al Haram Trading Co.', 'الجيزة', 30, '200000'],
  ['مؤسسة النخبة للتجارة', 'Al Nokhba Trading Est.', 'القاهرة', 45, '260000'],
  ['شركة طنطا للأغذية', 'Tanta Foods Co.', 'طنطا', 30, '130000'],
  ['بقالة أبو أحمد', 'Abu Ahmed Grocery', 'المنيا', 0, '30000'],
  ['شركة الفيوم الزراعية', 'Fayoum Agricultural Co.', 'الفيوم', 60, '390000'],
];

const SUPPLIERS = [
  ['شركة النيل للمواد الغذائية', 'Nile Foodstuffs Co.', 'القاهرة', 30],
  ['مصنع الدلتا للزيوت', 'Delta Oils Factory', 'المنصورة', 45],
  ['شركة الأمانة للمنظفات', 'Al Amana Detergents', 'القاهرة', 30],
  ['مصنع الورق المصري', 'Egyptian Paper Mill', 'الإسكندرية', 45],
  ['شركة الوادي للسكر', 'Al Wadi Sugar Co.', 'الفيوم', 30],
  ['مزارع الفيوم للأرز', 'Fayoum Rice Farms', 'الفيوم', 60],
  ['شركة الشرق للمشروبات', 'Al Shark Beverages', 'الإسكندرية', 30],
  ['مصنع النخيل للبسكويت', 'Al Nakheel Biscuits', 'الجيزة', 30],
  ['شركة الأسواق الكبرى', 'Grand Markets Co.', 'القاهرة', 45],
  ['شركة الإسكندرية للشاي', 'Alexandria Tea Co.', 'الإسكندرية', 30],
  ['مصنع القاهرة للمعلبات', 'Cairo Canners', 'القاهرة', 45],
  ['شركة الصحة للمنظفات', 'Al Seha Detergents', 'طنطا', 30],
  ['شركة النور للورقيات', 'Al Nour Paper Products', 'المنيا', 30],
  ['شركة الغذاء الأول', 'First Food Co.', 'القاهرة', 60],
  ['شركة التوريدات العامة', 'General Supplies Co.', 'الجيزة', 45],
];

/// [code, nameAr, nameEn, category, cartonSize, packSize, purchase, sale, tax, reorder, stock]
const ITEMS = [
  ['OIL-001', 'زيت ذرة ١ لتر', 'Corn oil 1L', 'زيوت', 12, 6, '58.0000', '69.0000', '14', '48', true],
  ['OIL-002', 'زيت عباد الشمس ١ لتر', 'Sunflower oil 1L', 'زيوت', 12, 6, '52.0000', '62.0000', '14', '48', true],
  ['OIL-003', 'زيت خليط ١.٥ لتر', 'Blended oil 1.5L', 'زيوت', 6, 3, '76.0000', '89.0000', '14', '24', true],
  ['OIL-004', 'زيت زيتون بكر ٥٠٠ مل', 'Extra virgin olive oil 500ml', 'زيوت', 12, 6, '148.0000', '178.0000', '14', '24', true],
  ['OIL-005', 'سمن نباتي ٢ كجم', 'Vegetable ghee 2kg', 'زيوت', 6, 1, '196.0000', '235.0000', '14', '12', true],
  ['DRY-001', 'أرز مصري ٥ كجم', 'Egyptian rice 5kg', 'بقالة جافة', 4, 1, '128.0000', '152.0000', '0', '20', true],
  ['DRY-002', 'سكر أبيض ١ كجم', 'White sugar 1kg', 'بقالة جافة', 24, 12, '32.0000', '39.0000', '0', '96', true],
  ['DRY-003', 'مكرونة اسباجتي ٤٠٠ جم', 'Spaghetti pasta 400g', 'بقالة جافة', 24, 12, '12.5000', '16.0000', '14', '120', true],
  ['DRY-004', 'عدس أصفر ٨٠٠ جم', 'Yellow lentils 800g', 'بقالة جافة', 12, 6, '42.0000', '52.0000', '0', '48', true],
  ['DRY-005', 'فول مدمس ٤٠٠ جم', 'Fava beans 400g', 'بقالة جافة', 24, 12, '13.0000', '17.5000', '14', '72', true],
  ['DRY-006', 'دقيق فاخر ١ كجم', 'Fine flour 1kg', 'بقالة جافة', 20, 10, '18.0000', '23.0000', '0', '60', true],
  ['DRY-007', 'ملح طعام ٥٠٠ جم', 'Table salt 500g', 'بقالة جافة', 40, 20, '4.5000', '6.5000', '14', '120', true],
  ['DRY-008', 'شاي أكياس ١٠٠ فتلة', 'Tea bags 100', 'بقالة جافة', 24, 12, '46.0000', '58.0000', '14', '48', true],
  ['DRY-009', 'بن مطحون ٢٥٠ جم', 'Ground coffee 250g', 'بقالة جافة', 12, 6, '86.0000', '104.0000', '14', '24', true],
  ['DRY-010', 'نسكافيه ٢٠٠ جم', 'Instant coffee 200g', 'بقالة جافة', 12, 6, '132.0000', '158.0000', '14', '24', true],
  ['DRY-011', 'عسل نحل ٥٠٠ جم', 'Honey 500g', 'بقالة جافة', 12, 6, '94.0000', '115.0000', '14', '24', true],
  ['DRY-012', 'حلاوة طحينية ٤٠٠ جم', 'Halva 400g', 'بقالة جافة', 12, 6, '38.0000', '47.0000', '14', '24', true],
  ['CAN-001', 'تونة قطع ١٨٠ جم', 'Tuna chunks 180g', 'معلبات', 48, 24, '32.0000', '41.0000', '14', '96', true],
  ['CAN-002', 'صلصة طماطم ٣٢٠ جم', 'Tomato paste 320g', 'معلبات', 24, 12, '16.0000', '21.0000', '14', '96', true],
  ['CAN-003', 'فاصوليا بيضاء ٤٠٠ جم', 'White beans 400g', 'معلبات', 24, 12, '15.0000', '20.0000', '14', '72', true],
  ['CAN-004', 'ذرة حلوة ٣٤٠ جم', 'Sweet corn 340g', 'معلبات', 24, 12, '18.0000', '24.0000', '14', '72', true],
  ['CAN-005', 'مربى مشمش ٤٥٠ جم', 'Apricot jam 450g', 'معلبات', 12, 6, '34.0000', '43.0000', '14', '36', true],
  ['CAN-006', 'بسلة خضراء ٤٠٠ جم', 'Green peas 400g', 'معلبات', 24, 12, '17.0000', '22.0000', '14', '72', true],
  ['CAN-007', 'زيتون أخضر ٧٠٠ جم', 'Green olives 700g', 'معلبات', 12, 6, '44.0000', '55.0000', '14', '36', true],
  ['CAN-008', 'مخلل خيار ٦٨٠ جم', 'Pickled cucumber 680g', 'معلبات', 12, 6, '29.0000', '37.0000', '14', '36', true],
  ['CAN-009', 'لبن مبخر ٣٩٧ جم', 'Evaporated milk 397g', 'معلبات', 24, 12, '27.0000', '34.0000', '14', '60', true],
  ['CAN-010', 'كاتشب ٣٤٠ جم', 'Ketchup 340g', 'معلبات', 24, 12, '22.0000', '29.0000', '14', '60', true],
  ['BEV-001', 'مياه معدنية ١.٥ لتر', 'Mineral water 1.5L', 'مشروبات', 6, 3, '7.0000', '10.0000', '14', '180', true],
  ['BEV-002', 'مياه معدنية ٦٠٠ مل', 'Mineral water 600ml', 'مشروبات', 12, 6, '4.5000', '7.0000', '14', '240', true],
  ['BEV-003', 'عصير برتقال ١ لتر', 'Orange juice 1L', 'مشروبات', 12, 6, '21.0000', '28.0000', '14', '96', true],
  ['BEV-004', 'عصير مانجو ١ لتر', 'Mango juice 1L', 'مشروبات', 12, 6, '23.0000', '30.0000', '14', '96', true],
  ['BEV-005', 'مشروب غازي ١.٥ لتر', 'Soft drink 1.5L', 'مشروبات', 6, 3, '18.0000', '24.0000', '14', '120', true],
  ['BEV-006', 'مشروب غازي ٣٣٠ مل', 'Soft drink can 330ml', 'مشروبات', 24, 12, '9.0000', '13.0000', '14', '240', true],
  ['BEV-007', 'شاي مثلج ٥٠٠ مل', 'Iced tea 500ml', 'مشروبات', 12, 6, '12.0000', '17.0000', '14', '96', true],
  ['BEV-008', 'مياه غازية ٧٥٠ مل', 'Sparkling water 750ml', 'مشروبات', 12, 6, '11.0000', '15.0000', '14', '96', true],
  ['CLN-001', 'مسحوق غسيل ٤ كجم', 'Laundry powder 4kg', 'منظفات', 4, 1, '148.0000', '178.0000', '14', '20', true],
  ['CLN-002', 'صابون تواليت ١٢٠ جم', 'Toilet soap 120g', 'منظفات', 48, 24, '9.0000', '13.0000', '14', '144', true],
  ['CLN-003', 'كلور ١ لتر', 'Bleach 1L', 'منظفات', 12, 6, '14.0000', '19.0000', '14', '72', true],
  ['CLN-004', 'سائل أطباق ١ لتر', 'Dish liquid 1L', 'منظفات', 12, 6, '26.0000', '34.0000', '14', '72', true],
  ['CLN-005', 'منظف أرضيات ٢ لتر', 'Floor cleaner 2L', 'منظفات', 6, 3, '42.0000', '54.0000', '14', '36', true],
  ['CLN-006', 'معطر جو ٣٠٠ مل', 'Air freshener 300ml', 'منظفات', 12, 6, '28.0000', '37.0000', '14', '48', true],
  ['CLN-007', 'صابون سائل ٥ لتر', 'Liquid soap 5L', 'منظفات', 4, 1, '96.0000', '122.0000', '14', '16', true],
  ['CLN-008', 'مسحوق غسيل أطباق ٢ كجم', 'Dishwasher powder 2kg', 'منظفات', 6, 1, '88.0000', '112.0000', '14', '24', true],
  ['PAP-000', 'مناديل سفرة ٥٠ منديل', 'Napkins 50', 'ورقيات', 24, 12, '11.0000', '15.0000', '14', '96', true],
  ['PAP-001', 'مناديل مطبخ لفة', 'Kitchen towel roll', 'ورقيات', 1, 0, '22.0000', '30.0000', '14', '60', true],
  ['PAP-002', 'مناديل ورقية ٢٠٠ منديل', 'Facial tissues 200', 'ورقيات', 24, 12, '13.0000', '18.0000', '14', '120', true],
  ['PAP-003', 'أكياس قمامة ٢٥ كيس', 'Garbage bags 25', 'ورقيات', 12, 6, '18.0000', '25.0000', '14', '60', true],
  ['PAP-004', 'مناديل مبللة ٨٠ منديل', 'Wet wipes 80', 'ورقيات', 24, 12, '16.0000', '22.0000', '14', '72', true],
  ['SRV-001', 'خدمة نقل وتوزيع داخل القاهرة', 'Cairo delivery service', 'خدمات', 0, 0, '0.0000', '350.0000', '14', '0', false],
  ['SRV-002', 'تركيب وتجهيز رفوف عرض', 'Shelf installation service', 'خدمات', 0, 0, '0.0000', '1200.0000', '14', '0', false],
];

const CATEGORIES = ['زيوت', 'بقالة جافة', 'معلبات', 'مشروبات', 'منظفات', 'ورقيات', 'خدمات'];

/// A two-page letterhead: the first page is the sheet most offers print on, the
/// second is the continuation sheet. Both carry a band and the fictional
/// company's name, so a printed offer is visibly on the company's paper.
async function letterhead(nameAr) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  for (const [index, [width, height]] of [[595, 842], [595, 842]].entries()) {
    const page = document.addPage([width, height]);
    page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color: rgb(0.04, 0.33, 0.23) });
    page.drawRectangle({ x: 0, y: 0, width, height: 40, color: rgb(0.04, 0.33, 0.23) });
    page.drawText(index === 0 ? 'AL NAKHEEL TRADING' : 'AL NAKHEEL - CONTINUATION', {
      x: 40,
      y: height - 62,
      size: 22,
      font,
      color: rgb(1, 1, 1),
    });
  }
  return Buffer.from(await document.save());
}

// ────────────────────────────────────────────────────────────── the run

async function main() {
  const health = await must('read the health of the API', '/health');
  if (health.database !== 'up') throw new SeedError('The API cannot reach its database.');
  console.log(`API ${API} · database ${health.databaseName} · needsSetup ${health.needsSetup}`);

  // ── 1. the company -------------------------------------------------------
  phase('Create the company through the first-run setup');
  const setup = await api('/setup/status');
  if (setup.data?.needsSetup !== false && health.needsSetup) {
    await must('run the first-run setup', '/setup/initial', {
      method: 'POST',
      json: {
        companyCode: COMPANY_CODE,
        companyNameAr: 'شركة النخيل للتجارة والتوزيع',
        companyNameEn: 'Al Nakheel Trading & Distribution Co.',
        phone: '+20 2 2598 7412',
        email: 'info@alnakheel-demo.test',
        address: '٢٧ شارع الجيزة، الدقي، الجيزة',
        facilityKind: 'HEADQUARTERS',
        hqCode: 'CAI',
        hqNameEn: 'Cairo head office',
        hqNameAr: 'المقر الرئيسي - القاهرة',
        unitCode: 'CAI',
        unitNameEn: 'Cairo head office',
        unitNameAr: 'المقر الرئيسي - القاهرة',
        adminUsername: ADMIN_USERNAME,
        adminPassword: ADMIN_PASSWORD,
        adminFullNameEn: 'Demo Administrator',
        adminFullNameAr: 'مدير النظام التجريبي',
        seedChartOfAccounts: true,
      },
    });
    console.log('setup completed');
  } else {
    console.log('this installation already holds a company; signing in to it');
  }

  const login = await must('sign in as the administrator', '/auth/login', {
    method: 'POST',
    json: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    token: '',
  });
  token = login.accessToken;
  if (!token) throw new SeedError('Sign-in returned no access token.');

  const me = await must('read the session', '/auth/me');
  const companyId = (me.user ?? me).companyId;
  console.log(`signed in · company ${companyId}`);

  const profile = await must('read the company profile', '/company/profile');
  if (profile.code !== COMPANY_CODE && !FORCE) {
    throw new SeedError(
      `This installation belongs to company "${profile.code}", not ${COMPANY_CODE}. ` +
        'The demo seed only fills an installation it created; use an isolated database.',
    );
  }

  // A second run must not double the books. The seed's own first customer is
  // the marker: it exists only if this script has already filled the company.
  const existing = await must('look for the demo customers', '/parties/customers?pageSize=1');
  const existingItems = existing.items ?? existing;
  if (Array.isArray(existingItems) && existingItems.length > 0 && !FORCE) {
    throw new SeedError(
      'This company already holds customers, so the demo was seeded before. ' +
        'Use a fresh database, or --force to add a second copy deliberately.',
    );
  }

  await must('write the company profile', '/company/profile', {
    method: 'PATCH',
    json: {
      taxId: '512-847-963',
      commercialRegistration: 'CR-2019-778451',
      addressAr: '٢٧ شارع الجيزة، الدقي، الجيزة، مصر',
      addressEn: '27 Giza Street, Dokki, Giza, Egypt',
      phone: '+20 2 2598 7412',
      email: 'info@alnakheel-demo.test',
    },
  });

  // ── 2. branches and warehouses ------------------------------------------
  phase('Create three branches and a warehouse in each');
  const branchesNow = await must('list the branches', '/company/branches');
  const branchList = Array.isArray(branchesNow) ? branchesNow : branchesNow.items ?? [];
  const main = branchList.find((row) => row.kind === 'HEADQUARTERS') ?? branchList[0];

  const giza = await must('create the Giza branch', '/company/branches', {
    method: 'POST',
    json: { code: 'GIZ', nameEn: 'Giza branch', nameAr: 'فرع الجيزة', kind: 'BRANCH' },
  });
  const alex = await must('create the Alexandria branch', '/company/branches', {
    method: 'POST',
    json: {
      code: 'ALX',
      nameEn: 'Alexandria branch',
      nameAr: 'فرع الإسكندرية',
      kind: 'BRANCH',
    },
  });

  const warehouseSpec = [
    [main.id, 'WH-CAI', 'مخزن القاهرة الرئيسي', 'Cairo main store'],
    [giza.id, 'WH-GIZ', 'مخزن الجيزة', 'Giza store'],
    [alex.id, 'WH-ALX', 'مخزن الإسكندرية', 'Alexandria store'],
  ];
  for (const [branchId, code, nameAr, nameEn] of warehouseSpec) {
    created.warehouses.push(
      await must(`create warehouse ${code}`, '/inventory/warehouses', {
        method: 'POST',
        json: { code, nameAr, nameEn, branchId },
      }),
    );
  }
  // Opening a branch opens a warehouse with it. The demo's own store becomes
  // the branch's default (that is the one an invoice without a warehouse lands
  // in), and the store the system opened stays as the reserve, so nothing that
  // the program created is thrown away or left pretending to be the main one.
  const allWarehouses = await must('list the warehouses', '/inventory/warehouses');
  const warehouseRows = (Array.isArray(allWarehouses) ? allWarehouses : allWarehouses.items ?? []);
  for (const [branchId, code] of [
    [main.id, 'WH-CAI'],
    [giza.id, 'WH-GIZ'],
    [alex.id, 'WH-ALX'],
  ]) {
    const own = warehouseRows.find((row) => row.branchId === branchId && row.code === code);
    const opened = warehouseRows.find((row) => row.branchId === branchId && row.code !== code);
    if (!own) throw new SeedError(`The warehouse ${code} was not created.`);
    await must(`make ${code} the branch default`, `/inventory/warehouses/${own.id}`, {
      method: 'PATCH',
      json: { isDefault: true },
    });
    if (opened) {
      await must(`rename ${opened.code} to a reserve store`, `/inventory/warehouses/${opened.id}`, {
        method: 'PATCH',
        json: { nameEn: 'Reserve store', nameAr: 'مخزن احتياطي' },
      });
    }
  }
  const cairoDefault = warehouseRows.find((row) => row.code === 'WH-CAI');
  created.warehouses.unshift(cairoDefault ?? created.warehouses[0]);

  // ── 3. cost centres, cash accounts, budgets' anchors ---------------------
  phase('Create cost centres and cash and bank accounts');
  const centres = [];
  for (const [code, nameAr, nameEn, type] of [
    ['CC-SALES', 'إدارة المبيعات', 'Sales department', 'DEPARTMENT'],
    ['CC-OPS', 'إدارة المخازن والتوزيع', 'Warehousing and distribution', 'DEPARTMENT'],
    ['CC-ADMIN', 'الإدارة العامة', 'Administration', 'DEPARTMENT'],
    ['CC-MKT', 'التسويق', 'Marketing', 'DEPARTMENT'],
    ['CC-PROJ', 'مشروع التوزيع بالدلتا', 'Delta distribution project', 'PROJECT'],
  ]) {
    centres.push(
      await must(`create cost centre ${code}`, '/accounting/cost-centers', {
        method: 'POST',
        json: { code, nameAr, nameEn, type, responsiblePerson: 'مدير تجريبي' },
      }),
    );
  }

  const chart = await must('read the chart of accounts', '/accounting/chart-of-accounts');
  const accounts = (Array.isArray(chart) ? chart : chart.items ?? chart.accounts ?? []);
  const accountByCode = new Map(accounts.map((row) => [row.code, row]));
  const acc = (code) => {
    const row = accountByCode.get(code);
    if (!row) throw new SeedError(`The chart has no account ${code}; the setup chart is not what was expected.`);
    return row.id;
  };

  // A second bank needs a ledger account of its own: two cash accounts may not
  // share one account, or their balances would be each other's.
  const bankLoanAccount = await must('create a second bank account in the ledger', '/accounting/chart-of-accounts', {
    method: 'POST',
    json: {
      code: '1106',
      nameEn: 'Bank — Cairo Amman branch',
      nameAr: 'بنك القاهرة عمان - فرع الدقي',
      type: 'ASSET',
      parentId: accountByCode.get('11')?.id,
      isPostable: true,
      cashFlowClass: 'OPERATING',
    },
  });
  const pettyAccount = await must('create the petty-cash account in the ledger', '/accounting/chart-of-accounts', {
    method: 'POST',
    json: {
      code: '1107',
      nameEn: 'Petty cash',
      nameAr: 'نقدية نثرية',
      type: 'ASSET',
      parentId: accountByCode.get('11')?.id,
      isPostable: true,
      cashFlowClass: 'OPERATING',
    },
  });
  accountByCode.set('1106', bankLoanAccount);
  accountByCode.set('1107', pettyAccount);

  created.cash.push(
    await must('create the main cash box', '/cash/accounts', {
      method: 'POST',
      json: { code: 'CASH-01', nameEn: 'Main cash box', nameAr: 'الصندوق الرئيسي', kind: 'CASH', accountId: acc('1101'), branchId: main.id },
    }),
  );
  created.cash.push(
    await must('create the main bank account', '/cash/accounts', {
      method: 'POST',
      json: { code: 'BANK-01', nameEn: 'NBE — current account', nameAr: 'البنك الأهلي المصري - الحساب الجاري', kind: 'BANK', accountId: acc('1102'), bankName: 'البنك الأهلي المصري', accountNumber: '1002-3456-7890-1234', iban: 'EG380019000500000001234567890', branchId: main.id },
    }),
  );
  created.cash.push(
    await must('create the second bank account', '/cash/accounts', {
      method: 'POST',
      json: { code: 'BANK-02', nameEn: 'Cairo Amman — Dokki', nameAr: 'بنك القاهرة عمان - الدقي', kind: 'BANK', accountId: acc('1106'), bankName: 'بنك القاهرة عمان', accountNumber: '2003-4567-8901-2345', branchId: main.id },
    }),
  );
  created.cash.push(
    await must('create the petty cash box', '/cash/accounts', {
      method: 'POST',
      json: { code: 'CASH-02', nameEn: 'Petty cash', nameAr: 'النقدية النثرية', kind: 'CASH', accountId: acc('1107'), branchId: main.id },
    }),
  );

  // ── 4. customers and suppliers ------------------------------------------
  phase('Create 25 customers and 15 suppliers');
  for (const [index, [nameAr, nameEn, city, termDays, creditLimit]] of CUSTOMERS.entries()) {
    const n = String(index + 1).padStart(3, '0');
    created.customers.push(
      await must(`create customer ${nameEn}`, '/parties/customers', {
        method: 'POST',
        json: {
          code: `CUS-${n}`,
          nameAr,
          nameEn,
          phone: `+20 100 000 ${String(1000 + index).slice(-4)}`,
          email: `customer${n}@alnakheel-demo.test`,
          taxNumber: `${300 + index}-${100 + index}-${500 + index}`,
          address: `${city}، مصر`,
          paymentTermDays: termDays,
          creditLimit,
          notes: 'عميل تجريبي للعرض والتدريب',
        },
      }),
    );
  }
  for (const [index, [nameAr, nameEn, city, termDays]] of SUPPLIERS.entries()) {
    const n = String(index + 1).padStart(3, '0');
    created.suppliers.push(
      await must(`create supplier ${nameEn}`, '/parties/suppliers', {
        method: 'POST',
        json: {
          code: `SUP-${n}`,
          nameAr,
          nameEn,
          phone: `+20 100 000 ${String(2000 + index).slice(-4)}`,
          email: `supplier${n}@alnakheel-demo.test`,
          taxNumber: `${400 + index}-${200 + index}-${600 + index}`,
          address: `${city}، مصر`,
          paymentTermDays: termDays,
          notes: 'مورد تجريبي للعرض والتدريب',
        },
      }),
    );
  }

  // ── 5. item categories, items and packing units --------------------------
  phase('Create categories, 50 items with base, carton, pack and roll units');
  const categoryIds = new Map();
  const categoryCodes = {
    زيوت: 'CAT-OIL',
    'بقالة جافة': 'CAT-DRY',
    معلبات: 'CAT-CAN',
    مشروبات: 'CAT-BEV',
    منظفات: 'CAT-CLN',
    ورقيات: 'CAT-PAP',
    خدمات: 'CAT-SRV',
  };
  for (const nameAr of CATEGORIES) {
    const nameEn = {
      زيوت: 'Oils',
      'بقالة جافة': 'Dry groceries',
      معلبات: 'Canned goods',
      مشروبات: 'Beverages',
      منظفات: 'Detergents',
      ورقيات: 'Paper products',
      خدمات: 'Services',
    }[nameAr];
    const row = await must(`create category ${nameAr}`, '/inventory/categories', {
      method: 'POST',
      json: { code: categoryCodes[nameAr], nameAr, nameEn },
    });
    categoryIds.set(nameAr, row.id);
  }

  for (const [index, spec] of ITEMS.entries()) {
    const [code, nameAr, nameEn, category, carton, pack, purchase, sale, tax, reorder, stocked] = spec;
    const item = await must(`create item ${code}`, '/inventory/items', {
      method: 'POST',
      json: {
        code,
        nameAr,
        nameEn,
        unit: 'قطعة',
        barcode: `62${String(index + 1).padStart(11, '0')}`,
        salePrice: sale,
        purchasePrice: purchase,
        reorderLevel: reorder,
        categoryId: categoryIds.get(category),
        taxRate: tax,
        isStockTracked: stocked,
        countryOfOrigin: stocked ? 'مصر' : undefined,
        notes: stocked ? 'صنف تجريبي للعرض' : 'خدمة غير مخزنية',
      },
    });
    created.items.push(item);

    if (stocked && carton > 1) {
      await must(`add the carton unit to ${code}`, `/inventory/items/${item.id}/units`, {
        method: 'POST',
        json: {
          unit: 'كرتونة',
          factor: String(carton),
          barcode: `72${String(index + 1).padStart(11, '0')}`,
          salePrice: (money(sale) * carton).toFixed(4),
          purchasePrice: (money(purchase) * carton).toFixed(4),
        },
      });
    }
    if (stocked && pack > 1) {
      await must(`add the pack unit to ${code}`, `/inventory/items/${item.id}/units`, {
        method: 'POST',
        json: {
          unit: 'عبوة',
          factor: String(pack),
          barcode: `82${String(index + 1).padStart(11, '0')}`,
          salePrice: (money(sale) * pack).toFixed(4),
          purchasePrice: (money(purchase) * pack).toFixed(4),
        },
      });
    }
    if (stocked && ['PAP', 'BEV', 'OIL'].includes(code.slice(0, 3))) {
      await must(`add the roll unit to ${code}`, `/inventory/items/${item.id}/units`, {
        method: 'POST',
        json: {
          unit: 'لفة',
          factor: '6',
          barcode: `92${String(index + 1).padStart(11, '0')}`,
          salePrice: (money(sale) * 6).toFixed(4),
          purchasePrice: (money(purchase) * 6).toFixed(4),
        },
      });
    }
  }

  return { companyId, branches: { main, giza, alex }, centres, accountByCode };
}

// ═══════════════════════════════════════════ stage two: the trading history
//
// Everything below is entered the way a person would enter it: through the
// program's own routes, in date order, with the draft/post step kept separate.
// Nothing is written into the database behind the API's back.

/// A small brand mark, drawn byte by byte: the demo needs a logo, and a demo
/// that ships a binary file from somewhere else is a demo with a provenance
/// problem. A 128x128 PNG of a green diamond.
function brandMarkPng(size = 128) {
  const crcTable = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();
  const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };

  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const start = y * (size * 3 + 1);
    raw[start] = 0;
    for (let x = 0; x < size; x += 1) {
      const dx = Math.abs(x - size / 2);
      const dy = Math.abs(y - size / 2);
      const inDiamond = dx + dy < size * 0.44;
      const inLeaf = inDiamond && dx + dy < size * 0.18;
      const at = start + 1 + x * 3;
      raw[at] = inLeaf ? 240 : inDiamond ? 6 : 255;
      raw[at + 1] = inLeaf ? 214 : inDiamond ? 84 : 255;
      raw[at + 2] = inLeaf ? 132 : inDiamond ? 60 : 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function uploadFile(path, buffer, filename, mime) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) {
    throw new SeedError(`Upload to ${path} failed (HTTP ${response.status}): ${JSON.stringify(data)?.slice(0, 400)}`);
  }
  return data;
}

const amount4 = (value) => Number(Number(value).toFixed(4)).toFixed(4);

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/// One job per document, ordered by the day it happened. The order is the
/// posting order: a receipt never precedes the invoice it settles and a
/// transfer never leaves a warehouse before the goods arrived.
const jobs = [];
function at(date, label, run) {
  jobs.push({ date, label, run });
}

const docs = {
  sales: {},
  purchases: {},
  salesReturns: [],
  purchaseReturns: [],
  vouchers: [],
  stock: [],
  journals: [],
  quotations: {},
  quotes: {},
};

async function runSecondStage(ctx) {
  const { branches, centres } = ctx;
  /// The creation response carries the item's own prices but not its units, so
  /// the catalogue is read back through the list route: the units are what
  /// makes a carton line mean twelve pieces.
  const itemList = await must('read the item catalogue', '/inventory/items?pageSize=200');
  const items = new Map((itemList.items ?? itemList).map((row) => [row.code, row]));
  const customers = new Map(created.customers.map((row) => [row.code, row]));
  const suppliers = new Map(created.suppliers.map((row) => [row.code, row]));
  const centreByCode = new Map(centres.map((row) => [row.code, row]));
  const cashByCode = new Map(created.cash.map((row) => [row.code, row]));
  const warehouseRows = await must('list the warehouses', '/inventory/warehouses');
  const warehouses = new Map((warehouseRows.items ?? warehouseRows).map((row) => [row.code, row]));

  const item = (code) => {
    const row = items.get(code);
    if (!row) throw new SeedError(`The demo plan names item ${code}, which was not created.`);
    return row;
  };
  const customer = (code) => {
    const row = customers.get(code);
    if (!row) throw new SeedError(`The demo plan names customer ${code}, which was not created.`);
    return row;
  };
  const supplier = (code) => {
    const row = suppliers.get(code);
    if (!row) throw new SeedError(`The demo plan names supplier ${code}, which was not created.`);
    return row;
  };
  const centre = (code) => centreByCode.get(code)?.id;
  const cash = (code) => cashByCode.get(code)?.id;
  const warehouse = (code) => warehouses.get(code)?.id;

  /// The price the item's own unit carries, so a line never has to guess what
  /// the catalogue means.
  const unitPrice = (code, unitName, side = 'sale') => {
    const row = item(code);
    const base = row.units.find((unit) => unit.isBase) ?? row.units[0];
    const unit = row.units.find((candidate) => candidate.unit === unitName) ?? base;
    const own = side === 'sale' ? unit.salePrice : unit.purchasePrice;
    if (own !== null && own !== undefined) return amount4(own);
    return amount4(side === 'sale' ? row.salePrice : row.purchasePrice);
  };

  // ── settings ------------------------------------------------------------
  phase('Company policy: tax, discounts, print prices and the size of a backup');

  await must('save the accounting policy', '/accounting/settings', {
    method: 'PATCH',
    json: {
      taxRate: '14',
      pricesIncludeTax: false,
      allowNegativeStock: false,
      approvalRequiredForJournal: false,
      segregationOfDuties: false,
      maxDiscountPercent: '15',
      showTaxIdOnQuotations: true,
      managerName: 'أحمد النخيلي',
      salesManagerName: 'منى عبد الرحمن',
      salesManagerPhone: '+20 100 555 7788',
      backupRetentionCount: 30,
      backupIntervalHours: 24,
    },
  });
  await must('save the print price policy', '/company/print-settings', {
    method: 'PUT',
    json: {
      settings: [
        { documentType: 'default', showSalePrice: true, showCost: true },
        { documentType: 'sales-invoice', showSalePrice: true, showCost: true },
        { documentType: 'purchase-invoice', showSalePrice: false, showCost: true },
        { documentType: 'sales-quotation', showSalePrice: true, showCost: false },
        { documentType: 'stock-document', showSalePrice: false, showCost: true },
        { documentType: 'stock', showSalePrice: false, showCost: true },
        { documentType: 'items', showSalePrice: true, showCost: true },
      ],
    },
  });

  const logo = brandMarkPng();
  await uploadFile('/company/logo', logo, 'al-nakheel-mark.png', 'image/png');
  console.log('company logo uploaded');
  created.logo = logo;

  // ── the shelves ----------------------------------------------------------
  phase('Opening figures: stock in three stores, receivables, payables and cash');

  /// The opening stock is the same shelf list in every store, at the cost the
  /// purchases will later be made at, so the weighted average has a defensible
  /// starting point.
  const stocked = [...items.values()].filter((row) => row.isStockTracked);
  const openingQty = (row) => {
    const spec = ITEMS.find((candidate) => candidate[0] === row.code);
    const carton = spec?.[4] ?? 1;
    return (carton > 1 ? carton * 60 : 240);
  };

  const openingStockLines = (share) =>
    stocked.map((row, index) => {
      const total = openingQty(row);
      const quantity = share(index, total);
      const cost = Number(row.purchasePrice);
      return {
        row,
        quantity,
        cost,
        value: Number((quantity * cost).toFixed(4)),
      };
    }).filter((line) => line.quantity > 0);

  const mainStock = openingStockLines((index, total) =>
    index % 5 === 0 ? Math.round(total * 0.45) : Math.round(total * 0.65),
  );
  const gizaStock = openingStockLines((_index, total) => Math.round(total * 0.2));
  const alexStock = openingStockLines((_index, total) => Math.round(total * 0.15));

  const inventoryAccount = (await must('read the chart of accounts', '/accounting/chart-of-accounts'));
  const chartRows = inventoryAccount.items ?? inventoryAccount;
  const accountId = (code) => {
    const row = chartRows.find((candidate) => candidate.code === code);
    if (!row) throw new SeedError(`The chart has no account ${code}.`);
    return row.id;
  };

  const openingReceivables = [...customers.values()].slice(0, 12).map((row, index) => ({
    accountId: accountId('1103'),
    customerId: row.id,
    debit: amount4(6500 + index * 1250),
    description: `رصيد افتتاحي - ${row.nameAr}`,
  }));
  const openingPayables = [...suppliers.values()].slice(0, 8).map((row, index) => ({
    accountId: accountId('2101'),
    supplierId: row.id,
    credit: amount4(9000 + index * 1800),
    description: `رصيد افتتاحي - ${row.nameAr}`,
  }));

  const openingDate = day(8, 1);
  const buildOpeningLines = (stockLines, extra) => {
    const lines = stockLines.map((line) => ({
      accountId: accountId('1104'),
      itemId: line.row.id,
      quantity: amount4(line.quantity),
      unitCost: amount4(line.cost),
      debit: amount4(line.value),
      description: `بضاعة أول المدة - ${line.row.nameAr}`,
    }));
    lines.push(...extra);
    return lines;
  };

  const debitTotal = (lines) => lines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0);
  const creditTotal = (lines) => lines.reduce((sum, line) => sum + Number(line.credit ?? 0), 0);

  const mainOpening = buildOpeningLines(mainStock, [
    ...openingReceivables,
    { accountId: accountId('1101'), debit: amount4(60000), description: 'رصيد الصندوق الرئيسي' },
    { accountId: accountId('1102'), debit: amount4(1200000), description: 'رصيد البنك الأهلي' },
    { accountId: accountId('1107'), debit: amount4(5000), description: 'رصيد النقدية النثرية' },
    ...openingPayables,
  ]);
  mainOpening.push({
    accountId: accountId('3101'),
    credit: amount4(debitTotal(mainOpening) - creditTotal(mainOpening)),
    description: 'رأس المال المدفوع - المقر الرئيسي',
  });

  const gizaOpening = buildOpeningLines(gizaStock, []);
  gizaOpening.push({
    accountId: accountId('3101'),
    credit: amount4(debitTotal(gizaOpening)),
    description: 'رأس المال المملوك لفرع الجيزة',
  });

  const alexOpening = buildOpeningLines(alexStock, []);
  alexOpening.push({
    accountId: accountId('3101'),
    credit: amount4(debitTotal(alexOpening)),
    description: 'رأس المال المملوك لفرع الإسكندرية',
  });

  for (const [branch, warehouseCode, lines, label] of [
    [branches.main, 'WH-CAI', mainOpening, 'main'],
    [branches.giza, 'WH-GIZ', gizaOpening, 'Giza'],
    [branches.alex, 'WH-ALX', alexOpening, 'Alexandria'],
  ]) {
    const document = await must(`create the ${label} opening balance`, '/accounting/opening-balances', {
      method: 'POST',
      json: {
        asOfDate: openingDate,
        branchId: branch.id,
        warehouseId: warehouse(warehouseCode),
        description: `أرصدة افتتاحية - ${label}`,
        lines,
      },
    });
    await must(`post the ${label} opening balance`, `/accounting/opening-balances/${document.id}/post`, {
      method: 'POST',
    });
    docs.opening = docs.opening ?? [];
    docs.opening.push(document);
  }
  console.log(
    `opening balances posted · ${mainStock.length + gizaStock.length + alexStock.length} stock lines · ` +
      `receivables ${openingReceivables.length} · payables ${openingPayables.length}`,
  );

  // ── the documents --------------------------------------------------------
  // Each helper below is the ordinary user path: create the draft, then post
  // it. The jobs are executed in date order at the end, so the ledger and the
  // stock ledger are written the way the year actually happened.

  const lineOf = (line, side) => ({
    itemId: item(line.code).id,
    quantity: String(line.qty),
    unitName: line.unit,
    unitPrice: unitPrice(line.code, line.unit, side),
    taxRate: line.tax ?? item(line.code).taxRate,
    discountType: line.discountType,
    discountPercent: line.discountPercent,
    discountAmount: line.discountAmount,
    costCenterId: line.centre ? centre(line.centre) : undefined,
  });

  async function createSalesInvoice(key, spec) {
    const invoice = await must(`create sales invoice ${key}`, '/sales/invoices', {
      method: 'POST',
      json: {
        invoiceDate: spec.date,
        dueDate: spec.dueDate ?? addDays(spec.date, 30),
        customerId: customer(spec.customer).id,
        warehouseId: warehouse(spec.warehouse ?? 'WH-CAI'),
        notes: spec.notes,
        discountType: spec.discountType,
        discountPercent: spec.discountPercent,
        discountAmount: spec.discountAmount,
        lines: spec.lines.map((line) => lineOf(line, 'sale')),
      },
    });
    const posted = await must(`post sales invoice ${key}`, `/sales/invoices/${invoice.id}/post`, {
      method: 'POST',
    });
    docs.sales[key] = { invoice, posted, customerId: customer(spec.customer).id };
    console.log(`  ${key} ${invoice.invoiceNumber} · ${invoice.totalAmount} EGP`);
    return docs.sales[key];
  }

  async function createPurchaseInvoice(key, spec) {
    const body = {
      invoiceDate: spec.date,
      dueDate: addDays(spec.date, 30),
      supplierId: supplier(spec.supplier).id,
      warehouseId: warehouse(spec.warehouse ?? 'WH-CAI'),
      supplierReference: spec.reference ?? `SUP-${key}`,
      notes: spec.notes,
      lines: spec.lines.map((line) => lineOf(line, 'purchase')),
    };
    if (spec.landedCost) {
      body.landedCostCharges = [{ description: 'نولون وشحن', amount: amount4(spec.landedCost) }];
    }
    const invoice = await must(`create purchase invoice ${key}`, '/purchases/invoices', {
      method: 'POST',
      json: body,
    });
    const posted = await must(`post purchase invoice ${key}`, `/purchases/invoices/${invoice.id}/post`, {
      method: 'POST',
    });
    docs.purchases[key] = { invoice, posted, supplierId: supplier(spec.supplier).id };
    console.log(`  ${key} ${invoice.invoiceNumber} · ${invoice.totalAmount} EGP`);
    return docs.purchases[key];
  }

  async function createReceipt(label, spec) {
    const voucher = await must(`create ${label}`, '/cash/vouchers', {
      method: 'POST',
      json: {
        kind: 'RECEIPT',
        cashAccountId: cash(spec.cashCode ?? 'CASH-01'),
        voucherDate: spec.date,
        amount: amount4(spec.amount),
        customerId: spec.customerId,
        description: spec.description,
        reference: spec.reference,
        allocations: spec.allocations ?? [],
      },
    });
    await must(`post ${label}`, `/cash/vouchers/${voucher.id}/post`, { method: 'POST' });
    docs.vouchers.push(voucher);
    console.log(`  ${label} ${voucher.voucherNumber} · ${amount4(spec.amount)} EGP`);
    return voucher;
  }

  async function createPayment(label, spec) {
    const voucher = await must(`create ${label}`, '/cash/vouchers', {
      method: 'POST',
      json: {
        kind: 'PAYMENT',
        cashAccountId: cash(spec.cashCode ?? 'BANK-01'),
        voucherDate: spec.date,
        amount: amount4(spec.amount),
        supplierId: spec.supplierId,
        customerId: spec.customerId,
        counterAccountId: spec.counterAccountId ? accountId(spec.counterAccountId) : undefined,
        costCenterId: spec.centre ? centre(spec.centre) : undefined,
        description: spec.description,
        reference: spec.reference,
        allocations: spec.allocations ?? [],
      },
    });
    await must(`post ${label}`, `/cash/vouchers/${voucher.id}/post`, { method: 'POST' });
    docs.vouchers.push(voucher);
    console.log(`  ${label} ${voucher.voucherNumber} · ${amount4(spec.amount)} EGP`);
    return voucher;
  }

  async function createJournal(label, spec) {
    const entry = await must(`create journal ${label}`, '/accounting/journal-entries', {
      method: 'POST',
      json: {
        entryDate: spec.date,
        description: spec.description,
        lines: spec.lines.map((line) => ({
          accountId: accountId(line.account),
          debit: line.debit ? amount4(line.debit) : undefined,
          credit: line.credit ? amount4(line.credit) : undefined,
          description: line.description,
          costCenterId: line.centre ? centre(line.centre) : undefined,
        })),
      },
    });
    await must(`post journal ${label}`, `/accounting/journal-entries/${entry.id}/post`, { method: 'POST' });
    docs.journals.push(entry);
    return entry;
  }

  async function createStockDocument(label, spec) {
    const document = await must(`create stock document ${label}`, '/inventory/stock-documents', {
      method: 'POST',
      json: spec,
    });
    await must(`post stock document ${label}`, `/inventory/stock-documents/${document.id}/post`, {
      method: 'POST',
    });
    docs.stock.push(document);
    console.log(`  ${label} ${document.documentNumber}`);
    return document;
  }

  // ── purchases -----------------------------------------------------------
  const purchases = [
    {
      key: 'P1',
      date: day(7, 4),
      supplier: 'SUP-001',
      supplierRef: 'INV-2026-8871',
      lines: [
        { code: 'OIL-001', qty: 40, unit: 'كرتونة' },
        { code: 'OIL-002', qty: 25, unit: 'كرتونة' },
        { code: 'DRY-001', qty: 30, unit: 'كرتونة' },
        { code: 'DRY-003', qty: 20, unit: 'كرتونة' },
        { code: 'CAN-001', qty: 15, unit: 'كرتونة' },
        { code: 'BEV-001', qty: 50, unit: 'كرتونة' },
        { code: 'CLN-001', qty: 20, unit: 'كرتونة' },
        { code: 'PAP-001', qty: 40, unit: 'لفة' },
      ],
      notes: 'توريد أول الموسم - مخزن القاهرة',
    },
    {
      key: 'P2',
      date: day(6, 10),
      supplier: 'SUP-004',
      supplierRef: 'INV-2026-4410',
      lines: [
        { code: 'DRY-004', qty: 25, unit: 'كرتونة' },
        { code: 'DRY-005', qty: 18, unit: 'كرتونة' },
        { code: 'CAN-002', qty: 20, unit: 'كرتونة' },
        { code: 'CAN-003', qty: 12, unit: 'كرتونة' },
        { code: 'BEV-002', qty: 30, unit: 'كرتونة' },
        { code: 'CLN-002', qty: 15, unit: 'كرتونة' },
      ],
    },
    {
      key: 'P3',
      date: day(5, 14),
      supplier: 'SUP-007',
      supplierRef: 'INV-2026-5523',
      lines: [
        { code: 'OIL-003', qty: 30, unit: 'كرتونة' },
        { code: 'DRY-006', qty: 25, unit: 'كرتونة' },
        { code: 'DRY-007', qty: 20, unit: 'كرتونة' },
        { code: 'CAN-004', qty: 10, unit: 'كرتونة' },
        { code: 'BEV-003', qty: 40, unit: 'كرتونة' },
        { code: 'CLN-003', qty: 18, unit: 'كرتونة' },
        { code: 'PAP-002', qty: 24, unit: 'كرتونة' },
      ],
      notes: 'توريد شهر الصيف',
    },
    {
      key: 'P4',
      date: day(3, 8),
      supplier: 'SUP-002',
      supplierRef: 'INV-2026-6690',
      landedCost: 1800,
      lines: [
        { code: 'DRY-008', qty: 20, unit: 'كرتونة' },
        { code: 'DRY-009', qty: 15, unit: 'كرتونة' },
        { code: 'CAN-005', qty: 12, unit: 'كرتونة' },
        { code: 'BEV-004', qty: 25, unit: 'كرتونة' },
        { code: 'CLN-004', qty: 10, unit: 'كرتونة' },
        { code: 'PAP-003', qty: 20, unit: 'كرتونة' },
      ],
      notes: 'شحنة مستوردة - نولون وشحن محمّل على تكلفة البضاعة',
    },
    {
      key: 'P5',
      date: day(1, 6),
      supplier: 'SUP-011',
      supplierRef: 'INV-2026-7712',
      lines: [
        { code: 'OIL-004', qty: 20, unit: 'كرتونة' },
        { code: 'DRY-010', qty: 18, unit: 'كرتونة' },
        { code: 'CAN-006', qty: 10, unit: 'كرتونة' },
        { code: 'BEV-005', qty: 20, unit: 'كرتونة' },
        { code: 'CLN-005', qty: 12, unit: 'كرتونة' },
      ],
    },
  ];

  for (const spec of purchases) {
    at(spec.date, `purchase ${spec.key}`, async () => {
      await createPurchaseInvoice(spec.key, {
        ...spec,
        reference: spec.supplierRef,
      });
    });
  }

  // ── sales ---------------------------------------------------------------
  const sales = [
    {
      key: 'S1', date: day(7, 12), customer: 'CUS-001', discountType: 'PERCENT', discountPercent: '5',
      lines: [
        { code: 'OIL-001', qty: 4, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'DRY-001', qty: 3, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'CAN-001', qty: 2, unit: 'كرتونة', centre: 'CC-SALES' },
      ],
      notes: 'أمر توزيع أسبوعي - الدلتا',
    },
    {
      key: 'S2', date: day(7, 22), customer: 'CUS-002', discountType: 'AMOUNT', discountAmount: '300',
      cash: 'CASH-01',
      lines: [
        { code: 'BEV-001', qty: 20, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'PAP-001', qty: 24, unit: 'لفة', centre: 'CC-SALES' },
      ],
      notes: 'بيع نقدي - عميل تجزئة',
    },
    {
      key: 'S3', date: day(6, 15), customer: 'CUS-003',
      lines: [
        { code: 'DRY-002', qty: 6, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'DRY-004', qty: 4, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'CAN-002', qty: 5, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'CLN-002', qty: 4, unit: 'كرتونة', centre: 'CC-SALES' },
      ],
    },
    {
      key: 'S4', date: day(6, 25), customer: 'CUS-005',
      lines: [
        { code: 'BEV-002', qty: 10, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'CAN-003', qty: 3, unit: 'كرتونة', centre: 'CC-SALES' },
      ],
      notes: 'بيع آجل - سداد جزئي',
    },
    {
      key: 'S5', date: day(5, 8), customer: 'CUS-007', discountType: 'PERCENT', discountPercent: '10',
      lines: [
        { code: 'OIL-002', qty: 5, unit: 'كرتونة', centre: 'CC-PROJ' },
        { code: 'DRY-006', qty: 4, unit: 'كرتونة', centre: 'CC-PROJ' },
        { code: 'CAN-004', qty: 3, unit: 'كرتونة', centre: 'CC-PROJ' },
        { code: 'BEV-003', qty: 6, unit: 'كرتونة', centre: 'CC-PROJ' },
        { code: 'CLN-003', qty: 2, unit: 'كرتونة', centre: 'CC-PROJ' },
      ],
      notes: 'عرض توزيع بالدلتا - خصم تعاقدي',
    },
    {
      key: 'S6', date: day(5, 20), customer: 'CUS-009', cash: 'CASH-01',
      lines: [
        { code: 'OIL-003', qty: 3, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'DRY-007', qty: 2, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'PAP-002', qty: 5, unit: 'كرتونة', centre: 'CC-SALES' },
      ],
    },
    {
      key: 'S7', date: day(4, 11), customer: 'CUS-011',
      lines: [
        { code: 'DRY-008', qty: 2, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'DRY-009', qty: 2, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'CAN-005', qty: 2, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'BEV-004', qty: 4, unit: 'كرتونة', centre: 'CC-SALES' },
      ],
    },
    {
      key: 'S8', date: day(4, 24), customer: 'CUS-013',
      lines: [
        { code: 'CLN-004', qty: 3, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'PAP-003', qty: 4, unit: 'كرتونة', centre: 'CC-SALES' },
      ],
    },
    {
      key: 'S9', date: day(3, 15), customer: 'CUS-015',
      lines: [
        { code: 'SRV-001', qty: 12, unit: 'قطعة', centre: 'CC-OPS' },
        { code: 'SRV-002', qty: 2, unit: 'قطعة', centre: 'CC-OPS' },
        { code: 'OIL-004', qty: 2, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'DRY-010', qty: 2, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'CAN-006', qty: 3, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'BEV-005', qty: 4, unit: 'كرتونة', centre: 'CC-SALES' },
      ],
      notes: 'خدمات توزيع وتركيب رفوف مع بضاعة',
    },
    {
      key: 'S10', date: day(3, 27), customer: 'CUS-017', cash: 'CASH-01',
      lines: [
        { code: 'CLN-005', qty: 2, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'OIL-001', qty: 1, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'DRY-003', qty: 3, unit: 'كرتونة', centre: 'CC-SALES' },
      ],
    },
    {
      key: 'S11', date: day(2, 10), customer: 'CUS-019',
      lines: [
        { code: 'BEV-001', qty: 8, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'BEV-002', qty: 6, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'CAN-001', qty: 2, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'PAP-001', qty: 12, unit: 'لفة', centre: 'CC-SALES' },
      ],
    },
    {
      key: 'S12', date: day(2, 22), customer: 'CUS-021',
      lines: [
        { code: 'DRY-005', qty: 4, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'DRY-011', qty: 3, unit: 'كرتونة', centre: 'CC-SALES' },
      ],
    },
    {
      key: 'S13', date: day(1, 9), customer: 'CUS-023', discountType: 'PERCENT', discountPercent: '7.5',
      lines: [
        { code: 'OIL-005', qty: 2, unit: 'كرتونة', centre: 'CC-PROJ' },
        { code: 'CAN-007', qty: 3, unit: 'كرتونة', centre: 'CC-PROJ' },
        { code: 'CAN-008', qty: 2, unit: 'كرتونة', centre: 'CC-PROJ' },
        { code: 'CLN-006', qty: 3, unit: 'كرتونة', centre: 'CC-PROJ' },
        { code: 'PAP-004', qty: 4, unit: 'كرتونة', centre: 'CC-PROJ' },
      ],
    },
    {
      key: 'S14', date: day(1, 20), customer: 'CUS-004', cash: 'CASH-01',
      lines: [
        { code: 'BEV-006', qty: 6, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'DRY-012', qty: 3, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'CAN-009', qty: 2, unit: 'كرتونة', centre: 'CC-SALES' },
      ],
    },
    {
      key: 'S15', date: day(0, 6), customer: 'CUS-006',
      lines: [
        { code: 'OIL-001', qty: 3, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'DRY-001', qty: 2, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'BEV-007', qty: 5, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'CLN-007', qty: 2, unit: 'كرتونة', centre: 'CC-SALES' },
      ],
    },
    {
      key: 'S16', date: day(0, 18), customer: 'CUS-008',
      lines: [
        { code: 'CAN-010', qty: 4, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'DRY-002', qty: 5, unit: 'كرتونة', centre: 'CC-SALES' },
        { code: 'BEV-008', qty: 3, unit: 'كرتونة', centre: 'CC-SALES' },
      ],
    },
  ];

  for (const spec of sales) {
    at(spec.date, `sales ${spec.key}`, async () => {
      const created2 = await createSalesInvoice(spec.key, spec);
      const total = created2.invoice.totalAmount;
      if (spec.cash) {
        await createReceipt(`receipt for ${spec.key}`, {
          date: spec.date,
          cashCode: spec.cash,
          customerId: created2.customerId,
          amount: total,
          description: `تحصيل نقدي - ${created2.invoice.invoiceNumber}`,
          reference: created2.invoice.invoiceNumber,
          allocations: [{ salesInvoiceId: created2.invoice.id, amount: amount4(total) }],
        });
      }
      if (spec.partial) {
        await createReceipt(`part payment for ${spec.key}`, {
          date: spec.partial.date,
          cashCode: spec.partial.cashCode ?? 'BANK-01',
          customerId: created2.customerId,
          amount: amount4(Number(total) * spec.partial.share),
          description: `دفعة تحت الحساب - ${created2.invoice.invoiceNumber}`,
          reference: created2.invoice.invoiceNumber,
          allocations: [
            { salesInvoiceId: created2.invoice.id, amount: amount4(Number(total) * spec.partial.share) },
          ],
        });
      }
    });
  }

  // Partial collections, dated after their invoices, so a balance is left.
  at(day(5, 26), 'part payment for S4', async () => {
    const invoice = docs.sales.S4.invoice;
    await createReceipt('part payment for S4', {
      date: day(5, 26),
      customerId: docs.sales.S4.customerId,
      amount: amount4(Number(invoice.totalAmount) * 0.4),
      description: `دفعة تحت الحساب - ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      allocations: [
        { salesInvoiceId: invoice.id, amount: amount4(Number(invoice.totalAmount) * 0.4) },
      ],
    });
  });
  at(day(3, 5), 'part payment for S7', async () => {
    const invoice = docs.sales.S7.invoice;
    await createReceipt('part payment for S7', {
      date: day(3, 5),
      customerId: docs.sales.S7.customerId,
      amount: amount4(Number(invoice.totalAmount) * 0.6),
      description: `تحصيل جزئي - ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      allocations: [
        { salesInvoiceId: invoice.id, amount: amount4(Number(invoice.totalAmount) * 0.6) },
      ],
    });
  });
  at(day(1, 28), 'part payment for S11', async () => {
    const invoice = docs.sales.S11.invoice;
    await createReceipt('part payment for S11', {
      date: day(1, 28),
      customerId: docs.sales.S11.customerId,
      amount: amount4(Number(invoice.totalAmount) * 0.5),
      description: `دفعة تحت الحساب - ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      allocations: [
        { salesInvoiceId: invoice.id, amount: amount4(Number(invoice.totalAmount) * 0.5) },
      ],
    });
  });

  // ── supplier payments ---------------------------------------------------
  at(day(6, 2), 'payment for P1', async () => {
    const invoice = docs.purchases.P1.invoice;
    const supplierId = docs.purchases.P1.supplierId;
    await createPayment('payment for P1', {
      date: day(6, 2),
      cashCode: 'BANK-01',
      supplierId,
      amount: amount4(Number(invoice.totalAmount) * 0.5),
      description: `سداد جزئي - ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      allocations: [
        { purchaseInvoiceId: invoice.id, amount: amount4(Number(invoice.totalAmount) * 0.5) },
      ],
    });
  });

  at(day(6, 20), 'payment for P2', async () => {
    const invoice = docs.purchases.P2.invoice;
    const supplierId = docs.purchases.P2.supplierId;
    await createPayment('payment for P2', {
      date: day(6, 20),
      supplierId,
      amount: invoice.totalAmount,
      description: `سداد كامل - ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      allocations: [{ purchaseInvoiceId: invoice.id, amount: amount4(invoice.totalAmount) }],
    });
  });

  at(day(4, 2), 'payment for P3', async () => {
    const invoice = docs.purchases.P3.invoice;
    const supplierId = docs.purchases.P3.supplierId;
    await createPayment('payment for P3', {
      date: day(4, 2),
      supplierId,
      amount: amount4(Number(invoice.totalAmount) * 0.3),
      description: `دفعة تحت الحساب - ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      allocations: [
        { purchaseInvoiceId: invoice.id, amount: amount4(Number(invoice.totalAmount) * 0.3) },
      ],
    });
  });

  at(day(3, 25), 'payment for P4', async () => {
    const invoice = docs.purchases.P4.invoice;
    const supplierId = docs.purchases.P4.supplierId;
    await createPayment('payment for P4', {
      date: day(3, 25),
      supplierId,
      amount: invoice.totalAmount,
      description: `سداد شحنة المستورد - ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      allocations: [{ purchaseInvoiceId: invoice.id, amount: amount4(invoice.totalAmount) }],
    });
  });

  at(day(1, 15), 'payment for P5', async () => {
    const invoice = docs.purchases.P5.invoice;
    const supplierId = docs.purchases.P5.supplierId;
    await createPayment('payment for P5', {
      date: day(1, 15),
      supplierId,
      amount: invoice.totalAmount,
      description: `سداد فاتورة - ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      allocations: [{ purchaseInvoiceId: invoice.id, amount: amount4(invoice.totalAmount) }],
    });
  });

  // ── returns -------------------------------------------------------------
  async function salesReturn(key, spec) {
    const original = docs.sales[spec.original].invoice;
    const detail = await must(`read invoice ${spec.original}`, `/sales/invoices/${original.id}`);
    const lines = (detail.lines ?? []).map((line) => {
      const asked = spec.lines.find(
        (candidate) => item(candidate.code).id === line.itemId && candidate.unit === line.unitName,
      );
      if (!asked) return null;
      return {
        originalLineId: line.id,
        quantity: String(asked.qty),
        unitName: line.unitName,
        unitPrice: line.unitPrice,
      };
    }).filter(Boolean);
    if (lines.length === 0) throw new SeedError(`The return ${key} names lines that are not on ${spec.original}.`);
    const created2 = await must(`create sales return ${key}`, '/returns/sales', {
      method: 'POST',
      json: {
        originalInvoiceId: original.id,
        returnDate: spec.date,
        reason: spec.reason,
        notes: spec.notes,
        lines,
      },
    });
    await must(`post sales return ${key}`, `/returns/sales/${created2.id}/post`, { method: 'POST' });
    docs.salesReturns.push(created2);
    console.log(`  ${key} ${created2.returnNumber ?? created2.documentNumber} · ${created2.totalAmount ?? ''}`);
  }

  async function purchaseReturn(key, spec) {
    const original = docs.purchases[spec.original].invoice;
    const detail = await must(`read invoice ${spec.original}`, `/purchases/invoices/${original.id}`);
    const lines = (detail.lines ?? []).map((line) => {
      const asked = spec.lines.find(
        (candidate) => item(candidate.code).id === line.itemId && candidate.unit === line.unitName,
      );
      if (!asked) return null;
      return {
        originalLineId: line.id,
        quantity: String(asked.qty),
        unitName: line.unitName,
        unitPrice: line.unitPrice,
      };
    }).filter(Boolean);
    if (lines.length === 0) throw new SeedError(`The return ${key} names lines that are not on ${spec.original}.`);
    const created2 = await must(`create purchase return ${key}`, '/returns/purchases', {
      method: 'POST',
      json: {
        originalInvoiceId: original.id,
        returnDate: spec.date,
        reason: spec.reason,
        notes: spec.notes,
        lines,
      },
    });
    await must(`post purchase return ${key}`, `/returns/purchases/${created2.id}/post`, { method: 'POST' });
    docs.purchaseReturns.push(created2);
    console.log(`  ${key} ${created2.returnNumber ?? created2.documentNumber}`);
  }

  at(day(5, 25), 'sales return R1', async () => {
    await salesReturn('R1', {
      original: 'S3',
      date: day(5, 25),
      reason: 'تلف جزء من الشحنة أثناء النقل',
      notes: 'مرتجع بضاعة تالفة - إشعار دائن',
      lines: [
        { code: 'DRY-002', qty: 1, unit: 'كرتونة' },
        { code: 'CAN-002', qty: 1, unit: 'كرتونة' },
      ],
    });
  });

  at(day(4, 28), 'sales return R2', async () => {
    await salesReturn('R2', {
      original: 'S7',
      date: day(4, 28),
      reason: 'صنف غير مطابق للمواصفات',
      notes: 'إرجاع جزئي بموافقة العميل',
      lines: [{ code: 'BEV-004', qty: 1, unit: 'كرتونة' }],
    });
  });

  at(day(3, 2), 'purchase return PR1', async () => {
    await purchaseReturn('PR1', {
      original: 'P3',
      date: day(3, 2),
      reason: 'عبوات تالفة من المورد',
      notes: 'إشعار مدين على المورد',
      lines: [
        { code: 'DRY-007', qty: 2, unit: 'كرتونة' },
        { code: 'CAN-004', qty: 1, unit: 'كرتونة' },
      ],
    });
  });

  // ── stock documents ------------------------------------------------------
  at(day(6, 18), 'transfer to Giza', async () => {
    await createStockDocument('T1', {
      kind: 'TRANSFER',
      branchId: branches.giza.id,
      fromBranchId: branches.main.id,
      fromWarehouseId: warehouse('WH-CAI'),
      toWarehouseId: warehouse('WH-GIZ'),
      documentDate: day(6, 18),
      reason: 'تغذية مخزن الجيزة',
      lines: [
        { itemId: item('OIL-001').id, quantity: '5', unitName: 'كرتونة' },
        { itemId: item('DRY-002').id, quantity: '4', unitName: 'كرتونة' },
        { itemId: item('BEV-001').id, quantity: '8', unitName: 'كرتونة' },
      ],
    });
  });

  at(day(4, 5), 'transfer to Alexandria', async () => {
    await createStockDocument('T2', {
      kind: 'TRANSFER',
      branchId: branches.alex.id,
      fromBranchId: branches.main.id,
      fromWarehouseId: warehouse('WH-CAI'),
      toWarehouseId: warehouse('WH-ALX'),
      documentDate: day(4, 5),
      reason: 'تغذية مخزن الإسكندرية',
      lines: [
        { itemId: item('DRY-006').id, quantity: '3', unitName: 'كرتونة' },
        { itemId: item('CAN-004').id, quantity: '2', unitName: 'كرتونة' },
        { itemId: item('PAP-002').id, quantity: '4', unitName: 'كرتونة' },
      ],
    });
  });

  at(day(2, 4), 'transfer back from Giza', async () => {
    await createStockDocument('T3', {
      kind: 'TRANSFER',
      branchId: branches.main.id,
      fromBranchId: branches.giza.id,
      fromWarehouseId: warehouse('WH-GIZ'),
      toWarehouseId: warehouse('WH-CAI'),
      documentDate: day(2, 4),
      reason: 'إعادة رصيد راكد إلى المخزن الرئيسي',
      lines: [{ itemId: item('DRY-002').id, quantity: '3', unitName: 'كرتونة' }],
    });
  });

  at(day(0, 24), 'transfer into the reserve store', async () => {
    const reserve = (await must('list the warehouses', '/inventory/warehouses')).items.find(
      (row) => row.branchId === branches.main.id && !row.isDefault,
    );
    if (!reserve) throw new SeedError('The head office has no reserve store to transfer into.');
    await createStockDocument('T4', {
      kind: 'TRANSFER',
      branchId: branches.main.id,
      fromWarehouseId: warehouse('WH-CAI'),
      toWarehouseId: reserve.id,
      documentDate: day(0, 24),
      reason: 'تخزين بضاعة الموسم في المخزن الاحتياطي',
      lines: [
        { itemId: item('OIL-001').id, quantity: '2', unitName: 'كرتونة' },
        { itemId: item('PAP-002').id, quantity: '3', unitName: 'كرتونة' },
      ],
    });
  });

  at(day(4, 20), 'adjustment A1', async () => {
    await createStockDocument('A1', {
      kind: 'ADJUSTMENT',
      branchId: branches.main.id,
      toWarehouseId: warehouse('WH-CAI'),
      documentDate: day(4, 20),
      reason: 'فروق اكتشفت أثناء ترتيب المخزن - زيادة',
      costCenterId: centre('CC-OPS'),
      lines: [
        { itemId: item('DRY-005').id, quantity: '24', unitName: 'قطعة', unitCost: unitPrice('DRY-005', 'قطعة', 'purchase') },
        { itemId: item('CAN-003').id, quantity: '12', unitName: 'قطعة', unitCost: unitPrice('CAN-003', 'قطعة', 'purchase') },
      ],
    });
  });

  at(day(1, 25), 'adjustment A2', async () => {
    await createStockDocument('A2', {
      kind: 'ADJUSTMENT',
      branchId: branches.main.id,
      fromWarehouseId: warehouse('WH-CAI'),
      documentDate: day(1, 25),
      reason: 'بضاعة تالفة - إعدام',
      costCenterId: centre('CC-OPS'),
      lines: [
        { itemId: item('BEV-002').id, quantity: '-36', unitName: 'قطعة', unitCost: unitPrice('BEV-002', 'قطعة', 'purchase') },
        { itemId: item('PAP-001').id, quantity: '-12', unitName: 'قطعة', unitCost: unitPrice('PAP-001', 'قطعة', 'purchase') },
      ],
    });
  });

  at(day(0, 20), 'physical count C1', async () => {
    const counted = [
      { code: 'DRY-001', delta: -12 },
      { code: 'CAN-001', delta: -4 },
      { code: 'DRY-003', delta: 8 },
      { code: 'CLN-002', delta: 6 },
    ];
    const ids = counted.map((row) => item(row.code).id);
    const balances = await must(
      'read the stock of the counted items',
      `/inventory/stock/by-warehouse?itemIds=${ids.join(',')}`,
    );
    const rows = balances.items ?? balances;
    const rowsById = new Map(rows.map((row) => [row.itemId, row]));
    const qtyOf = (row) => {
      const places = row.warehouses ?? row.balances ?? row.stock ?? [];
      const main2 = places.find((place) => place.warehouseId === warehouse('WH-CAI'));
      return Number(main2?.quantity ?? 0);
    };
    const lines = counted.map((row) => {
      const system = qtyOf(rowsById.get(item(row.code).id));
      return {
        itemId: item(row.code).id,
        countedQuantity: String(system + row.delta),
        unitCost: unitPrice(row.code, 'قطعة', 'purchase'),
        notes: row.delta < 0 ? 'عجز جرد' : 'زيادة جرد',
      };
    });
    await createStockDocument('C1', {
      kind: 'COUNT',
      branchId: branches.main.id,
      toWarehouseId: warehouse('WH-CAI'),
      documentDate: day(0, 20),
      reason: 'جرد دوري للمخزن الرئيسي',
      costCenterId: centre('CC-OPS'),
      lines,
    });
    console.log(`  counted ${lines.length} items · system figures read from the stock ledger`);
  });

  // ── expenses, payroll and the monthly journals ---------------------------
  for (const monthsAgo of [7, 4, 1]) {
    at(day(monthsAgo, 3), `rent payment ${monthsAgo}`, async () => {
      await createPayment(`rent ${monthsAgo}`, {
        date: day(monthsAgo, 3),
        cashCode: 'BANK-01',
        amount: 45000,
        counterAccountId: '5103',
        centre: 'CC-ADMIN',
        description: 'إيجار المقر الرئيسي والمخزن',
      });
    });
  }

  at(day(5, 10), 'utilities payment', async () => {
    await createPayment('utilities', {
      date: day(5, 10),
      cashCode: 'BANK-01',
      amount: 8400,
      counterAccountId: '5104',
      centre: 'CC-OPS',
      description: 'كهرباء ومياه المخازن',
    });
  });
  at(day(2, 10), 'utilities payment 2', async () => {
    await createPayment('utilities 2', {
      date: day(2, 10),
      cashCode: 'BANK-01',
      amount: 9100,
      counterAccountId: '5104',
      centre: 'CC-OPS',
      description: 'كهرباء ومياه المخازن - الربع الأخير',
    });
  });
  at(day(3, 12), 'marketing payment', async () => {
    await createPayment('marketing', {
      date: day(3, 12),
      cashCode: 'BANK-01',
      amount: 12500,
      counterAccountId: '5106',
      centre: 'CC-MKT',
      description: 'حملة تسويق المنتجات الجديدة',
    });
  });

  for (const monthsAgo of [6, 5, 4, 3, 2]) {
    at(day(monthsAgo, 28), `payroll journal ${monthsAgo}`, async () => {
      await createJournal(`payroll ${monthsAgo}`, {
        date: day(monthsAgo, 28),
        description: 'استحقاق رواتب الشهر',
        lines: [
          { account: '5102', debit: 120000, centre: 'CC-ADMIN', description: 'رواتب وأجور' },
          { account: '2104', credit: 120000, description: 'رواتب مستحقة' },
        ],
      });
    });
    at(day(monthsAgo - 1, 2), `salary payment ${monthsAgo}`, async () => {
      await createPayment(`salary ${monthsAgo}`, {
        date: day(monthsAgo - 1, 2),
        cashCode: 'BANK-01',
        amount: 120000,
        counterAccountId: '2104',
        description: 'صرف رواتب الشهر السابق',
      });
    });
  }

  at(day(6, 27), 'rent accrual', async () => {
    await createJournal('rent accrual', {
      date: day(6, 27),
      description: 'إيجار مستحق عن الشهر',
      lines: [
        { account: '5103', debit: 45000, centre: 'CC-ADMIN', description: 'إيجار مستحق' },
        { account: '2102', credit: 45000, description: 'مصروفات مستحقة' },
      ],
    });
  });

  // ── fixed assets ---------------------------------------------------------
  // The register is real, so the depreciation in the ledger is the program's
  // own monthly run rather than a typed journal with nothing behind it.
  phase('Fixed assets: a delivery van and office furniture');
  const van = await must('register the delivery van', '/fixed-assets', {
    method: 'POST',
    json: {
      code: 'FA-VAN-01',
      nameEn: 'Refrigerated delivery van',
      nameAr: 'سيارة توزيع مبردة',
      description: 'سيارة توزيع مبردة لفرع القاهرة',
      category: 'Vehicles',
      purchaseDate: day(8, 2),
      inServiceDate: day(8, 2),
      cost: '480000.0000',
      salvageValue: '60000.0000',
      usefulLifeMonths: 60,
      assetAccountId: accountId('1202'),
      accumulatedAccountId: accountId('1203'),
      expenseAccountId: accountId('5105'),
      costCenterId: centre('CC-OPS'),
      location: 'مخزن القاهرة الرئيسي',
    },
  });
  await must('activate the delivery van', `/fixed-assets/${van.id}/activate`, {
    method: 'POST',
    json: { fundingAccountId: accountId('3101'), date: day(8, 2) },
  });
  const furniture = await must('register the office furniture', '/fixed-assets', {
    method: 'POST',
    json: {
      code: 'FA-FUR-01',
      nameEn: 'Office furniture and fittings',
      nameAr: 'أثاث وتجهيزات المكاتب',
      category: 'Furniture',
      purchaseDate: day(8, 3),
      inServiceDate: day(8, 3),
      cost: '120000.0000',
      usefulLifeMonths: 120,
      assetAccountId: accountId('1201'),
      accumulatedAccountId: accountId('1203'),
      expenseAccountId: accountId('5105'),
      costCenterId: centre('CC-ADMIN'),
      location: 'المقر الرئيسي - الدقي',
    },
  });
  await must('activate the office furniture', `/fixed-assets/${furniture.id}/activate`, {
    method: 'POST',
    json: { fundingAccountId: accountId('3101'), date: day(8, 3) },
  });
  docs.assets = [van, furniture];
  for (let monthsAgo = 7; monthsAgo >= 1; monthsAgo -= 1) {
    const date = day(monthsAgo, 28);
    const period = date.slice(0, 7);
    at(date, `depreciation ${period}`, async () => {
      await must(`run depreciation for ${period}`, '/fixed-assets/depreciation-runs', {
        method: 'POST',
        json: { period },
      });
    });
  }
  console.log(`fixed assets registered · ${docs.assets.length} · depreciation runs for 7 months`);

  // ── money between the company's own boxes --------------------------------
  at(day(2, 5), 'cash to bank transfer', async () => {
    const transfer = await must('create the cash-to-bank transfer', '/cash/transfers', {
      method: 'POST',
      json: {
        fromCashAccountId: cash('CASH-01'),
        toCashAccountId: cash('BANK-01'),
        transferDate: day(2, 5),
        amount: '25000.0000',
        description: 'إيداع نقدية الصندوق في البنك',
      },
    });
    await must('post the cash-to-bank transfer', `/cash/transfers/${transfer.id}/post`, { method: 'POST' });
    docs.transfers = [transfer];
  });

  at(day(0, 10), 'bank to petty transfer', async () => {
    const transfer = await must('create the bank-to-petty transfer', '/cash/transfers', {
      method: 'POST',
      json: {
        fromCashAccountId: cash('BANK-01'),
        toCashAccountId: cash('CASH-02'),
        transferDate: day(0, 10),
        amount: '5000.0000',
        description: 'تغذية النقدية النثرية',
      },
    });
    await must('post the bank-to-petty transfer', `/cash/transfers/${transfer.id}/post`, { method: 'POST' });
    docs.transfers.push(transfer);
  });

  // ── budgets --------------------------------------------------------------
  phase('Budgets for the year, by cost centre');
  const fiscalStart = `${YEAR}-01-01`;
  const fiscalEnd = `${YEAR}-12-31`;
  const budgetRows = [
    ['CC-SALES', '5102', 480000, 'رواتب فريق المبيعات'],
    ['CC-OPS', '5102', 360000, 'رواتب المخازن والتوزيع'],
    ['CC-ADMIN', '5102', 600000, 'رواتب الإدارة'],
    ['CC-ADMIN', '5103', 540000, 'إيجارات'],
    ['CC-OPS', '5104', 120000, 'كهرباء ومياه'],
    ['CC-MKT', '5106', 180000, 'تسويق وإعلان'],
    ['CC-PROJ', '5101', 900000, 'تكلفة مبيعات مشروع الدلتا'],
    ['CC-SALES', '5106', 60000, 'عمولات مندوبين'],
  ];
  for (const [centreCode, account, amount, notes] of budgetRows) {
    await must(`create budget ${centreCode}/${account}`, '/accounting/budgets', {
      method: 'POST',
      json: {
        costCenterId: centre(centreCode),
        accountId: accountId(account),
        periodStart: fiscalStart,
        periodEnd: fiscalEnd,
        amount: amount4(amount),
        notes,
      },
    });
  }
  console.log(`budgets saved · ${budgetRows.length}`);

  // ── the offer book -------------------------------------------------------
  phase('Quotation library, letterhead artwork and the offer book');
  const terms = [
    [
      'شروط التوريد القياسية',
      '١. الأسعار بالجنيه المصري ولا تشمل ضريبة القيمة المضافة إلا إذا نص البند على غير ذلك.\n' +
        '٢. صلاحية العرض ٣٠ يوماً من تاريخ الإصدار.\n' +
        '٣. التوريد خلال ٥ أيام عمل من استلام أمر الشراء.\n' +
        '٤. الدفع خلال ٣٠ يوماً من تاريخ الفاتورة.\n' +
        '٥. البضاعة المرتجعة تُقبل خلال ١٤ يوماً بحالتها الأصلية.',
    ],
    [
      'شروط مشروع التوزيع',
      '١. الأسعار معتمدة لكميات المشروع المتفق عليها فقط.\n' +
        '٢. تُحمّل مصاريف النقل على المشروع.\n' +
        '٣. تُسدد الدفعات على ثلاث مراحل مقابل مستخلصات موقعة.\n' +
        '٤. أي زيادة في الكميات تُسعّر بسعر اليوم.',
    ],
    [
      'شروط الخدمات',
      '١. الخدمة تُنفذ داخل القاهرة الكبرى؛ خارجها تُضاف مصاريف انتقال.\n' +
        '٢. مدة التنفيذ ١٠ أيام عمل من تاريخ الاعتماد.\n' +
        '٣. تُسدد ٥٠٪ مقدماً و٥٠٪ عند التسليم.',
    ],
  ];
  for (const [index, [title, body]] of terms.entries()) {
    await must(`save term ${title}`, '/sales/quotation-terms', {
      method: 'POST',
      json: { title, body, sortOrder: index },
    });
  }

  const standardColumns = [
    { key: 'itemCode', visible: true, width: 1 },
    { key: 'description', visible: true, width: 4 },
    { key: 'countryOfOrigin', visible: true, width: 1 },
    { key: 'unit', visible: true, width: 1 },
    { key: 'quantity', visible: true, width: 1 },
    { key: 'unitPrice', visible: true, width: 1 },
    { key: 'lineTotal', visible: true, width: 1 },
  ];
  await must('save the standard column template', '/sales/quotation-column-templates', {
    method: 'POST',
    json: { name: 'القالب القياسي', columns: standardColumns, isDefault: true },
  });
  await must('save the wholesale column template', '/sales/quotation-column-templates', {
    method: 'POST',
    json: {
      name: 'قالب الجملة',
      columns: [
        ...standardColumns,
        { key: 'packSize', labelAr: 'حجم الكرتونة', kind: 'text', visible: true, width: 1 },
      ],
    },
  });

  const brandDesign = {
    title: { color: '#0a5c3e', fontSizeMultiplier: 1.1, fontWeight: 'w700' },
    company: { color: '#0a5c3e', fontWeight: 'w700' },
    customer: { borderColor: '#c8d6cd', borderWidth: 0.2 },
    sectionTitle: { backgroundColor: '#eef4f0', color: '#0a5c3e' },
    tableHeader: { backgroundColor: '#0a5c3e', color: '#ffffff' },
    tableCell: { color: '#1f2a24' },
    totalsLabel: { color: '#33443a' },
    totalsValue: { color: '#1f2a24' },
    finalTotal: { backgroundColor: '#0a5c3e', color: '#ffffff', fontWeight: 'w700' },
    footer: { customText: 'شركة النخيل للتجارة والتوزيع · س.ت CR-2019-778451 · الرقم الضريبي 512-847-963' },
  };

  const background = await uploadFile(
    '/sales/quotation-backgrounds',
    await letterhead('شركة النخيل للتجارة والتوزيع'),
    'nakheel-letterhead.pdf',
    'application/pdf',
  );
  console.log(`letterhead artwork stored · ${background.pageCount ?? background.pages ?? '?'} pages`);

  await must('save the brand design template', '/sales/quotation-design-templates', {
    method: 'POST',
    json: {
      name: 'الهوية الخضراء',
      design: brandDesign,
      backgroundId: background.id,
      background: {
        mode: 'REPEAT',
        page: 1,
        showPageNumbers: true,
        marginMm: { top: 24, bottom: 20, left: 14, right: 14 },
      },
    },
  });
  await must('save the plain design template', '/sales/quotation-design-templates', {
    method: 'POST',
    json: {
      name: 'تصميم بسيط',
      design: { tableHeader: { backgroundColor: '#33443a', color: '#ffffff' } },
    },
  });

  const quotationSpecs = [
    {
      key: 'Q1',
      customer: 'CUS-002',
      date: day(2, 2),
      subject: 'عرض توريد أصناف بقالة ومشروبات',
      status: 'sent',
      tables: [
        {
          title: 'مواد غذائية',
          lines: [
            { code: 'OIL-001', qty: 10, unit: 'كرتونة' },
            { code: 'DRY-001', qty: 8, unit: 'كرتونة' },
            { code: 'DRY-003', qty: 12, unit: 'كرتونة' },
          ],
        },
        {
          title: 'مشروبات',
          discountType: 'AMOUNT',
          discountAmount: '250',
          lines: [
            { code: 'BEV-001', qty: 20, unit: 'كرتونة' },
            { code: 'BEV-002', qty: 15, unit: 'كرتونة' },
          ],
        },
      ],
    },
    {
      key: 'Q2',
      customer: 'CUS-010',
      date: day(0, 2),
      subject: 'عرض توريد منظفات وورقيات',
      status: 'converted',
      tables: [
        {
          title: 'منظفات وورقيات',
          lines: [
            { code: 'CLN-001', qty: 6, unit: 'كرتونة' },
            { code: 'CLN-002', qty: 10, unit: 'كرتونة' },
            { code: 'PAP-002', qty: 12, unit: 'كرتونة' },
          ],
        },
      ],
    },
    {
      key: 'Q3',
      customer: 'CUS-012',
      date: day(1, 5),
      subject: 'عرض أسعار خدمات توزيع',
      status: 'expired',
      tables: [
        {
          title: 'خدمات',
          lines: [
            { code: 'SRV-001', qty: 20, unit: 'قطعة' },
            { code: 'SRV-002', qty: 3, unit: 'قطعة' },
          ],
        },
      ],
    },
    {
      key: 'Q4',
      customer: 'CUS-016',
      date: day(0, 14),
      subject: 'عرض أصناف معلبات للموسم',
      status: 'accepted',
      tables: [
        {
          title: 'معلبات',
          lines: [
            { code: 'CAN-001', qty: 15, unit: 'كرتونة' },
            { code: 'CAN-002', qty: 12, unit: 'كرتونة' },
            { code: 'CAN-005', qty: 6, unit: 'كرتونة' },
          ],
        },
      ],
    },
    {
      key: 'Q6',
      customer: 'CUS-025',
      date: day(0, 16),
      subject: 'عرض أصناف مشروبات - عميل جديد',
      status: 'rejected',
      artwork: false,
      tables: [
        {
          title: 'مشروبات',
          lines: [
            { code: 'BEV-003', qty: 8, unit: 'كرتونة' },
            { code: 'BEV-006', qty: 10, unit: 'كرتونة' },
          ],
        },
      ],
    },
    {
      key: 'Q5',
      customer: 'CUS-018',
      date: day(0, 22),
      subject: 'عرض مبدئي - زيوت',
      status: 'draft',
      artwork: false,
      tables: [
        {
          title: 'زيوت',
          lines: [
            { code: 'OIL-002', qty: 10, unit: 'كرتونة' },
            { code: 'OIL-003', qty: 8, unit: 'كرتونة' },
          ],
        },
      ],
    },
  ];

  for (const spec of quotationSpecs) {
    at(spec.date, `quotation ${spec.key}`, async () => {
      const quotation = await must(`create quotation ${spec.key}`, '/sales/quotations', {
        method: 'POST',
        json: {
          quotationDate: spec.date,
          validUntil: addDays(spec.date, 30),
          customerId: customer(spec.customer).id,
          currency: 'EGP',
          subject: spec.subject,
          terms: String(terms[0][1]),
          notes: 'الأسعار سارية حتى نهاية الشهر وتشمل التوصيل داخل القاهرة الكبرى.',
          showTaxId: true,
          managerName: 'أحمد النخيلي',
          responsibleName: 'منى عبد الرحمن',
          responsiblePhone: '+20 100 555 7788',
          columns: standardColumns,
          design: spec.artwork === false ? { tableHeader: brandDesign.tableHeader } : brandDesign,
          backgroundFileId: spec.artwork === false ? null : background.id,
          background:
            spec.artwork === false
              ? null
              : {
                  mode: 'REPEAT',
                  page: 1,
                  showPageNumbers: true,
                  marginMm: { top: 24, bottom: 20, left: 14, right: 14 },
                },
          tables: spec.tables.map((table) => ({
            title: table.title,
            discountType: table.discountType,
            discountAmount: table.discountAmount,
            lines: table.lines.map((line) => ({
              itemId: item(line.code).id,
              description: `${item(line.code).nameAr} - ${item(line.code).nameEn}`,
              countryOfOrigin: item(line.code).countryOfOrigin ?? 'مصر',
              unit: line.unit,
              quantity: String(line.qty),
              unitPrice: unitPrice(line.code, line.unit, 'sale'),
            })),
          })),
        },
      });
      docs.quotes[spec.key] = quotation;

      if (spec.status !== 'draft') {
        await must(`send quotation ${spec.key}`, `/sales/quotations/${quotation.id}/send`, {
          method: 'POST',
          json: { note: 'أُرسل بالبريد الإلكتروني إلى العميل' },
        });
      }
      if (spec.status === 'accepted' || spec.status === 'converted') {
        await must(`accept quotation ${spec.key}`, `/sales/quotations/${quotation.id}/accept`, {
          method: 'POST',
          json: { note: 'العميل وافق على الأسعار والكميات' },
        });
      }
      if (spec.status === 'rejected') {
        await must(`reject quotation ${spec.key}`, `/sales/quotations/${quotation.id}/reject`, {
          method: 'POST',
          json: { note: 'العميل فضّل مورداً آخر' },
        });
      }
      // The printable page is rendered to prove the design and the artwork are
      // actually laid out. The PDF version needs a browser on the machine; a
      // machine without one says so, and the print preview is then the proof.
      const print = await api(`/sales/quotations/${quotation.id}/print`);
      const pdf = await api(`/sales/quotations/${quotation.id}/pdf`);
      const browserMissing = (response) =>
        response.status === 400 &&
        /browser|متصفح/i.test(String(response.data?.detail ?? ''));
      let proof;
      if (typeof print.data === 'string' && print.status === 200) {
        proof = `print page ${print.data.length} chars`;
      } else if (browserMissing(print) && spec.artwork !== false) {
        // A letterhead offer is merged onto its artwork before printing, which
        // needs a browser. This machine has none, and the program says so
        // instead of printing the offer without the company's paper.
        proof = 'artwork merge needs a browser (not available on this machine)';
      } else {
        throw new SeedError(
          `The quotation print page for ${spec.key} did not render (HTTP ${print.status}): ` +
            JSON.stringify(print.data)?.slice(0, 300),
        );
      }
      const pdfNote =
        pdf.status === 200 && Buffer.isBuffer(pdf.data)
          ? `${pdf.data.length} bytes`
          : `${String(pdf.data?.detail ?? `HTTP ${pdf.status}`).slice(0, 80)}`;
      docs.quotePrints = docs.quotePrints ?? {};
      docs.quotePrints[spec.key] = { proof, pdf: pdfNote };
      console.log(`  ${spec.key} ${quotation.quotationNumber ?? ''} · ${proof} · ${spec.status}`);
    });
  }

  at(day(0, 9), 'convert Q2 into an invoice', async () => {
    const quotation = docs.quotes.Q2;
    const converted = await must('convert Q2', `/sales/quotations/${quotation.id}/convert`, {
      method: 'POST',
      json: { invoiceDate: day(0, 9) },
    });
    const invoiceId = converted.invoice?.id ?? converted.invoiceId ?? converted.id;
    const invoice = await must(
      'read the converted invoice',
      `/sales/invoices/${invoiceId}`,
    );
    await must('post the converted invoice', `/sales/invoices/${invoiceId}/post`, { method: 'POST' });
    docs.sales.Q2I = { invoice, posted: invoice, customerId: invoice.customer.id };
    await createReceipt('part payment for Q2 invoice', {
      date: day(0, 12),
      customerId: invoice.customer.id,
      amount: amount4(Number(invoice.totalAmount) * 0.5),
      description: `دفعة مقدمة - ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      allocations: [
        { salesInvoiceId: invoiceId, amount: amount4(Number(invoice.totalAmount) * 0.5) },
      ],
    });
    console.log(`  Q2 → ${invoice.invoiceNumber} · ${invoice.totalAmount} EGP`);
  });

  // ── orders ---------------------------------------------------------------
  phase('Sales and purchase orders, part invoiced');

  at(day(1, 14), 'sales order SO1', async () => {
    const order = await must('create SO1', '/sales/orders', {
      method: 'POST',
      json: {
        customerId: customer('CUS-020').id,
        orderDate: day(1, 14),
        deliveryDate: day(1, 18),
        notes: 'طلب توريد شهري',
        lines: [
          { itemId: item('DRY-001').id, quantity: '4', unitName: 'كرتونة', unitPrice: unitPrice('DRY-001', 'كرتونة'), taxRate: item('DRY-001').taxRate },
          { itemId: item('CAN-001').id, quantity: '6', unitName: 'كرتونة', unitPrice: unitPrice('CAN-001', 'كرتونة'), taxRate: item('CAN-001').taxRate },
          { itemId: item('BEV-002').id, quantity: '10', unitName: 'كرتونة', unitPrice: unitPrice('BEV-002', 'كرتونة'), taxRate: item('BEV-002').taxRate },
        ],
      },
    });
    docs.so = docs.so ?? {};
    docs.so.SO1 = order;
    await must('approve SO1', `/sales/orders/${order.id}/approve`, { method: 'POST' });
    console.log(`  SO1 ${order.orderNumber ?? ''} approved`);
  });

  at(day(1, 18), 'invoice SO1', async () => {
    const order = docs.so.SO1;
    const result = await must('invoice SO1', `/sales/orders/${order.id}/invoice`, {
      method: 'POST',
      json: { invoiceDate: day(1, 18) },
    });
    const invoiceId = result.invoice?.id;
    await must('post the SO1 invoice', `/sales/invoices/${invoiceId}/post`, { method: 'POST' });
    const invoice = await must('read the SO1 invoice', `/sales/invoices/${invoiceId}`);
    docs.sales.SO1I = { invoice, posted: invoice };
    console.log(`  SO1 → ${invoice.invoiceNumber} · ${invoice.totalAmount} EGP`);
  });

  at(day(0, 5), 'sales order SO2', async () => {
    const order = await must('create SO2', '/sales/orders', {
      method: 'POST',
      json: {
        customerId: customer('CUS-022').id,
        orderDate: day(0, 5),
        deliveryDate: day(0, 20),
        notes: 'طلب معتمد في انتظار التوريد',
        lines: [
          { itemId: item('CLN-003').id, quantity: '5', unitName: 'كرتونة', unitPrice: unitPrice('CLN-003', 'كرتونة'), taxRate: item('CLN-003').taxRate },
          { itemId: item('PAP-003').id, quantity: '8', unitName: 'كرتونة', unitPrice: unitPrice('PAP-003', 'كرتونة'), taxRate: item('PAP-003').taxRate },
        ],
      },
    });
    docs.so.SO2 = order;
    await must('approve SO2', `/sales/orders/${order.id}/approve`, { method: 'POST' });
    console.log(`  SO2 ${order.orderNumber ?? ''} approved, awaiting delivery`);
  });

  at(day(0, 12), 'sales order SO3 draft', async () => {
    const order = await must('create SO3', '/sales/orders', {
      method: 'POST',
      json: {
        customerId: customer('CUS-024').id,
        orderDate: day(0, 12),
        notes: 'مسودة طلب بانتظار تأكيد العميل',
        lines: [
          { itemId: item('OIL-004').id, quantity: '2', unitName: 'كرتونة', unitPrice: unitPrice('OIL-004', 'كرتونة'), taxRate: item('OIL-004').taxRate },
        ],
      },
    });
    docs.so.SO3 = order;
    console.log(`  SO3 ${order.orderNumber ?? ''} draft`);
  });

  at(day(2, 15), 'purchase order PO1', async () => {
    const order = await must('create PO1', '/purchases/orders', {
      method: 'POST',
      json: {
        supplierId: supplier('SUP-006').id,
        orderDate: day(2, 15),
        expectedDate: day(2, 22),
        notes: 'أمر شراء موسمي',
        lines: [
          { itemId: item('DRY-011').id, quantity: '10', unitName: 'كرتونة', unitPrice: unitPrice('DRY-011', 'كرتونة', 'purchase'), taxRate: item('DRY-011').taxRate },
          { itemId: item('CAN-009').id, quantity: '12', unitName: 'كرتونة', unitPrice: unitPrice('CAN-009', 'كرتونة', 'purchase'), taxRate: item('CAN-009').taxRate },
        ],
      },
    });
    docs.po = docs.po ?? {};
    docs.po.PO1 = order;
    await must('approve PO1', `/purchases/orders/${order.id}/approve`, { method: 'POST' });
    console.log(`  PO1 ${order.orderNumber ?? ''} approved`);
  });

  at(day(2, 20), 'invoice PO1', async () => {
    const order = docs.po.PO1;
    const result = await must('invoice PO1', `/purchases/orders/${order.id}/invoice`, {
      method: 'POST',
      json: { invoiceDate: day(2, 20) },
    });
    const invoiceId = result.invoice?.id;
    await must('post the PO1 invoice', `/purchases/invoices/${invoiceId}/post`, { method: 'POST' });
    const invoice = await must('read the PO1 invoice', `/purchases/invoices/${invoiceId}`);
    docs.purchases.PO1I = { invoice, posted: invoice };
    console.log(`  PO1 → ${invoice.invoiceNumber} · ${invoice.totalAmount} EGP`);
  });

  at(day(0, 8), 'purchase order PO2', async () => {
    const order = await must('create PO2', '/purchases/orders', {
      method: 'POST',
      json: {
        supplierId: supplier('SUP-009').id,
        orderDate: day(0, 8),
        expectedDate: day(0, 25),
        notes: 'أمر شراء في انتظار الاستلام',
        lines: [
          { itemId: item('PAP-004').id, quantity: '10', unitName: 'كرتونة', unitPrice: unitPrice('PAP-004', 'كرتونة', 'purchase'), taxRate: item('PAP-004').taxRate },
          { itemId: item('CLN-008').id, quantity: '6', unitName: 'كرتونة', unitPrice: unitPrice('CLN-008', 'كرتونة', 'purchase'), taxRate: item('CLN-008').taxRate },
        ],
      },
    });
    docs.po.PO2 = order;
    await must('approve PO2', `/purchases/orders/${order.id}/approve`, { method: 'POST' });
    console.log(`  PO2 ${order.orderNumber ?? ''} approved, awaiting receipt`);
  });

  // ── run the year ---------------------------------------------------------
  phase(`Post ${jobs.length} documents in date order`);
  jobs.sort((left, right) => left.date.localeCompare(right.date));
  let lastDate = '';
  for (const job of jobs) {
    if (job.date !== lastDate) {
      console.log(`\n  ── ${job.date}`);
      lastDate = job.date;
    }
    await job.run();
  }

  return docs;
}

// ─────────────────────────────────────────────────────────── the entry point

async function download(path) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new SeedError(`Download of ${path} failed (HTTP ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

try {
  const context = await main();
  await runSecondStage(context);

  phase('Export the company through the program’s own backup service');
  const backup = await download('/backup/download');
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, backup);
  const digest = createHash('sha256').update(backup).digest('hex');

  const parsed = JSON.parse(backup.toString('utf8'));
  const counts = Object.fromEntries(
    Object.entries(parsed.tables ?? {}).map(([table, entry]) => [
      table,
      Array.isArray(entry?.rows) ? entry.rows.length : Array.isArray(entry) ? entry.length : null,
    ]),
  );
  console.log('\nBackup written.');
  console.log(`  file    ${OUT}`);
  console.log(`  bytes   ${backup.length}`);
  console.log(`  sha256  ${digest}`);
  console.log(`  version ${parsed.version}`);
  console.log(`  tables  ${Object.keys(counts).length}`);
  const interesting = [
    'customer', 'supplier', 'item', 'itemUnit', 'warehouse', 'branch',
    'salesInvoice', 'salesInvoiceLine', 'purchaseInvoice', 'purchaseInvoiceLine',
    'stockMovement', 'stockDocument', 'journalEntry', 'journalLine',
    'cashVoucher', 'cashAccount', 'quotation', 'salesOrder', 'purchaseOrder',
    'openingBalance', 'budget', 'costCenter', 'returnDocument',
  ];
  for (const table of interesting) {
    if (counts[table] !== undefined) console.log(`  ${table.padEnd(22)} ${counts[table]}`);
  }
  writeFileSync(resolve(dirname(OUT), 'KAYAN-Demo-Company-v2-summary.json'), JSON.stringify({
    file: OUT.split('/').pop(),
    bytes: backup.length,
    sha256: digest,
    version: parsed.version,
    companyCode: parsed.companyCode,
    generatedAt: parsed.generatedAt,
    counts,
  }, null, 2));
} catch (error) {
  console.error(`\nSEED FAILED: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof Error && error.stack) console.error(error.stack.split('\n').slice(0, 4).join('\n'));
  process.exitCode = 1;
}
