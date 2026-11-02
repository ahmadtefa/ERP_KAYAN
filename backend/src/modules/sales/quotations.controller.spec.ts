import type { Response } from 'express';

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrintSettingsService } from '../../common/print/print-settings.module';
import { PdfService } from '../export/pdf.service';
import { QuotationsController } from './quotations.controller';
import { quotationDocumentFileName } from './quotation-document';
import { QuotationsService } from './quotations.service';

/// The download the customer actually clicks.
///
/// Everything else about the offer's PDF is proven elsewhere: the HTML by
/// `quotation-document.spec.ts`, the merge arithmetic by `quotation-pdf.spec.ts`,
/// and the finished sheet - rasterised and measured - by
/// `scripts/verify-artwork-pdf.mjs` in CI. What was not pinned is the endpoint
/// around it: that the bytes arrive as a PDF, that the browser is told to
/// *download* them under a name taken from the offer, that a cached copy is
/// refused, and that a letterheaded offer is not rendered a second time.
describe('downloading a quotation PDF', () => {
  const user = {
    userId: 'user-1',
    companyId: 'company-1',
    branchId: 'branch-1',
    permissions: ['sales.quotations.export'],
  } as unknown as AuthUser;

  const makeResponse = () => {
    const res = {
      headers: {} as Record<string, string>,
      body: undefined as unknown,
      setHeader(name: string, value: string) {
        res.headers[name] = value;
      },
      type: () => undefined,
      send(body: unknown) {
        res.body = body;
      },
    };
    return res;
  };

  const build = (overrides: {
    artwork?: { pdf: Buffer; quotationNumber: string } | null;
    document?: {
      html: string;
      quotationNumber: string;
      pageNumberInk?: string;
    };
  }) => {
    const service = {
      renderArtworkPdf: jest.fn().mockResolvedValue(overrides.artwork ?? null),
      printDocument: jest.fn().mockResolvedValue(
        overrides.document ?? {
          html: '<html>offer</html>',
          quotationNumber: 'QT-1001',
          pageNumberInk: '#5a6b84',
        },
      ),
    } as unknown as QuotationsService;

    const pdf = {
      render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 rendered')),
    } as unknown as PdfService;

    // Honours the caller's choice, so the test can tell "the endpoint asked
    // for the right visibility" from "the mock always said yes".
    const printSettings = {
      resolve: jest
        .fn()
        .mockImplementation(
          async (
            _companyId: string,
            _user: AuthUser,
            query: { showSalePrice?: string },
          ) => ({ showSalePrice: query?.showSalePrice !== 'false' }),
        ),
    } as unknown as PrintSettingsService;

    return {
      controller: new QuotationsController(service, pdf, printSettings),
      service,
      pdf,
      printSettings,
    };
  };

  it('sends a letterheaded offer as a download, without rendering it again', async () => {
    const merged = Buffer.from('%PDF-1.7 merged artwork');
    const { controller, pdf } = build({
      artwork: { pdf: merged, quotationNumber: 'QT-1001' },
    });
    const response = makeResponse();

    await controller.downloadPdf(
      user,
      'quotation-1',
      { lang: 'ar' },
      response as unknown as Response,
    );

    expect(response.headers['Content-Type']).toBe('application/pdf');
    expect(response.headers['Content-Disposition']).toBe(
      `attachment; filename="${quotationDocumentFileName('QT-1001', 'quotation-1')}"`,
    );
    // A downloaded document must not sit in a cache: the next print has to be
    // the next version of the offer, not yesterday's.
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.body).toBe(merged);
    // The sheet was already merged with its artwork; rendering it again would
    // print the offer twice.
    expect(pdf.render).not.toHaveBeenCalled();
  });

  it('renders a full-bleed sheet when the offer has no artwork', async () => {
    const { controller, pdf } = build({ artwork: null });
    const response = makeResponse();

    await controller.downloadPdf(
      user,
      'quotation-2',
      { lang: 'en' },
      response as unknown as Response,
    );

    expect(pdf.render).toHaveBeenCalledTimes(1);
    const [html, options] = (pdf.render as unknown as jest.Mock).mock.calls[0];
    expect(html).toContain('offer');
    // The whole page is the design: it has to be printed full bleed with the
    // page number drawn by us, or the background is dropped by the printer.
    expect(options).toMatchObject({ fullBleed: true });
    expect(options.pageNumberSize).toBeGreaterThan(0);
    expect(response.headers['Content-Type']).toBe('application/pdf');
    expect(response.headers['Content-Disposition']).toBe(
      `attachment; filename="${quotationDocumentFileName('QT-1001', 'quotation-2')}"`,
    );
    expect(response.body).toEqual(Buffer.from('%PDF-1.7 rendered'));
  });

  it('prints the language and the price choice the caller asked for', async () => {
    const { controller, service, printSettings } = build({ artwork: null });
    const response = makeResponse();

    await controller.downloadPdf(
      user,
      'quotation-3',
      { lang: 'ar', showSalePrice: 'false' },
      response as unknown as Response,
    );

    expect(printSettings.resolve).toHaveBeenCalledWith(
      'company-1',
      user,
      { showSalePrice: 'false', showCost: undefined },
      'sales-quotation',
    );
    expect(service.renderArtworkPdf).toHaveBeenCalledWith(
      'company-1',
      'quotation-3',
      'ar',
      { showSalePrice: false },
    );
    expect(service.printDocument).toHaveBeenCalledWith(
      'company-1',
      'quotation-3',
      'ar',
      false,
      { showSalePrice: false },
    );
  });
});
