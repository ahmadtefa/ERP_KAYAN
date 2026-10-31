import 'reflect-metadata';

import { ALLOW_QUERY_TOKEN_KEY } from '../../common/decorators/allow-query-token.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { InventoryReportsController } from './inventory-reports.controller';

/**
 * Label routes are read routes: the catalogue permission that lets a user
 * see items is enough to print their labels, while barcode assignment keeps
 * its separate, stronger permission. Both routes must accept a one-minute
 * download ticket because the browser opens them as a navigation.
 */
describe('barcode label routes', () => {
  const proto = InventoryReportsController.prototype as any;

  it('guards both routes with the items read permission', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.barcodeLabelPrint)).toEqual([
      'inventory.items.read',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.barcodeLabelPdf)).toEqual([
      'inventory.items.read',
    ]);
  });

  it('allows the query download token on both routes', () => {
    expect(Reflect.getMetadata(ALLOW_QUERY_TOKEN_KEY, proto.barcodeLabelPrint)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_QUERY_TOKEN_KEY, proto.barcodeLabelPdf)).toBe(true);
  });

  it('defaults to Arabic, price visible and no auto-print, honouring overrides', async () => {
    const calls: any[] = [];
    const labels = {
      parseSpecs: jest.fn((raw) => raw),
      parsePaper: jest.fn((paper) => paper ?? 'A4'),
      buildHtml: jest.fn(async (...args: any[]) => {
        calls.push(['html', ...args]);
        return '<html></html>';
      }),
      renderPdf: jest.fn(async (...args: any[]) => {
        calls.push(['pdf', ...args]);
        return Buffer.from('pdf');
      }),
    };
    // The label route now asks the company's print settings whether a sheet
    // carries the price. An installation that never configured them answers
    // "yes", which is the behaviour this test has always pinned.
    const printSettings = {
      resolve: async (
        _company: string,
        _user: unknown,
        requested: { showSalePrice?: string },
      ) => ({
        showSalePrice: requested.showSalePrice === 'false' ? false : true,
        showCost: false,
        source: 'builtin' as const,
        costLocked: true,
      }),
    };
    const controller = new InventoryReportsController(
      {} as never,
      labels as never,
      printSettings as never,
    );
    const user = { companyId: 'company-1' } as never;
    const response = { type: jest.fn(), setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.barcodeLabelPrint(
      user,
      'item-1',
      ['unit-1:2'],
      { paper: 'THERMAL_80' } as any,
      response,
    );
    expect(calls[0][4]).toEqual({
      paper: 'THERMAL_80',
      showPrice: true,
      lang: 'ar',
      autoPrint: false,
    });

    await controller.barcodeLabelPrint(
      user,
      'item-1',
      ['unit-1:2'],
      { showPrice: 'false', lang: 'en', auto: '1' } as any,
      response,
    );
    expect(calls[1][4]).toEqual({ paper: 'A4', showPrice: false, lang: 'en', autoPrint: true });

    await controller.barcodeLabelPdf(
      user,
      'item-1',
      ['unit-1:2'],
      { paper: 'A4' } as any,
      response,
    );
    expect(calls[2][0]).toBe('pdf');
    expect(calls[2][4].autoPrint).toBe(false);
    expect(response.send).toHaveBeenCalled();
  });
});
