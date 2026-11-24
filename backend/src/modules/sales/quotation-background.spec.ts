import { PDFDocument } from 'pdf-lib';

import { underlayBackground } from '../export/pdf.service';
import { renderQuotationDocument } from './quotation-document';
import { extractBackgroundPage } from './quotation-backgrounds.service';

async function pdf(pages: number): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([595, 842]).drawText('x');
  return Buffer.from(await d.save());
}

async function blankPdf(): Promise<Buffer> {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  return Buffer.from(await d.save());
}

describe('quotation background and header/footer switches', () => {
  it('keeps one page of an uploaded PDF and rejects non-PDF bytes', async () => {
    const one = await extractBackgroundPage(await pdf(3), 2);
    expect((await PDFDocument.load(one)).getPageCount()).toBe(1);
    await expect(extractBackgroundPage(Buffer.from('hello'))).rejects.toThrow('not a PDF');
    await expect(extractBackgroundPage(await pdf(1), 4)).rejects.toThrow('does not exist');
  });

  it('lays the background under every content page', async () => {
    const out = await underlayBackground(await pdf(3), await extractBackgroundPage(await blankPdf()));
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });
});
