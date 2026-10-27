/**
 * Builds the fictional demo company that the demo backup file is made from.
 *
 * Everything here is invented: the company, its people, its customers, its
 * suppliers and every number in it. It exists so that the program can be
 * judged with a full set of books in front of it — a chart of accounts with
 * real depth, a year of postings, stock that moves, customers who owe money
 * and suppliers who are owed — rather than with an empty database.
 *
 * It is written against the real schema, with the real enums, the real
 * required fields and the real constraints, and it holds itself to the rules
 * the program holds itself to:
 *
 *  * every journal entry balances, and its stored totals equal the sum of
 *    its lines (the same check the restore path makes);
 *  * an invoice's lines add up to the invoice's stored totals;
 *  * a stock movement and the running balance it feeds stay in step;
 *  * children are created after their parents, and nothing is deleted.
 *
 * Numbers are produced by a seeded generator, so running this twice on two
 * clean databases gives byte-for-byte the same books — which is what makes
 * the backup reproducible and its checksum worth publishing.
 *
 *   DATABASE_URL=... npx ts-node --transpile-only prisma/seed-demo.ts
 *
 * Never run this against a database that holds real records: it clears the
 * demo company before it builds it.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AccountType,
  BranchKind,
  InvoiceStatus,
  JournalStatus,
  PeriodStatus,
  PrismaClient,
  StockDirection,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { deflateSync } from 'node:zlib';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ──────────────────────────────────────────────────── a repeatable randomness

/// A tiny seeded generator. `Math.random` would make every run different, and
/// a demo backup that changes every time it is built is one nobody can trust.
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = generator(20260101);

/// A whole number in [min, max].
function between(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function pick<T>(items: readonly T[]): T {
  return items[between(0, items.length - 1)]!;
}

/// Two decimals, the way money is written.
const money = (value: number): string => value.toFixed(2);

/// Four decimals, the way the database stores it.
const quantity = (value: number): string => value.toFixed(4);

/// A date as the database stores it: midnight UTC on that calendar day.
function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function addDays(iso: string, days: number): string {
  const date = day(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ────────────────────────────────────────────────────────── the cast of data

const COMPANY = {
  code: 'NAKHEEL',
  nameEn: 'Al Nakheel Trading & Distribution',
  nameAr: 'النخيل للتجارة والتوزيع',
  taxId: '621-431-975',
  phone: '+20 2 2735 4410',
  email: 'accounts@alnakheel-demo.example',
  address: '14 Tahrir Street, Dokki, Giza, Egypt',
  currency: 'EGP',
  timezone: 'Africa/Cairo',
};

const BRANCHES = [
  {
    code: 'MAIN',
    nameEn: 'Head Office — Dokki',
    nameAr: 'المركز الرئيسي — الدقي',
    kind: BranchKind.HEADQUARTERS,
  },
  {
    code: 'ALX',
    nameEn: 'Alexandria Branch',
    nameAr: 'فرع الإسكندرية',
    kind: BranchKind.BRANCH,
  },
  {
    code: 'MNS',
    nameEn: 'Mansoura Branch',
    nameAr: 'فرع المنصورة',
    kind: BranchKind.BRANCH,
  },
] as const;

/// The chart of accounts, with the depth a real company's has.
///
/// Codes are hierarchical by convention (11 is inside 1, 1101 inside 11) but
/// the tree is held by `parent`, which is what the program walks.
const ACCOUNTS: Array<{
  code: string;
  nameEn: string;
  nameAr: string;
  type: AccountType;
  parent?: string;
  postable: boolean;
}> = [
  { code: '1', nameEn: 'Assets', nameAr: 'الأصول', type: AccountType.ASSET, postable: false },
  { code: '11', nameEn: 'Current assets', nameAr: 'الأصول المتداولة', type: AccountType.ASSET, parent: '1', postable: false },
  { code: '1101', nameEn: 'Cash on hand', nameAr: 'النقدية بالصندوق', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '1102', nameEn: 'Bank — CIB current account', nameAr: 'البنك التجاري — حساب جارٍ', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '1103', nameEn: 'Bank — QNB current account', nameAr: 'بنك قطر الوطني — حساب جارٍ', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '1104', nameEn: 'Accounts receivable — trade', nameAr: 'العملاء — أرصدة مدينة', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '1105', nameEn: 'Inventory', nameAr: 'المخزون', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '1106', nameEn: 'Input VAT', nameAr: 'ضريبة القيمة المضافة — مدخلات', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '1107', nameEn: 'Advances to suppliers', nameAr: 'مقدمات للموردين', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '1108', nameEn: 'Prepaid expenses', nameAr: 'مصروفات مقدمة', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '12', nameEn: 'Non-current assets', nameAr: 'الأصول غير المتداولة', type: AccountType.ASSET, parent: '1', postable: false },
  { code: '1201', nameEn: 'Buildings', nameAr: 'المباني', type: AccountType.ASSET, parent: '12', postable: true },
  { code: '1202', nameEn: 'Vehicles', nameAr: 'السيارات', type: AccountType.ASSET, parent: '12', postable: true },
  { code: '1203', nameEn: 'Furniture and equipment', nameAr: 'الأثاث والتجهيزات', type: AccountType.ASSET, parent: '12', postable: true },
  { code: '1204', nameEn: 'Accumulated depreciation', nameAr: 'مجمع الإهلاك', type: AccountType.ASSET, parent: '12', postable: true },

  { code: '2', nameEn: 'Liabilities', nameAr: 'الالتزامات', type: AccountType.LIABILITY, postable: false },
  { code: '21', nameEn: 'Current liabilities', nameAr: 'التزامات متداولة', type: AccountType.LIABILITY, parent: '2', postable: false },
  { code: '2101', nameEn: 'Accounts payable — trade', nameAr: 'الموردون — أرصدة دائنة', type: AccountType.LIABILITY, parent: '21', postable: true },
  { code: '2102', nameEn: 'Output VAT payable', nameAr: 'ضريبة القيمة المضافة — مخرجات', type: AccountType.LIABILITY, parent: '21', postable: true },
  { code: '2103', nameEn: 'Accrued expenses', nameAr: 'مصروفات مستحقة', type: AccountType.LIABILITY, parent: '21', postable: true },
  { code: '2104', nameEn: 'Salaries payable', nameAr: 'رواتب مستحقة', type: AccountType.LIABILITY, parent: '21', postable: true },
  { code: '2105', nameEn: 'Withholding tax payable', nameAr: 'ضريبة الخصم والتحصيل', type: AccountType.LIABILITY, parent: '21', postable: true },
  { code: '22', nameEn: 'Non-current liabilities', nameAr: 'التزامات غير متداولة', type: AccountType.LIABILITY, parent: '2', postable: false },
  { code: '2201', nameEn: 'Long-term loans', nameAr: 'قروض طويلة الأجل', type: AccountType.LIABILITY, parent: '22', postable: true },

  { code: '3', nameEn: 'Equity', nameAr: 'حقوق الملكية', type: AccountType.EQUITY, postable: false },
  { code: '3101', nameEn: 'Share capital', nameAr: 'رأس المال', type: AccountType.EQUITY, parent: '3', postable: true },
  { code: '3102', nameEn: 'Retained earnings', nameAr: 'الأرباح المحتجزة', type: AccountType.EQUITY, parent: '3', postable: true },
  // 3103 is the opening-balance equity account the account map posts
  // opening balances to; it was labelled 'Owner drawings' here, which
  // is a different economic thing wearing the required code.
  { code: '3103', nameEn: 'Opening balance equity', nameAr: 'أرصدة افتتاحية', type: AccountType.EQUITY, parent: '3', postable: true },

  { code: '4', nameEn: 'Revenue', nameAr: 'الإيرادات', type: AccountType.REVENUE, postable: false },
  { code: '4101', nameEn: 'Sales revenue — wholesale', nameAr: 'إيرادات مبيعات الجملة', type: AccountType.REVENUE, parent: '4', postable: true },
  { code: '4102', nameEn: 'Sales revenue — retail', nameAr: 'إيرادات مبيعات التجزئة', type: AccountType.REVENUE, parent: '4', postable: true },
  { code: '4103', nameEn: 'Sales returns and allowances', nameAr: 'مردودات ومسموحات المبيعات', type: AccountType.REVENUE, parent: '4', postable: true },
  { code: '4104', nameEn: 'Other income', nameAr: 'إيرادات أخرى', type: AccountType.REVENUE, parent: '4', postable: true },

  { code: '5', nameEn: 'Expenses', nameAr: 'المصروفات', type: AccountType.EXPENSE, postable: false },
  { code: '5101', nameEn: 'Cost of goods sold', nameAr: 'تكلفة البضاعة المباعة', type: AccountType.EXPENSE, parent: '5', postable: true },
  { code: '5107', nameEn: 'Inventory differences', nameAr: 'فروق المخزون', type: AccountType.EXPENSE, parent: '5', postable: true },
  { code: '52', nameEn: 'Operating expenses', nameAr: 'المصروفات التشغيلية', type: AccountType.EXPENSE, parent: '5', postable: false },
  { code: '5201', nameEn: 'Salaries and wages', nameAr: 'الرواتب والأجور', type: AccountType.EXPENSE, parent: '52', postable: true },
  { code: '5202', nameEn: 'Rent', nameAr: 'الإيجار', type: AccountType.EXPENSE, parent: '52', postable: true },
  { code: '5203', nameEn: 'Electricity and water', nameAr: 'الكهرباء والمياه', type: AccountType.EXPENSE, parent: '52', postable: true },
  { code: '5204', nameEn: 'Transport and fuel', nameAr: 'النقل والوقود', type: AccountType.EXPENSE, parent: '52', postable: true },
  { code: '5205', nameEn: 'Marketing and advertising', nameAr: 'التسويق والإعلان', type: AccountType.EXPENSE, parent: '52', postable: true },
  { code: '5206', nameEn: 'Depreciation expense', nameAr: 'مصروف الإهلاك', type: AccountType.EXPENSE, parent: '52', postable: true },
  { code: '5207', nameEn: 'Bank charges', nameAr: 'مصروفات بنكية', type: AccountType.EXPENSE, parent: '52', postable: true },
  { code: '5208', nameEn: 'Repairs and maintenance', nameAr: 'الصيانة والإصلاح', type: AccountType.EXPENSE, parent: '52', postable: true },
  { code: '53', nameEn: 'Other expenses', nameAr: 'مصروفات أخرى', type: AccountType.EXPENSE, parent: '5', postable: false },
  { code: '5301', nameEn: 'Other expenses', nameAr: 'مصروفات متنوعة', type: AccountType.EXPENSE, parent: '53', postable: true },
];

const CUSTOMERS: Array<{
  code: string;
  nameEn: string;
  nameAr: string;
  city: string;
  credit: number;
}> = [
  { code: 'C-1001', nameEn: 'Delta Grocers', nameAr: 'دلتا للبقالة', city: 'Cairo', credit: 250000 },
  { code: 'C-1002', nameEn: 'Nile Minimarts', nameAr: 'أسواق النيل', city: 'Giza', credit: 180000 },
  { code: 'C-1003', nameEn: 'Alexandria Foods Co', nameAr: 'الإسكندرية للأغذية', city: 'Alexandria', credit: 320000 },
  { code: 'C-1004', nameEn: 'Said General Trading', nameAr: 'سعيد للتجارة العامة', city: 'Mansoura', credit: 120000 },
  { code: 'C-1005', nameEn: 'Palm Hotels Group', nameAr: 'مجموعة فنادق النخيل', city: 'Hurghada', credit: 400000 },
  { code: 'C-1006', nameEn: 'Zahraa Supermarkets', nameAr: 'أسواق الزهراء', city: 'Cairo', credit: 150000 },
  { code: 'C-1007', nameEn: 'Canal Wholesalers', nameAr: 'تجار القناة', city: 'Ismailia', credit: 200000 },
  { code: 'C-1008', nameEn: 'Upper Egypt Stores', nameAr: 'مخازن الصعيد', city: 'Assiut', credit: 90000 },
  { code: 'C-1009', nameEn: 'Marina Cafes', nameAr: 'كافيهات المارينا', city: 'Alexandria', credit: 60000 },
  { code: 'C-1010', nameEn: 'Fayoum Dairy', nameAr: 'الفيوم للألبان', city: 'Faiyum', credit: 75000 },
  { code: 'C-1011', nameEn: 'Tanta Textiles', nameAr: 'طنطا للمنسوجات', city: 'Tanta', credit: 110000 },
  { code: 'C-1012', nameEn: 'Red Sea Restaurants', nameAr: 'مطاعم البحر الأحمر', city: 'Hurghada', credit: 130000 },
  { code: 'C-1013', nameEn: 'Giza Bakeries', nameAr: 'مخابز الجيزة', city: 'Giza', credit: 55000 },
  { code: 'C-1014', nameEn: 'Delta Pharmacies', nameAr: 'صيدليات الدلتا', city: 'Mansoura', credit: 165000 },
];

const SUPPLIERS: Array<{
  code: string;
  nameEn: string;
  nameAr: string;
  city: string;
}> = [
  { code: 'S-2001', nameEn: 'Egyptian Sugar & Salt', nameAr: 'السكر والملح المصرية', city: 'Cairo' },
  { code: 'S-2002', nameEn: 'Nile Oils Company', nameAr: 'شركة زيوت النيل', city: 'Alexandria' },
  { code: 'S-2003', nameEn: 'Baraka Rice Mills', nameAr: 'مضارب البركة للأرز', city: 'Damietta' },
  { code: 'S-2004', nameEn: 'Sinai Packaging', nameAr: 'سيناء للتغليف', city: 'Suez' },
  { code: 'S-2005', nameEn: 'Cairo Detergents', nameAr: 'القاهرة للمنظفات', city: 'Cairo' },
  { code: 'S-2006', nameEn: 'Fayoum Farms', nameAr: 'مزارع الفيوم', city: 'Faiyum' },
  { code: 'S-2007', nameEn: 'Delta Dairy Products', nameAr: 'دلتا للألبان', city: 'Tanta' },
  { code: 'S-2008', nameEn: 'Orient Tea & Coffee', nameAr: 'أورينت للشاي والقهوة', city: 'Cairo' },
  { code: 'S-2009', nameEn: 'Alex Paper Products', nameAr: 'الإسكندرية للورق', city: 'Alexandria' },
];

/// The catalogue. `family` is not a model in this program — it is carried in
/// the code prefix and the notes, which is how the item screen shows it.
const ITEMS: Array<{
  code: string;
  nameEn: string;
  nameAr: string;
  unit: string;
  family: 'SUGAR' | 'OIL' | 'RICE' | 'CLEANING' | 'BEVERAGE';
  cost: number;
  price: number;
  tax: number;
}> = [
  { code: 'SUG-001', nameEn: 'White sugar, 1 kg bag', nameAr: 'سكر أبيض، كيس ١ كجم', unit: 'bag', family: 'SUGAR', cost: 22.5, price: 27.0, tax: 0 },
  { code: 'SUG-002', nameEn: 'White sugar, 50 kg sack', nameAr: 'سكر أبيض، شيكارة ٥٠ كجم', unit: 'sack', family: 'SUGAR', cost: 1080, price: 1275, tax: 0 },
  { code: 'SUG-003', nameEn: 'Brown sugar, 1 kg bag', nameAr: 'سكر بني، كيس ١ كجم', unit: 'bag', family: 'SUGAR', cost: 26.0, price: 32.0, tax: 0 },
  { code: 'SUG-004', nameEn: 'Icing sugar, 500 g', nameAr: 'سكر بودرة، ٥٠٠ جم', unit: 'packet', family: 'SUGAR', cost: 15.5, price: 19.5, tax: 0 },
  { code: 'SUG-005', nameEn: 'Table salt, 1 kg', nameAr: 'ملح طعام، ١ كجم', unit: 'bag', family: 'SUGAR', cost: 6.25, price: 8.5, tax: 0 },
  { code: 'OIL-001', nameEn: 'Sunflower oil, 1 litre', nameAr: 'زيت عباد الشمس، ١ لتر', unit: 'bottle', family: 'OIL', cost: 58.0, price: 69.0, tax: 14 },
  { code: 'OIL-002', nameEn: 'Sunflower oil, 5 litre', nameAr: 'زيت عباد الشمس، ٥ لتر', unit: 'jerrycan', family: 'OIL', cost: 275.0, price: 325.0, tax: 14 },
  { code: 'OIL-003', nameEn: 'Corn oil, 1 litre', nameAr: 'زيت ذرة، ١ لتر', unit: 'bottle', family: 'OIL', cost: 62.0, price: 74.0, tax: 14 },
  { code: 'OIL-004', nameEn: 'Olive oil, 500 ml', nameAr: 'زيت زيتون، ٥٠٠ مللي', unit: 'bottle', family: 'OIL', cost: 118.0, price: 149.0, tax: 14 },
  { code: 'OIL-005', nameEn: 'Blended oil, 20 litre drum', nameAr: 'زيت مخلوط، برميل ٢٠ لتر', unit: 'drum', family: 'OIL', cost: 1020.0, price: 1215.0, tax: 14 },
  { code: 'RIC-001', nameEn: 'Egyptian rice, 1 kg', nameAr: 'أرز مصري، ١ كجم', unit: 'bag', family: 'RICE', cost: 18.75, price: 23.0, tax: 0 },
  { code: 'RIC-002', nameEn: 'Egyptian rice, 25 kg sack', nameAr: 'أرز مصري، شيكارة ٢٥ كجم', unit: 'sack', family: 'RICE', cost: 455.0, price: 540.0, tax: 0 },
  { code: 'RIC-003', nameEn: 'Basmati rice, 1 kg', nameAr: 'أرز بسمتي، ١ كجم', unit: 'bag', family: 'RICE', cost: 41.0, price: 52.0, tax: 0 },
  { code: 'RIC-004', nameEn: 'Pasta, 500 g pack', nameAr: 'مكرونة، عبوة ٥٠٠ جم', unit: 'packet', family: 'RICE', cost: 11.2, price: 14.5, tax: 0 },
  { code: 'RIC-005', nameEn: 'White flour, 25 kg sack', nameAr: 'دقيق أبيض، شيكارة ٢٥ كجم', unit: 'sack', family: 'RICE', cost: 312.0, price: 368.0, tax: 0 },
  { code: 'CLN-001', nameEn: 'Dishwashing liquid, 1 litre', nameAr: 'سائل جلي، ١ لتر', unit: 'bottle', family: 'CLEANING', cost: 21.0, price: 28.0, tax: 14 },
  { code: 'CLN-002', nameEn: 'Laundry powder, 2 kg', nameAr: 'مسحوق غسيل، ٢ كجم', unit: 'box', family: 'CLEANING', cost: 64.0, price: 82.0, tax: 14 },
  { code: 'CLN-003', nameEn: 'Floor cleaner, 1 litre', nameAr: 'منظف أرضيات، ١ لتر', unit: 'bottle', family: 'CLEANING', cost: 18.5, price: 24.0, tax: 14 },
  { code: 'CLN-004', nameEn: 'Bleach, 1 litre', nameAr: 'مبيض، ١ لتر', unit: 'bottle', family: 'CLEANING', cost: 12.0, price: 16.0, tax: 14 },
  { code: 'CLN-005', nameEn: 'Kitchen towels, 4 roll pack', nameAr: 'مناديل مطبخ، ٤ لفات', unit: 'pack', family: 'CLEANING', cost: 33.0, price: 42.0, tax: 14 },
  { code: 'BEV-001', nameEn: 'Black tea, 250 g tin', nameAr: 'شاي أسود، علبة ٢٥٠ جم', unit: 'tin', family: 'BEVERAGE', cost: 78.0, price: 98.0, tax: 14 },
  { code: 'BEV-002', nameEn: 'Ground coffee, 250 g', nameAr: 'بن مطحون، ٢٥٠ جم', unit: 'packet', family: 'BEVERAGE', cost: 132.0, price: 168.0, tax: 14 },
  { code: 'BEV-003', nameEn: 'Mineral water, 1.5 litre', nameAr: 'مياه معدنية، ١.٥ لتر', unit: 'bottle', family: 'BEVERAGE', cost: 4.75, price: 6.5, tax: 14 },
  { code: 'BEV-004', nameEn: 'Mineral water, 12 bottle crate', nameAr: 'مياه معدنية، كرتونة ١٢ زجاجة', unit: 'crate', family: 'BEVERAGE', cost: 52.0, price: 69.0, tax: 14 },
  { code: 'BEV-005', nameEn: 'Orange juice, 1 litre', nameAr: 'عصير برتقال، ١ لتر', unit: 'bottle', family: 'BEVERAGE', cost: 27.5, price: 35.0, tax: 14 },
  { code: 'BEV-006', nameEn: 'Instant coffee, 200 g jar', nameAr: 'قهوة سريعة التحضير، ٢٠٠ جم', unit: 'jar', family: 'BEVERAGE', cost: 145.0, price: 185.0, tax: 14 },
  { code: 'SUG-006', nameEn: 'Molasses, 1 kg', nameAr: 'عسل أسود، ١ كجم', unit: 'jar', family: 'SUGAR', cost: 34.0, price: 44.0, tax: 0 },
  { code: 'OIL-006', nameEn: 'Ghee (clarified butter), 1 kg', nameAr: 'سمن بلدي، ١ كجم', unit: 'tin', family: 'OIL', cost: 188.0, price: 232.0, tax: 14 },
  { code: 'RIC-006', nameEn: 'Lentils, 1 kg', nameAr: 'عدس، ١ كجم', unit: 'bag', family: 'RICE', cost: 32.0, price: 40.0, tax: 0 },
  { code: 'CLN-006', nameEn: 'Hand soap, 6 bar pack', nameAr: 'صابون يد، ٦ قطع', unit: 'pack', family: 'CLEANING', cost: 29.0, price: 37.0, tax: 14 },
];

/// A small real PNG, so the backup carries a logo and the profile screen has
/// something to show. Built here rather than shipped as a file: it is eight
/// hundred bytes of arithmetic, and a binary in the repository is one more
/// thing to keep in step.
function logoPng(): Buffer {
  const size = 96;
  const raw: Buffer[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const inside = Math.hypot(x - size / 2, y - size / 2) < size / 2 - 3;
      const offset = 1 + x * 3;
      // A deep green disc on a transparent field, the shape a logo takes.
      row[offset] = inside ? 0x1b : 0x00;
      row[offset + 1] = inside ? 0x5e : 0x00;
      row[offset + 2] = inside ? 0x38 : 0x00;
    }
    raw.push(row);
  }

  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(raw), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ────────────────────────────────────────────────────────────── the building

let linesWritten = 0;

async function main(): Promise<void> {
  console.log('Building the demo company…');

  // Clear last time out of the way: this script owns the demo company and
  // nothing else, and it is never run against a database with real books in.
  const previous = await prisma.company.findUnique({
    where: { code: COMPANY.code },
    select: { id: true },
  });
  if (previous) {
    await prisma.company.delete({ where: { id: previous.id } });
    console.log('  removed the previous demo company');
  }

  const company = await prisma.company.create({
    data: {
      code: COMPANY.code,
      nameEn: COMPANY.nameEn,
      nameAr: COMPANY.nameAr,
      taxId: COMPANY.taxId,
      phone: COMPANY.phone,
      email: COMPANY.email,
      address: COMPANY.address,
      currency: COMPANY.currency,
      timezone: COMPANY.timezone,
      logoData: new Uint8Array(logoPng()),
      logoMime: 'image/png',
    },
  });

  // ── the units ──────────────────────────────────────────────────────────
  const hq = await prisma.branch.create({
    data: {
      companyId: company.id,
      code: BRANCHES[0].code,
      nameEn: BRANCHES[0].nameEn,
      nameAr: BRANCHES[0].nameAr,
      kind: BRANCHES[0].kind,
    },
  });
  const branches = [hq];
  for (const spec of BRANCHES.slice(1)) {
    branches.push(
      await prisma.branch.create({
        data: {
          companyId: company.id,
          code: spec.code,
          nameEn: spec.nameEn,
          nameAr: spec.nameAr,
          kind: spec.kind,
          parentBranchId: hq.id,
        },
      }),
    );
  }

  // ── who works here ────────────────────────────────────────────────────
  const permissions = await prisma.permission.findMany();
  const adminRole = await prisma.role.create({
    data: {
      companyId: company.id,
      code: 'ADMIN',
      nameEn: 'Administrator',
      nameAr: 'مدير النظام',
      isSystem: true,
    },
  });
  const accountantRole = await prisma.role.create({
    data: {
      companyId: company.id,
      code: 'ACCOUNTANT',
      nameEn: 'Accountant',
      nameAr: 'محاسب',
      isSystem: true,
    },
  });
  const salesRole = await prisma.role.create({
    data: {
      companyId: company.id,
      code: 'SALES',
      nameEn: 'Sales clerk',
      nameAr: 'مندوب مبيعات',
      isSystem: false,
    },
  });

  for (const permission of permissions) {
    await prisma.rolePermission.create({
      data: { roleId: adminRole.id, permissionId: permission.id },
    });
  }
  const bookkeeping = ['accounting', 'parties', 'inventory', 'reports'];
  for (const permission of permissions.filter(
    (p) =>
      bookkeeping.includes(p.module) ||
      p.code === 'sales.invoices.read' ||
      p.code === 'purchases.invoices.read',
  )) {
    await prisma.rolePermission.create({
      data: { roleId: accountantRole.id, permissionId: permission.id },
    });
  }
  for (const permission of permissions.filter(
    (p) =>
      p.code === 'sales.invoices.read' ||
      p.code === 'sales.invoices.create' ||
      p.code === 'parties.customers.read' ||
      p.code === 'inventory.items.read' ||
      p.code === 'inventory.stock.read',
  )) {
    await prisma.rolePermission.create({
      data: { roleId: salesRole.id, permissionId: permission.id },
    });
  }

  // The demo password is published with the file on purpose: it is a demo,
  // the data is invented, and the first thing to do with a real
  // installation is to change it.
  const passwordHash = await argon2.hash('Admin@12345');
  const admin = await prisma.user.create({
    data: {
      companyId: company.id,
      username: 'admin',
      fullNameEn: 'Company Administrator',
      fullNameAr: 'مدير الشركة',
      passwordHash,
      isSuperAdmin: true,
    },
  });
  const accountant = await prisma.user.create({
    data: {
      companyId: company.id,
      username: 'accountant',
      fullNameEn: 'Rania Adel',
      fullNameAr: 'رانيا عادل',
      passwordHash: await argon2.hash('Accountant@12345'),
    },
  });
  const sales = await prisma.user.create({
    data: {
      companyId: company.id,
      username: 'sales',
      fullNameEn: 'Omar Farouk',
      fullNameAr: 'عمر فاروق',
      passwordHash: await argon2.hash('Sales@12345'),
    },
  });
  await prisma.userRole.createMany({
    data: [
      { companyId: company.id, userId: admin.id, roleId: adminRole.id },
      { companyId: company.id, userId: accountant.id, roleId: accountantRole.id },
      { companyId: company.id, userId: sales.id, roleId: salesRole.id },
    ],
  });
  await prisma.userBranch.createMany({
    data: [
      { userId: admin.id, branchId: hq.id },
      { userId: accountant.id, branchId: hq.id },
      { userId: sales.id, branchId: branches[2]!.id },
    ],
  });

  // ── the chart of accounts ─────────────────────────────────────────────
  const accountId = new Map<string, string>();
  for (const spec of ACCOUNTS) {
    const created = await prisma.account.create({
      data: {
        companyId: company.id,
        code: spec.code,
        nameEn: spec.nameEn,
        nameAr: spec.nameAr,
        type: spec.type,
        parentId: spec.parent ? accountId.get(spec.parent)! : null,
        isPostable: spec.postable,
        currency: 'EGP',
      },
    });
    accountId.set(spec.code, created.id);
  }
  const account = (code: string): string => {
    const id = accountId.get(code);
    if (!id) throw new Error(`the demo chart has no account ${code}`);
    return id;
  };

  // ── the financial years ───────────────────────────────────────────────
  const fy2025 = await prisma.fiscalPeriod.create({
    data: {
      companyId: company.id,
      code: 'FY2025',
      nameEn: 'Financial year 2025',
      nameAr: 'السنة المالية ٢٠٢٥',
      startDate: day('2025-01-01'),
      endDate: day('2025-12-31'),
      // Populate historical entries while open; the real database trigger
      // must remain enabled during demo construction. Close only when done.
      status: PeriodStatus.OPEN,
    },
  });
  const fy2026 = await prisma.fiscalPeriod.create({
    data: {
      companyId: company.id,
      code: 'FY2026',
      nameEn: 'Financial year 2026',
      nameAr: 'السنة المالية ٢٠٢٦',
      startDate: day('2026-01-01'),
      endDate: day('2026-12-31'),
      status: PeriodStatus.OPEN,
    },
  });

  // ── the parties ───────────────────────────────────────────────────────
  const customers = [];
  for (const [index, spec] of CUSTOMERS.entries()) {
    customers.push(
      await prisma.customer.create({
        data: {
          companyId: company.id,
          code: spec.code,
          nameEn: spec.nameEn,
          nameAr: spec.nameAr,
          phone: `+20 1${between(0, 9)}${between(10000000, 99999999)}`,
          email: `${spec.code.toLowerCase().replace('-', '')}@customer-demo.example`,
          taxNumber: `${between(100, 999)}-${between(100, 999)}-${between(100, 999)}`,
          address: `${between(1, 120)} ${pick(['Tahrir', 'Nile', 'Palestine', 'Gamaa', 'Corniche'])} Street, ${spec.city}`,
          creditLimit: money(spec.credit),
          notes: `Demo customer. Payment terms: ${pick(['cash on delivery', '14 days', '30 days', '45 days'])}.`,
        },
      }),
    );
    if (index === 0) continue; // keep the first as the reference
  }

  const suppliers = [];
  for (const spec of SUPPLIERS) {
    suppliers.push(
      await prisma.supplier.create({
        data: {
          companyId: company.id,
          code: spec.code,
          nameEn: spec.nameEn,
          nameAr: spec.nameAr,
          phone: `+20 3${between(1000000, 9999999)}`,
          email: `${spec.code.toLowerCase().replace('-', '')}@supplier-demo.example`,
          taxNumber: `${between(200, 999)}-${between(100, 999)}-${between(100, 999)}`,
          address: `${between(1, 200)} Industrial Zone, ${spec.city}`,
          notes: `Demo supplier. Payment terms: ${pick(['cash', '21 days', '30 days', '60 days'])}.`,
        },
      }),
    );
  }

  // ── the catalogue ─────────────────────────────────────────────────────
  const items = [];
  for (const spec of ITEMS) {
    items.push(
      await prisma.item.create({
        data: {
          companyId: company.id,
          code: spec.code,
          nameEn: spec.nameEn,
          nameAr: spec.nameAr,
          unit: spec.unit,
          barcode: `${between(6220000000000, 6229999999999)}`,
          salePrice: money(spec.price),
          taxRate: spec.tax.toFixed(4),
          isStockTracked: true,
          notes: `Family: ${spec.family}. A demo item.`,
        },
      }),
    );
  }
  const itemSpec = new Map(items.map((item, index) => [item.id, ITEMS[index]!]));

  // ── the ledger ────────────────────────────────────────────────────────
  let journalNumber = 0;
  const nextJournalNumber = () => {
    journalNumber += 1;
    return `JE-2026-${String(journalNumber).padStart(5, '0')}`;
  };

  interface Line {
    accountCode: string;
    debit: number;
    credit: number;
    description?: string;
  }

  /** Cents, so that adding two amounts up never invents a third decimal. */
  const cents = (value: number): number => Math.round(value * 100);

  const post = async (options: {
    date: string;
    description: string;
    branchId: string;
    lines: Line[];
    status?: JournalStatus;
  }): Promise<string> => {
    // Round every line to the cent first. The entry's totals are then worked
    // out from the lines as they will actually be stored - not from the
    // unrounded figures - because the program checks one against the other the
    // moment this file is restored, and a penny of float drift would fail it.
    const lines = options.lines
      .filter((line) => line.debit || line.credit)
      .map((line) => ({ ...line, debit: cents(line.debit), credit: cents(line.credit) }));

    // A VAT line or a discount can leave the two sides a cent apart once each
    // line has been rounded. Rather than let that stand, the odd cent is put
    // on the largest line on the short side - the same thing a bookkeeper
    // does by hand - so the entry is exact without any of its lines being
    // silently wrong.
    let totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
    let totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
    if (totalDebit !== totalCredit) {
      const short = totalDebit < totalCredit ? 'debit' : 'credit';
      const target = lines
        .filter((line) => line[short] > 0)
        .sort((a, b) => b[short] - a[short])[0];
      if (!target) {
        throw new Error(
          `an entry with nothing on one side was about to be written: ${options.description}`,
        );
      }
      target[short] += Math.abs(totalDebit - totalCredit);
      totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
      totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
    }
    if (Math.abs(totalDebit - totalCredit) > 0.000001) {
      throw new Error(
        `an unbalanced entry was about to be written: ${options.description} ` +
          `(debit ${totalDebit}, credit ${totalCredit})`,
      );
    }

    const entry = await prisma.journalEntry.create({
      data: {
        companyId: company.id,
        branchId: options.branchId,
        entryNumber: nextJournalNumber(),
        entryDate: day(options.date),
        description: options.description,
        status: options.status ?? JournalStatus.POSTED,
        currency: COMPANY.currency,
        totalDebit: money(totalDebit / 100),
        totalCredit: money(totalCredit / 100),
        postedAt: options.status === JournalStatus.DRAFT ? null : day(options.date),
        postedBy: options.status === JournalStatus.DRAFT ? null : admin.id,
        createdBy: admin.id,
      },
    });

    await prisma.journalLine.createMany({
      data: lines.map((line, index) => ({
        journalEntryId: entry.id,
        lineNumber: index + 1,
        accountId: account(line.accountCode),
        debit: money(line.debit / 100),
        credit: money(line.credit / 100),
        description: line.description ?? null,
      })),
    });
    linesWritten += lines.length;
    return entry.id;
  };

  // Opening balances, carried forward from the year that has been closed.
  const opening: Line[] = [
    { accountCode: '1101', debit: 85000, credit: 0, description: 'Cash counted at the year end' },
    { accountCode: '1102', debit: 1475000, credit: 0, description: 'CIB current account' },
    { accountCode: '1103', debit: 610000, credit: 0, description: 'QNB current account' },
    { accountCode: '1104', debit: 2295000, credit: 0, description: 'Amounts owed by customers' },
    { accountCode: '1105', debit: 3125000, credit: 0, description: 'Stock on hand at cost' },
    { accountCode: '1106', debit: 148000, credit: 0, description: 'Input VAT carried forward' },
    { accountCode: '1108', debit: 96000, credit: 0, description: 'Prepaid rent and insurance' },
    { accountCode: '1201', debit: 4500000, credit: 0, description: 'Dokki warehouse' },
    { accountCode: '1202', debit: 1380000, credit: 0, description: 'Delivery fleet' },
    { accountCode: '1203', debit: 620000, credit: 0, description: 'Furniture and equipment' },
    { accountCode: '1204', debit: 0, credit: 1240000, description: 'Depreciation to date' },
    { accountCode: '2101', debit: 0, credit: 1780000, description: 'Amounts owed to suppliers' },
    { accountCode: '2102', debit: 0, credit: 186000, description: 'Output VAT carried forward' },
    { accountCode: '2104', debit: 0, credit: 215000, description: 'December salaries' },
    { accountCode: '2201', debit: 0, credit: 2200000, description: 'Bank term loan' },
    { accountCode: '3101', debit: 0, credit: 6000000, description: 'Share capital' },
    { accountCode: '3102', debit: 0, credit: 2713000, description: 'Profits kept in the business' },
  ];
  await post({
    date: '2025-12-31',
    description: 'Opening balances brought forward from FY2025',
    branchId: hq.id,
    lines: opening,
  });

  // ── purchases: stock in, and the debt that pays for it ────────────────
  const stock = new Map<string, { quantity: number; value: number }>();
  const balanceKey = (branchId: string, itemId: string) => `${branchId}:${itemId}`;
  const addStock = async (options: {
    branchId: string;
    itemId: string;
    date: string;
    quantity: number;
    unitCost: number;
    referenceType: string;
    referenceId?: string;
    referenceNumber?: string;
    notes?: string;
  }) => {
    const key = balanceKey(options.branchId, options.itemId);
    const current = stock.get(key) ?? { quantity: 0, value: 0 };
    const next = {
      quantity: current.quantity + options.quantity,
      value: current.value + options.quantity * options.unitCost,
    };
    stock.set(key, next);
    await prisma.stockMovement.create({
      data: {
        companyId: company.id,
        branchId: options.branchId,
        itemId: options.itemId,
        movementDate: day(options.date),
        direction: options.quantity >= 0 ? StockDirection.IN : StockDirection.OUT,
        quantity: quantity(Math.abs(options.quantity)),
        unitCost: money(options.unitCost),
        totalCost: money(Math.abs(options.quantity) * options.unitCost),
        referenceType: options.referenceType,
        referenceId: options.referenceId ?? null,
        referenceNumber: options.referenceNumber ?? null,
        notes: options.notes ?? null,
        createdBy: admin.id,
      },
    });
  };

  const unitCostOf = (itemId: string): number => {
    const spec = itemSpec.get(itemId)!;
    // Costs drift a little through the year, the way they do in life.
    return Number((spec.cost * (0.97 + random() * 0.06)).toFixed(4));
  };

  // Opening stock, before any of this year's documents.
  for (const branch of branches) {
    for (const item of items) {
      const spec = itemSpec.get(item.id)!;
      const quantityOnHand = spec.family === 'OIL' ? between(120, 420) : between(200, 900);
      await addStock({
        branchId: branch.id,
        itemId: item.id,
        date: '2025-12-31',
        quantity: quantityOnHand,
        unitCost: spec.cost,
        referenceType: 'OPENING',
        notes: 'Stock counted at the year end',
      });
    }
  }

  let purchaseNumber = 0;
  const purchaseInvoices = [];
  for (let index = 0; index < 20; index += 1) {
    const supplier = suppliers[index % suppliers.length]!;
    const branch = branches[index % branches.length]!;
    const date = addDays('2026-01-06', index * 12 + between(0, 6));
    purchaseNumber += 1;
    const number = `PINV-2026-${String(purchaseNumber).padStart(4, '0')}`;

    const lineCount = between(2, 5);
    const chosen: Array<{ item: (typeof items)[number]; quantity: number; unitCost: number }> = [];
    for (let line = 0; line < lineCount; line += 1) {
      const item = pick(items);
      if (chosen.some((entry) => entry.item.id === item.id)) continue;
      chosen.push({
        item,
        quantity: between(40, 320),
        unitCost: unitCostOf(item.id),
      });
    }

    let subTotal = 0;
    let taxAmount = 0;
    const built = chosen.map((entry, position) => {
      const rate = Number(itemSpec.get(entry.item.id)!.tax);
      const net = entry.quantity * entry.unitCost;
      const tax = (net * rate) / 100;
      subTotal += net;
      taxAmount += tax;
      return {
        lineNumber: position + 1,
        itemId: entry.item.id,
        description: `${entry.item.nameEn} — ${entry.item.nameAr}`,
        quantity: quantity(entry.quantity),
        unitPrice: money(entry.unitCost),
        taxRate: rate.toFixed(4),
        taxAmount: money(tax),
        lineTotal: money(net + tax),
        entry,
      };
    });

    const draft = index >= 18; // the last two are still being agreed
    const reversed = index === 17;
    const total = subTotal + taxAmount;

    const invoice = await prisma.purchaseInvoice.create({
      data: {
        companyId: company.id,
        branchId: branch.id,
        invoiceNumber: number,
        supplierReference: `SUP-${between(10000, 99999)}`,
        invoiceDate: day(date),
        dueDate: day(addDays(date, 30)),
        supplierId: supplier.id,
        status: draft
          ? InvoiceStatus.DRAFT
          : reversed
            ? InvoiceStatus.REVERSED
            : InvoiceStatus.POSTED,
        currency: COMPANY.currency,
        subTotal: money(subTotal),
        taxAmount: money(taxAmount),
        totalAmount: money(total),
        paidAmount: draft ? '0.00' : random() > 0.45 ? money(total) : '0.00',
        notes: draft ? 'Awaiting the supplier’s signed delivery note.' : null,
        createdBy: admin.id,
      },
    });

    await prisma.purchaseInvoiceLine.createMany({
      data: built.map((line) => ({
        invoiceId: invoice.id,
        lineNumber: line.lineNumber,
        itemId: line.itemId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxRate: line.taxRate,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal,
      })),
    });

    if (!draft) {
      for (const line of built) {
        await addStock({
          branchId: branch.id,
          itemId: line.itemId,
          date,
          quantity: Number(line.quantity),
          unitCost: Number(line.unitPrice),
          referenceType: 'PURCHASE_INVOICE',
          referenceId: invoice.id,
          referenceNumber: number,
          notes: `Bought from ${supplier.nameEn}`,
        });
      }

      const entryId = await post({
        date,
        description: `Purchase ${number} — ${supplier.nameEn}`,
        branchId: branch.id,
        lines: [
          { accountCode: '1105', debit: subTotal, credit: 0 },
          { accountCode: '1106', debit: taxAmount, credit: 0 },
          { accountCode: '2101', debit: 0, credit: total },
        ],
      });
      await prisma.purchaseInvoice.update({
        where: { id: invoice.id },
        data: {
          journalEntryId: entryId,
          postedAt: day(date),
          postedBy: admin.id,
        },
      });

      if (reversed) {
        // A reversal is a mirror entry that points back at the original, the
        // same way the program does it.
        const reversalId = await post({
          date: addDays(date, 4),
          description: `Reversal of purchase ${number}`,
          branchId: branch.id,
          lines: [
            { accountCode: '1105', debit: 0, credit: subTotal },
            { accountCode: '1106', debit: 0, credit: taxAmount },
            { accountCode: '2101', debit: total, credit: 0 },
          ],
        });
        await prisma.journalEntry.update({
          where: { id: reversalId },
          data: { reversalOfId: entryId },
        });
      }
    }

    purchaseInvoices.push(invoice);
  }

  // ── sales: stock out, revenue in, and what the customer owes ──────────
  let salesNumber = 0;
  const salesInvoices = [];
  for (let index = 0; index < 46; index += 1) {
    const customer = customers[index % customers.length]!;
    const branch = branches[index % branches.length]!;
    const date = addDays('2026-01-08', index * 6 + between(0, 4));
    salesNumber += 1;
    const number = `SINV-2026-${String(salesNumber).padStart(4, '0')}`;

    const lineCount = between(1, 4);
    const chosen: Array<{ item: (typeof items)[number]; quantity: number }> = [];
    for (let line = 0; line < lineCount; line += 1) {
      const item = pick(items);
      if (chosen.some((entry) => entry.item.id === item.id)) continue;
      chosen.push({ item, quantity: between(6, 90) });
    }

    const wholesale = chosen.reduce((sum, entry) => sum + entry.quantity, 0) > 120;
    let subTotal = 0;
    let taxAmount = 0;
    let costTotal = 0;

    const built = chosen.map((entry, position) => {
      const spec = itemSpec.get(entry.item.id)!;
      const price = Number((spec.price * (0.97 + random() * 0.07)).toFixed(2));
      const rate = spec.tax;
      const net = entry.quantity * price;
      const tax = (net * rate) / 100;
      const cost = Number((spec.cost * entry.quantity).toFixed(2));
      subTotal += net;
      taxAmount += tax;
      costTotal += cost;
      return {
        lineNumber: position + 1,
        itemId: entry.item.id,
        description: `${entry.item.nameEn} — ${entry.item.nameAr}`,
        quantity: quantity(entry.quantity),
        unitPrice: money(price),
        taxRate: rate.toFixed(4),
        taxAmount: money(tax),
        lineTotal: money(net + tax),
        unitCost: money(spec.cost),
        costTotal: money(cost),
        quantityNumber: entry.quantity,
        cost,
      };
    });

    const total = subTotal + taxAmount;
    const draft = index >= 43; // three invoices still being put together
    const reversed = index === 40 || index === 41;

    const invoice = await prisma.salesInvoice.create({
      data: {
        companyId: company.id,
        branchId: branch.id,
        invoiceNumber: number,
        invoiceDate: day(date),
        dueDate: day(addDays(date, wholesale ? 30 : 14)),
        customerId: customer.id,
        status: draft
          ? InvoiceStatus.DRAFT
          : reversed
            ? InvoiceStatus.REVERSED
            : InvoiceStatus.POSTED,
        currency: COMPANY.currency,
        subTotal: money(subTotal),
        taxAmount: money(taxAmount),
        totalAmount: money(total),
        paidAmount: draft
          ? '0.00'
          : random() > 0.4
            ? money(total)
            : money(Number((total * 0.4).toFixed(2))),
        costOfGoods: money(costTotal),
        notes:
          wholesale
            ? 'Wholesale delivery, palletised.'
            : 'Retail delivery.',
        createdBy: sales.id,
      },
    });

    await prisma.salesInvoiceLine.createMany({
      data: built.map((line) => ({
        invoiceId: invoice.id,
        lineNumber: line.lineNumber,
        itemId: line.itemId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxRate: line.taxRate,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal,
        unitCost: line.unitCost,
        costTotal: line.costTotal,
      })),
    });

    if (!draft) {
      for (const line of built) {
        await addStock({
          branchId: branch.id,
          itemId: line.itemId,
          date,
          quantity: -line.quantityNumber,
          unitCost: Number(line.unitCost),
          referenceType: 'SALES_INVOICE',
          referenceId: invoice.id,
          referenceNumber: number,
          notes: `Sold to ${customer.nameEn}`,
        });
      }

      const entryId = await post({
        date,
        description: `Sale ${number} — ${customer.nameEn}`,
        branchId: branch.id,
        lines: [
          { accountCode: '1104', debit: total, credit: 0 },
          { accountCode: wholesale ? '4101' : '4102', debit: 0, credit: subTotal },
          { accountCode: '2102', debit: 0, credit: taxAmount },
          { accountCode: '5101', debit: costTotal, credit: 0 },
          { accountCode: '1105', debit: 0, credit: costTotal },
        ],
      });
      await prisma.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          journalEntryId: entryId,
          postedAt: day(date),
          postedBy: sales.id,
        },
      });

      if (reversed) {
        const reversalId = await post({
          date: addDays(date, 3),
          description: `Reversal of sale ${number}`,
          branchId: branch.id,
          lines: [
            { accountCode: '1104', debit: 0, credit: total },
            { accountCode: wholesale ? '4101' : '4102', debit: subTotal, credit: 0 },
            { accountCode: '2102', debit: taxAmount, credit: 0 },
            { accountCode: '5101', debit: 0, credit: costTotal },
            { accountCode: '1105', debit: costTotal, credit: 0 },
          ],
        });
        await prisma.journalEntry.update({
          where: { id: reversalId },
          data: { reversalOfId: entryId },
        });
        // The goods come back onto the shelf.
        for (const line of built) {
          await addStock({
            branchId: branch.id,
            itemId: line.itemId,
            date: addDays(date, 3),
            quantity: line.quantityNumber,
            unitCost: Number(line.unitCost),
            referenceType: 'SALES_RETURN',
            referenceId: invoice.id,
            referenceNumber: number,
            notes: 'Returned goods put back into stock',
          });
        }
      }
    }

    salesInvoices.push(invoice);
  }

  // ── money moving: receipts, payments, transfers ───────────────────────
  const posted = await prisma.salesInvoice.findMany({
    where: { companyId: company.id, status: InvoiceStatus.POSTED },
    orderBy: { invoiceDate: 'asc' },
    select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true, customerId: true, branchId: true },
  });
  for (const [index, invoice] of posted.entries()) {
    if (index % 3 !== 0) continue; // not every invoice is settled yet
    const total = Number(invoice.totalAmount);
    const date = addDays(invoice.invoiceDate.toISOString().slice(0, 10), between(5, 24));
    await post({
      date,
      description: `Receipt for ${invoice.invoiceNumber}`,
      branchId: invoice.branchId,
      lines: [
        { accountCode: '1102', debit: total, credit: 0 },
        { accountCode: '1104', debit: 0, credit: total },
      ],
    });
  }

  const postedPurchases = await prisma.purchaseInvoice.findMany({
    where: { companyId: company.id, status: InvoiceStatus.POSTED },
    orderBy: { invoiceDate: 'asc' },
    select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true, branchId: true },
  });
  for (const [index, invoice] of postedPurchases.entries()) {
    if (index % 2 !== 0) continue;
    const total = Number(invoice.totalAmount);
    const date = addDays(invoice.invoiceDate.toISOString().slice(0, 10), between(10, 30));
    await post({
      date,
      description: `Payment for ${invoice.invoiceNumber}`,
      branchId: invoice.branchId,
      lines: [
        { accountCode: '2101', debit: total, credit: 0 },
        { accountCode: '1102', debit: 0, credit: total },
      ],
    });
  }

  // Cash taken to the bank, which is what a shop does at the end of a week.
  for (let week = 0; week < 12; week += 1) {
    const amount = between(40000, 120000);
    await post({
      date: addDays('2026-01-10', week * 7),
      description: 'Cash counted in and paid into the bank',
      branchId: hq.id,
      lines: [
        { accountCode: '1102', debit: amount, credit: 0 },
        { accountCode: '1101', debit: 0, credit: amount },
      ],
    });
  }

  // A transfer between the company's own two bank accounts.
  await post({
    date: '2026-03-22',
    description: 'Transfer from the CIB account to the QNB account',
    branchId: hq.id,
    lines: [
      { accountCode: '1103', debit: 350000, credit: 0 },
      { accountCode: '1102', debit: 0, credit: 350000 },
    ],
  });

  // ── the running costs of a year ───────────────────────────────────────
  for (let month = 0; month < 9; month += 1) {
    const date = addDays('2026-01-01', month * 30 + 27);
    const salaries = 385000;
    await post({
      date,
      description: `Salaries for month ${month + 1}`,
      branchId: hq.id,
      lines: [
        { accountCode: '5201', debit: salaries, credit: 0 },
        { accountCode: '2104', debit: 0, credit: salaries },
      ],
    });
    await post({
      date: addDays(date, 2),
      description: `Salaries paid for month ${month + 1}`,
      branchId: hq.id,
      lines: [
        { accountCode: '2104', debit: salaries, credit: 0 },
        { accountCode: '1102', debit: 0, credit: salaries },
      ],
    });
    await post({
      date: addDays(date, 3),
      description: `Rent for month ${month + 1}`,
      branchId: hq.id,
      lines: [
        { accountCode: '5202', debit: 75000, credit: 0 },
        { accountCode: '1102', debit: 0, credit: 75000 },
      ],
    });
    const utilities = between(18000, 42000);
    await post({
      date: addDays(date, 5),
      description: `Electricity and water for month ${month + 1}`,
      branchId: hq.id,
      lines: [
        { accountCode: '5203', debit: utilities, credit: 0 },
        { accountCode: '1102', debit: 0, credit: utilities },
      ],
    });
    const fuel = between(22000, 58000);
    await post({
      date: addDays(date, 7),
      description: `Fuel and transport for month ${month + 1}`,
      branchId: hq.id,
      lines: [
        { accountCode: '5204', debit: fuel, credit: 0 },
        { accountCode: '1102', debit: 0, credit: fuel },
      ],
    });
    const depreciation = 31000;
    await post({
      date: addDays(date, 28),
      description: `Depreciation for month ${month + 1}`,
      branchId: hq.id,
      lines: [
        { accountCode: '5206', debit: depreciation, credit: 0 },
        { accountCode: '1204', debit: 0, credit: depreciation },
      ],
    });
  }

  for (let quarter = 0; quarter < 3; quarter += 1) {
    const marketing = between(60000, 140000);
    await post({
      date: addDays('2026-01-20', quarter * 91),
      description: `Marketing campaign ${quarter + 1}`,
      branchId: hq.id,
      lines: [
        { accountCode: '5205', debit: marketing, credit: 0 },
        { accountCode: '1102', debit: 0, credit: marketing },
      ],
    });
    // Settling VAT: what was collected on sales against what was paid on
    // purchases. The balance is what goes to the tax authority.
    const settlement = between(120000, 260000);
    await post({
      date: addDays('2026-02-15', quarter * 91),
      description: `VAT settlement for quarter ${quarter + 1}`,
      branchId: hq.id,
      lines: [
        { accountCode: '2102', debit: settlement, credit: 0 },
        { accountCode: '1106', debit: 0, credit: settlement * 0.35 },
        { accountCode: '1102', debit: 0, credit: settlement * 0.65 },
      ],
    });
  }

  await post({
    date: '2026-04-18',
    description: 'Annual maintenance of the delivery fleet',
    branchId: hq.id,
    lines: [
      { accountCode: '5208', debit: 96000, credit: 0 },
      { accountCode: '1102', debit: 0, credit: 96000 },
    ],
  });
  await post({
    date: '2026-06-30',
    description: 'Bank charges for the first half of the year',
    branchId: hq.id,
    lines: [
      { accountCode: '5207', debit: 12400, credit: 0 },
      { accountCode: '1102', debit: 0, credit: 12400 },
    ],
  });

  // ── the balances the movements have been feeding ──────────────────────
  for (const branch of branches) {
    for (const item of items) {
      const key = balanceKey(branch.id, item.id);
      const balance = stock.get(key);
      if (!balance) continue;
      await prisma.stockBalance.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          itemId: item.id,
          quantity: quantity(balance.quantity),
          value: money(balance.value),
        },
      });
    }
  }

  // ── numbering: where the next document starts ─────────────────────────
  await prisma.documentSequence.createMany({
    data: [
      { companyId: company.id, key: 'JOURNAL', prefix: 'JE', nextValue: journalNumber + 1 },
      { companyId: company.id, key: 'SALES_INVOICE', prefix: 'SINV', nextValue: salesNumber + 1 },
      { companyId: company.id, key: 'PURCHASE_INVOICE', prefix: 'PINV', nextValue: purchaseNumber + 1 },
      { companyId: company.id, key: 'SALES_RETURN', prefix: 'SRET', nextValue: 1 },
      { companyId: company.id, key: 'PURCHASE_RETURN', prefix: 'PRET', nextValue: 1 },
    ],
  });

  // ── the audit trail, which is where a demo should start too ───────────
  await prisma.auditLog.createMany({
    data: [
      {
        companyId: company.id,
        userId: admin.id,
        action: 'CREATE',
        entity: 'companies',
        entityId: company.id,
        afterJson: { code: COMPANY.code, nameEn: COMPANY.nameEn, nameAr: COMPANY.nameAr },
        ipAddress: '127.0.0.1',
        userAgent: 'demo-data-builder',
      },
      {
        companyId: company.id,
        userId: sales.id,
        action: 'POST',
        entity: 'sales_invoices',
        entityId: salesInvoices[0]!.id,
        afterJson: { invoiceNumber: 'SINV-2026-0001', status: 'POSTED' },
        ipAddress: '10.0.0.24',
        userAgent: 'demo-data-builder',
      },
      {
        companyId: company.id,
        userId: accountant.id,
        action: 'CREATE',
        entity: 'journal_entries',
        entityId: null,
        afterJson: { note: 'salaries, rent and utilities posted for the year' },
        ipAddress: '10.0.0.18',
        userAgent: 'demo-data-builder',
      },
    ],
  });

  // ── and the check that everything balances ────────────────────────────
  const totals = await prisma.journalEntry.aggregate({
    where: { companyId: company.id },
    _sum: { totalDebit: true, totalCredit: true },
    _count: true,
  });
  const debit = Number(totals._sum.totalDebit ?? 0);
  const credit = Number(totals._sum.totalCredit ?? 0);
  if (Math.abs(debit - credit) > 0.005) {
    throw new Error(`the books do not balance: ${debit} against ${credit}`);
  }

  // The same check the restore path makes: every entry's lines add up to
  // what the entry says they add up to.
  const mismatched = await prisma.$queryRaw<
    Array<{ id: string }>
  >`
    SELECT e."id"
    FROM journal_entries e
    WHERE e."companyId" = ${company.id}::uuid
      AND (
        e."totalDebit" <> COALESCE((SELECT SUM(l."debit") FROM journal_lines l WHERE l."journalEntryId" = e."id"), 0)
        OR e."totalCredit" <> COALESCE((SELECT SUM(l."credit") FROM journal_lines l WHERE l."journalEntryId" = e."id"), 0)
      )
  `;
  if (mismatched.length > 0) {
    throw new Error(
      `${mismatched.length} journal entries disagree with their own lines`,
    );
  }

  await prisma.fiscalPeriod.update({
    where: { id: fy2025.id },
    data: { status: PeriodStatus.CLOSED, closedAt: day('2026-01-15'), closedBy: admin.id },
  });

  console.log('---------------------------------------------');
  console.log(` company       : ${COMPANY.nameEn} (${COMPANY.code})`);
  console.log(` branches      : ${branches.length}`);
  console.log(` accounts      : ${ACCOUNTS.length}`);
  console.log(` periods       : 2 (FY2025 closed, FY2026 open)`);
  console.log(` customers     : ${customers.length}`);
  console.log(` suppliers     : ${suppliers.length}`);
  console.log(` items         : ${items.length}`);
  console.log(` sales         : ${salesInvoices.length} invoices`);
  console.log(` purchases     : ${purchaseInvoices.length} invoices`);
  console.log(` journal       : ${journalNumber} entries, ${linesWritten} lines`);
  console.log(`               : ${debit.toFixed(2)} debit / ${credit.toFixed(2)} credit`);
  console.log(` period        : ${fy2026.code} (${fy2026.status})`);
  console.log('---------------------------------------------');
  console.log(' sign in as    : admin / Admin@12345');
  console.log('The demo books balance and every entry agrees with its lines.');
}

main()
  .catch((error) => {
    console.error('The demo data could not be built:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
