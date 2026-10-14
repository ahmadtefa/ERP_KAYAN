import { Workbook } from 'exceljs';

import { ReportTable } from './report-table';
import { toCsv, toPrintHtml, toXlsx } from './writers';

/// The writers are the last stop before a file leaves the building, so what
/// they produce is checked as a file: a real workbook with typed cells, not a
/// renamed text dump.
describe('export writers', () => {
  const table: ReportTable = {
    slug: 'trial-balance',
    titleEn: 'Trial balance',
    titleAr: 'ميزان المراجعة',
    meta: [
      { labelEn: 'From', labelAr: 'من تاريخ', value: '2026-01-01' },
      { labelEn: 'To', labelAr: 'إلى تاريخ', value: '2026-12-31' },
    ],
    columns: [
      { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 12 },
      { key: 'nameAr', labelEn: 'Account', labelAr: 'الحساب', width: 30 },
      { key: 'entryDate', labelEn: 'Date', labelAr: 'التاريخ', date: true, width: 14 },
      { key: 'amount', labelEn: 'Amount', labelAr: 'المبلغ', numeric: true, width: 16 },
    ],
    rows: [
      {
        code: '1101',
        nameAr: 'النقدية بالصندوق',
        entryDate: '2026-06-15',
        amount: '1234.5600',
      },
    ],
    totals: [{ labelEn: 'Total', labelAr: 'الإجمالي', value: '1234.5600' }],
    notes: [{ en: 'note', ar: 'ملاحظة' }],
  };

  describe('toXlsx', () => {
    it('produces a real workbook whose cells keep their types', async () => {
      const buffer = await toXlsx(table, 'ar', 'شركة كيان', {
        companyDetails: [
          { labelEn: 'Tax ID', labelAr: 'الرقم الضريبي', value: '123456789' },
          { labelEn: 'Phone', labelAr: 'الهاتف', value: '01000000000' },
        ],
      });
      // ZIP magic — .xlsx is a zip container.
      expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');

      const workbook = new Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];

      // Right-to-left, the way an Arabic sheet is read.
      expect(sheet.views[0].rightToLeft).toBe(true);

      // Find the data row: it holds the account code.
      let codeCell: ReturnType<typeof sheet.getCell> | null = null;
      let amountCell: ReturnType<typeof sheet.getCell> | null = null;
      let dateCell: ReturnType<typeof sheet.getCell> | null = null;
      sheet.eachRow((row) => {
        if (row.getCell(1).value === '1101') {
          codeCell = row.getCell(1);
          amountCell = row.getCell(4);
          dateCell = row.getCell(3);
        }
      });

      expect(codeCell).not.toBeNull();
      // The amount is a number in the sheet, so Excel can sum it.
      expect(typeof (amountCell as any).value).toBe('number');
      expect((amountCell as any).value).toBeCloseTo(1234.56);
      // The date is a real date, not text that looks like one.
      expect((dateCell as any).value).toBeInstanceOf(Date);
    });

    it('keeps the Arabic titles in the sheet', async () => {
      const buffer = await toXlsx(table, 'ar', 'شركة كيان');
      const workbook = new Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];
      const texts: string[] = [];
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === 'string') texts.push(cell.value);
        });
      });
      expect(texts).toContain('ميزان المراجعة');
      expect(texts).toContain('شركة كيان');
      expect(texts).toContain('123456789');
      expect(texts).toContain('01000000000');
    });
  });

  describe('toCsv', () => {
    it('writes a byte-order mark so Excel reads Arabic correctly', () => {
      const csv = toCsv(table, 'ar', 'شركة كيان', [
        { labelEn: 'Tax ID', labelAr: 'الرقم الضريبي', value: '123456789' },
      ]).toString('utf8');
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('النقدية بالصندوق');
      expect(csv).toContain('الرقم الضريبي');
      expect(csv).toContain('123456789');
    });
  });

  describe('toPrintHtml', () => {
    it('renders right-to-left Arabic with the company header', () => {
      const html = toPrintHtml(table, 'ar', 'شركة كيان', {
        logo: { data: Buffer.from('png-bytes'), mime: 'image/png' },
        companyDetails: [
          { labelEn: 'Tax ID', labelAr: 'الرقم الضريبي', value: '123456789' },
          { labelEn: 'Phone', labelAr: 'الهاتف', value: '01000000000' },
        ],
      });
      expect(html).toContain('dir="rtl"');
      expect(html).toContain('ميزان المراجعة');
      expect(html).toContain('شركة كيان');
      expect(html).toContain('الرقم الضريبي');
      expect(html).toContain('123456789');
      expect(html).toContain('01000000000');
      // The logo travels inside the page, so the file stands alone.
      expect(html).toContain('data:image/png;base64,');
      // The header row repeats on every printed page.
      expect(html).toContain('table-header-group');
    });

    it('renders left-to-right in English without Arabic labels', () => {
      const html = toPrintHtml(table, 'en', 'Kayan Company');
      expect(html).toContain('dir="ltr"');
      expect(html).toContain('Trial balance');
      expect(html).not.toContain('ميزان المراجعة');
    });
  });
});
