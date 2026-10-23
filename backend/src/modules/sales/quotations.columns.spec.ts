import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { QuotationsService } from './quotations.service';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '55555555-5555-4555-8555-555555555555';

/// The offer's own subject, tax-number choice and line layout have to reach
/// the row, and the printed page has to read them back — not the company
/// defaults and not a hardcoded set of columns.
describe('QuotationsService subject and column layout', () => {
  const settings = {
    get: jest.fn().mockResolvedValue({
      maxDiscountPercent: '100',
      showTaxIdOnQuotations: true,
      managerName: 'Company manager',
      salesManagerName: null,
      salesManagerPhone: null,
    }),
  };

  function service() {
    const tx = {
      quotation: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'quotation-1',
          quotationNumber: 'QT-0001',
          totalAmount: new Prisma.Decimal('100'),
          ...data,
        })),
      },
      quotationEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id: CUSTOMER_ID,
          code: 'CUS-1',
          nameEn: 'Customer',
          nameAr: 'عميل',
          isActive: true,
        }),
      },
      company: { findUnique: jest.fn().mockResolvedValue({ currency: 'EGP' }) },
      item: { findMany: jest.fn().mockResolvedValue([]) },
      quotation: { findFirst: jest.fn() },
      $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
    };
    const numbers = { next: jest.fn().mockResolvedValue('QT-0001') };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const instance = new QuotationsService(
      prisma as never,
      numbers as never,
      settings as never,
      {} as never,
      audit as never,
    );
    jest.spyOn(instance, 'findOne').mockResolvedValue({ id: 'quotation-1' } as never);
    return { instance, tx, prisma };
  }

  const baseDto = (overrides: Record<string, unknown> = {}) => ({
    quotationDate: '2026-10-19',
    customerId: CUSTOMER_ID,
    tables: [
      {
        title: 'Main',
        lines: [{ description: 'Line', quantity: '1', unitPrice: '100' }],
      },
    ],
    ...overrides,
  });

  it('stores the subject, the offer tax choice and the ordered columns', async () => {
    const { instance, tx } = service();
    await instance.create(
      COMPANY_ID,
      BRANCH_ID,
      USER_ID,
      baseDto({
        subject: 'Kitchen offer',
        showTaxId: false,
        columns: [
          { key: 'itemCode', width: 2 },
          { key: 'quantity', labelEn: 'Pieces', width: 1 },
          { key: 'unitPrice', width: 2, visible: true },
          { key: 'lineTotal', width: 2 },
          { key: 'description', width: 4 },
        ],
      }) as never,
    );
    const data = tx.quotation.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.subject).toBe('Kitchen offer');
    expect(data.showTaxId).toBe(false);
    expect(data.columns).toEqual([
      { key: 'itemCode', labelEn: 'Item code', labelAr: 'كود الصنف', visible: true, width: 2, numeric: false },
      { key: 'quantity', labelEn: 'Pieces', labelAr: 'الكمية', visible: true, width: 1, numeric: true },
      { key: 'unitPrice', labelEn: 'Unit price', labelAr: 'سعر الوحدة', visible: true, width: 2, numeric: true },
      { key: 'lineTotal', labelEn: 'Total', labelAr: 'الإجمالي', visible: true, width: 2, numeric: true },
      { key: 'description', labelEn: 'Description', labelAr: 'الوصف', visible: true, width: 4, numeric: false },
    ]);
  });

  it('keeps the company default when the offer says nothing about the tax number', async () => {
    const { instance, tx } = service();
    await instance.create(COMPANY_ID, BRANCH_ID, USER_ID, baseDto() as never);
    const data = tx.quotation.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.showTaxId).toBe(true);
    // No layout chosen: the standard six, stored explicitly so a later
    // catalogue change cannot silently alter this offer.
    expect(data.columns).toEqual([
      { key: 'description', labelEn: null, labelAr: null, visible: true, width: 4, numeric: false },
      { key: 'countryOfOrigin', labelEn: null, labelAr: null, visible: true, width: 2, numeric: false },
      { key: 'unit', labelEn: null, labelAr: null, visible: true, width: 1, numeric: false },
      { key: 'quantity', labelEn: null, labelAr: null, visible: true, width: 1, numeric: true },
      { key: 'unitPrice', labelEn: null, labelAr: null, visible: true, width: 2, numeric: true },
      { key: 'lineTotal', labelEn: null, labelAr: null, visible: true, width: 2, numeric: true },
    ]);
  });

  it('refuses a layout that lists the same column twice', async () => {
    const { instance } = service();
    await expect(
      instance.create(
        COMPANY_ID,
        BRANCH_ID,
        USER_ID,
        baseDto({
          columns: [
            { key: 'description' },
            { key: 'description', labelEn: 'Again' },
          ],
        }) as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a layout with no visible column, so no offer prints an empty table', async () => {
    const { instance } = service();
    await expect(
      instance.create(
        COMPANY_ID,
        BRANCH_ID,
        USER_ID,
        baseDto({
          columns: [{ key: 'description', visible: false }],
        }) as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('the printed page', () => {
    function quotationRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'quotation-1',
        companyId: COMPANY_ID,
        quotationNumber: 'QT-0001',
        quotationDate: new Date('2026-10-19T00:00:00.000Z'),
        validUntil: null,
        currency: 'EGP',
        version: 1,
        status: 'DRAFT',
        subject: 'Kitchen offer',
        showTaxId: false,
        notes: null,
        terms: null,
        discountType: null,
        discountPercent: new Prisma.Decimal('0'),
        discountAmount: new Prisma.Decimal('0'),
        subTotal: new Prisma.Decimal('100'),
        discountTotal: new Prisma.Decimal('0'),
        totalAmount: new Prisma.Decimal('100'),
        design: {},
        managerName: null,
        responsibleName: null,
        responsiblePhone: null,
        columns: [
          { key: 'itemCode', visible: true, width: 2 },
          { key: 'description', visible: true, width: 4 },
          { key: 'quantity', labelEn: 'Pieces', visible: true, width: 1 },
          { key: 'unitPrice', visible: true, width: 2 },
          { key: 'lineTotal', visible: true, width: 2 },
          { key: 'countryOfOrigin', visible: false, width: 2 },
        ],
        customer: {
          code: 'CUS-1',
          nameEn: 'Customer',
          nameAr: 'عميل',
          phone: null,
          email: null,
          taxNumber: null,
          address: null,
        },
        tables: [
          {
            title: 'Main',
            sortOrder: 1,
            subTotal: new Prisma.Decimal('100'),
            discountPercent: new Prisma.Decimal('0'),
            discountAmount: new Prisma.Decimal('0'),
            netTotal: new Prisma.Decimal('100'),
            lines: [
              {
                lineNumber: 1,
                itemId: null,
                item: { code: 'IT-1', nameEn: 'Item', nameAr: 'صنف' },
                description: 'Line',
                countryOfOrigin: 'EG',
                unit: 'piece',
                quantity: new Prisma.Decimal('1'),
                unitPrice: new Prisma.Decimal('100'),
                lineTotal: new Prisma.Decimal('100'),
                customValues: {},
              },
            ],
          },
        ],
        events: [],
        convertedInvoice: null,
        contentSnapshot: null,
        snapshotAt: null,
        ...overrides,
      };
    }

    function serviceFor(row: Record<string, unknown>) {
      const prisma = {
        quotation: { findFirst: jest.fn().mockResolvedValue(row) },
        company: {
          findUnique: jest.fn().mockResolvedValue({
            code: 'KAYAN',
            nameEn: 'Kayan',
            nameAr: 'كيان',
            taxId: 'TAX-999',
            commercialRegistration: null,
            phone: null,
            email: null,
            address: null,
            addressEn: null,
            addressAr: null,
            logoData: null,
            logoMime: null,
            currency: 'EGP',
            timezone: 'Africa/Cairo',
          }),
        },
      };
      return new QuotationsService(
        prisma as never,
        {} as never,
        settings as never,
        {} as never,
        { record: jest.fn() } as never,
      );
    }

    it('prints only the offer\'s visible columns, in its order, with its labels', async () => {
      const html = await serviceFor(quotationRow()).printHtml(
        COMPANY_ID,
        'quotation-1',
        'en',
      );
      expect(html).toContain('Item code');
      expect(html).toContain('Pieces');
      expect(html).not.toContain('>Origin<');
      expect(html.indexOf('Item code')).toBeLessThan(html.indexOf('Description'));
      expect(html).toContain('Kitchen offer');
    });

    it('leaves the tax number off when the offer turned it off', async () => {
      const html = await serviceFor(quotationRow()).printHtml(
        COMPANY_ID,
        'quotation-1',
        'en',
      );
      expect(html).not.toContain('TAX-999');
    });

    it('prints the tax number when the offer kept it on', async () => {
      const html = await serviceFor(quotationRow({ showTaxId: true })).printHtml(
        COMPANY_ID,
        'quotation-1',
        'en',
      );
      expect(html).toContain('TAX-999');
    });

    it('prints each table with its own columns and custom values; a table without its own layout inherits the quotation one', async () => {
      const row = quotationRow({
        tables: [
          {
            title: 'الأجهزة',
            sortOrder: 1,
            subTotal: new Prisma.Decimal('100'),
            discountPercent: new Prisma.Decimal('0'),
            discountAmount: new Prisma.Decimal('0'),
            netTotal: new Prisma.Decimal('100'),
            columns: [
              { key: 'description', visible: true, width: 4 },
              {
                key: 'custom-warranty',
                labelAr: 'مدة الضمان',
                labelEn: 'Warranty',
                visible: true,
                width: 2,
                kind: 'text',
              },
              {
                key: 'custom-discount',
                labelAr: 'خصم إضافي',
                labelEn: 'Extra discount',
                visible: true,
                width: 2,
                kind: 'percent',
              },
              { key: 'lineTotal', visible: true, width: 2 },
            ],
            lines: [
              {
                lineNumber: 1,
                itemId: null,
                item: null,
                description: 'ثلاجة',
                countryOfOrigin: null,
                unit: 'piece',
                quantity: new Prisma.Decimal('1'),
                unitPrice: new Prisma.Decimal('100'),
                lineTotal: new Prisma.Decimal('100'),
                customValues: {
                  'custom-warranty': 'سنتان',
                  'custom-discount': '12.5',
                },
              },
            ],
          },
          {
            title: 'Services',
            sortOrder: 2,
            subTotal: new Prisma.Decimal('0'),
            discountPercent: new Prisma.Decimal('0'),
            discountAmount: new Prisma.Decimal('0'),
            netTotal: new Prisma.Decimal('0'),
            lines: [
              {
                lineNumber: 1,
                itemId: null,
                item: { code: 'IT-9', nameEn: 'Visit', nameAr: 'زيارة' },
                description: 'Visit',
                countryOfOrigin: null,
                unit: 'visit',
                quantity: new Prisma.Decimal('1'),
                unitPrice: new Prisma.Decimal('0'),
                lineTotal: new Prisma.Decimal('0'),
                customValues: {},
              },
            ],
          },
        ],
      });
      const html = await serviceFor(row).printHtml(COMPANY_ID, 'quotation-1', 'ar');
      // The first section gets both of its own extra columns and the values.
      expect(html).toContain('مدة الضمان');
      expect(html).toContain('سنتان');
      expect(html).toContain('خصم إضافي');
      expect(html).toContain('٪');
      // The second section inherits the quotation layout: its quantity
      // header is the Arabic override from that layout, and it appears
      // only there (the first section has no quantity column).
      expect(html).toContain('الكمية');
      expect(html.split('الكمية')).toHaveLength(2);
      // And the custom headers belong to the first section only: they
      // appear exactly once.
      expect(html.split('مدة الضمان')).toHaveLength(2);
    });

    it('returns custom values and per-table columns in the detail response the editor reloads from', async () => {
      const row = quotationRow({
        tables: [
          {
            id: 'table-1',
            title: 'Main',
            sortOrder: 1,
            discountType: null,
            subTotal: new Prisma.Decimal('100'),
            discountPercent: new Prisma.Decimal('0'),
            discountAmount: new Prisma.Decimal('0'),
            discountTotal: new Prisma.Decimal('0'),
            netTotal: new Prisma.Decimal('100'),
            columns: [
              { key: 'description', visible: true, width: 4 },
              { key: 'custom-warranty', labelAr: 'مدة الضمان', labelEn: 'Warranty', visible: true, width: 2 },
            ],
            lines: [
              {
                id: 'line-1',
                lineNumber: 1,
                itemId: null,
                item: null,
                description: 'Line',
                countryOfOrigin: null,
                unit: 'piece',
                quantity: new Prisma.Decimal('1'),
                unitPrice: new Prisma.Decimal('100'),
                lineTotal: new Prisma.Decimal('100'),
                customValues: { 'custom-warranty': 'سنتان' },
              },
            ],
          },
        ],
      });
      const response = (serviceFor(row) as never as {
        toResponse: (q: unknown, detail: boolean) => Record<string, unknown>;
      }).toResponse(row, true) as {
        tables: Array<{
          columns: Array<{ key: string; labelAr: string | null }>;
          lines: Array<{ customValues: Record<string, string> }>;
        }>;
      };
      expect(response.tables[0].columns.map((c) => c.key)).toEqual([
        'description',
        'custom-warranty',
      ]);
      expect(response.tables[0].lines[0].customValues).toEqual({
        'custom-warranty': 'سنتان',
      });
    });

    it('returns the stored custom values so reopening an offer keeps them', async () => {
      const base = quotationRow();
      const tables = base.tables as Array<Record<string, unknown>>;
      const row = quotationRow({
        columns: [
          { key: 'description', visible: true, width: 4 },
          { key: 'color', labelEn: 'Color', labelAr: 'اللون', visible: true, width: 2 },
        ],
        tables: [
          {
            id: 'table-1',
            discountTotal: new Prisma.Decimal('0'),
            ...tables[0],
            lines: [
              {
                ...(tables[0].lines as Array<Record<string, unknown>>)[0],
                customValues: { color: 'Red' },
              },
            ],
          },
        ],
      });
      const prisma = {
        quotation: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(row),
        },
      };
      const instance = new QuotationsService(
        prisma as never,
        {} as never,
        settings as never,
        {} as never,
        { record: jest.fn() } as never,
      );

      const result = (await instance.findOne(COMPANY_ID, 'quotation-1')) as {
        tables: Array<{ lines: Array<{ customValues: Record<string, string> }> }>;
      };
      expect(result.tables[0].lines[0].customValues).toEqual({ color: 'Red' });
    });

  });

  describe('user-defined columns', () => {
    it('accepts Arabic- and English-named custom columns and stores their kinds', async () => {
      const { instance, tx } = service();
      await instance.create(
        COMPANY_ID,
        BRANCH_ID,
        USER_ID,
        baseDto({
          columns: [
            { key: 'description', width: 4 },
            { key: 'custom-1', labelAr: 'مدة الضمان', labelEn: 'Warranty', width: 2, kind: 'text' },
            { key: 'custom-2', labelAr: 'الخصم', labelEn: 'Discount', width: 2, kind: 'percent' },
            { key: 'lineTotal', width: 2 },
          ],
          tables: [
            {
              title: 'Main',
              lines: [
                {
                  description: 'Line',
                  quantity: '1',
                  unitPrice: '100',
                  customValues: { 'custom-1': 'سنتان', 'custom-2': '10' },
                },
              ],
            },
          ],
        }) as never,
      );
      const data = tx.quotation.create.mock.calls[0][0].data as {
        columns: Array<Record<string, unknown>>;
        tables: { create: Array<{ lines: { create: Array<{ customValues: unknown }> } }> };
      };
      // Two new columns (not rows): the layout grew from the built-ins by
      // exactly the two user-defined entries, kinds intact.
      expect(data.columns).toHaveLength(4);
      expect(data.columns[1]).toMatchObject({
        key: 'custom-1',
        labelAr: 'مدة الضمان',
        labelEn: 'Warranty',
        kind: 'text',
        numeric: false,
      });
      expect(data.columns[2]).toMatchObject({
        key: 'custom-2',
        kind: 'percent',
        numeric: true,
      });
      expect(data.tables.create[0].lines.create[0].customValues).toEqual({
        'custom-1': 'سنتان',
        'custom-2': '10',
      });
    });

    it('stores per-table layouts independently and inherits where a table has none', async () => {
      const { instance, tx } = service();
      await instance.create(
        COMPANY_ID,
        BRANCH_ID,
        USER_ID,
        baseDto({
          tables: [
            {
              title: 'With layout',
              columns: [
                { key: 'description', width: 4 },
                { key: 'custom-a', labelAr: 'الضمان', width: 2 },
              ],
              lines: [{ description: 'A', quantity: '1', unitPrice: '10' }],
            },
            {
              title: 'Inherited',
              lines: [{ description: 'B', quantity: '1', unitPrice: '20' }],
            },
          ],
        }) as never,
      );
      const data = tx.quotation.create.mock.calls[0][0].data as {
        tables: { create: Array<{ title: string; columns: unknown }> };
      };
      expect(Array.isArray(data.tables.create[0].columns)).toBe(true);
      expect(data.tables.create[0].columns).toMatchObject([
        { key: 'description' },
        { key: 'custom-a', labelAr: 'الضمان' },
      ]);
      // SQL NULL: the second table inherits the quotation-level layout.
      expect(data.tables.create[1].columns).toBe(Prisma.DbNull);
    });

    it('refuses a duplicated user-defined column and a blank column name', async () => {
      const { instance } = service();
      await expect(
        instance.create(
          COMPANY_ID,
          BRANCH_ID,
          USER_ID,
          baseDto({
            columns: [
              { key: 'custom-a', labelAr: 'الضمان' },
              { key: 'custom-a', labelAr: 'ضمان آخر' },
            ],
          }) as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        instance.create(
          COMPANY_ID,
          BRANCH_ID,
          USER_ID,
          baseDto({ columns: [{ key: '  ' }] }) as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('still reads legacy layouts where the typed name was the key', async () => {
      const { instance, tx } = service();
      await instance.create(
        COMPANY_ID,
        BRANCH_ID,
        USER_ID,
        baseDto({
          columns: [
            { key: 'description', width: 4 },
            { key: 'مدة التنفيذ', width: 2 },
          ],
        }) as never,
      );
      const data = tx.quotation.create.mock.calls[0][0].data as {
        columns: Array<Record<string, unknown>>;
      };
      expect(data.columns[1]).toMatchObject({
        key: 'مدة التنفيذ',
        labelAr: 'مدة التنفيذ',
        labelEn: 'مدة التنفيذ',
      });
    });
  });
});
