import { BadRequestException } from '@nestjs/common';

import oracle from './test-fixtures/code128-oracle.json';
import {
  CODE128_PATTERNS,
  CODE128_STOP_PATTERN,
  encodeCode128B,
} from './barcode-code128';
import { BarcodeLabelsService } from './barcode-labels.service';

/// ───────────────────────────────────────────── Code 128 encoder (pure)

describe('Code 128 set B encoder', () => {
  it('pins the full symbol table against the independent python-barcode oracle', () => {
    expect(CODE128_PATTERNS).toHaveLength(oracle.codes.length);
    CODE128_PATTERNS.forEach((pattern, index) => {
      expect(pattern).toBe(oracle.codes[index]);
    });
    expect(CODE128_STOP_PATTERN).toBe(oracle.stopPattern);
  });

  it.each(oracle.vectors)('encodes "$input" with the oracle symbol stream, checksum and bars', (vector) => {
    const encoded = encodeCode128B(vector.input);
    expect(encoded.symbols).toEqual(vector.symbols);
    expect(encoded.checksum).toBe(vector.checksum);
    expect(encoded.widthPattern).toBe(vector.modulePattern);
    expect(encoded.widthPattern).toHaveLength(vector.moduleCount);
  });

  it('emits alternating bar/space runs that start and end on a bar', () => {
    const { modules } = encodeCode128B('62210010');
    expect(modules[0].bar).toBe(true);
    expect(modules.at(-1)!.bar).toBe(true);
    for (let i = 1; i < modules.length; i += 1) {
      expect(modules[i].bar).toBe(!modules[i - 1].bar);
      expect(modules[i].width).toBeGreaterThanOrEqual(1);
    }
  });

  it('rejects empty, overlong and non-Latin input', () => {
    expect(() => encodeCode128B('')).toThrow(BadRequestException);
    expect(() => encodeCode128B('x'.repeat(81))).toThrow(BadRequestException);
    expect(() => encodeCode128B('لبن')).toThrow(BadRequestException);
  });
});

/// ───────────────────────────────────────────── label job parsing

describe('BarcodeLabelsService spec parsing', () => {
  const service = new BarcodeLabelsService({} as never, {} as never);
  const uuid = '11111111-1111-4111-8111-111111111111';

  it('accepts repeated unitId:copies fragments', () => {
    expect(service.parseSpecs([`${uuid}:3`, `${uuid.replace(/1/g, '2')}:10`])).toEqual([
      { unitId: uuid, copies: 3 },
      { unitId: uuid.replace(/1/g, '2'), copies: 10 },
    ]);
  });

  it.each([
    ['missing', undefined],
    ['malformed fragment', ['not-a-spec']],
    ['bad uuid', [`not-a-uuid:2`]],
    ['zero copies', [`${uuid}:0`]],
    ['copies over bound', [`${uuid}:501`]],
  ])('rejects %s', (_label, raw) => {
    expect(() => service.parseSpecs(raw as never)).toThrow(BadRequestException);
  });

  it('rejects a repeated unit and an over-cap job', () => {
    expect(() => service.parseSpecs([`${uuid}:1`, `${uuid}:2`])).toThrow(BadRequestException);
    expect(() => service.parseSpecs([`${uuid}:2001`])).toThrow(BadRequestException);
  });

  it('defaults paper to A4 and keeps the thermal sizes', () => {
    expect(service.parsePaper(undefined)).toBe('A4');
    expect(service.parsePaper('THERMAL_80')).toBe('THERMAL_80');
    expect(service.parsePaper('THERMAL_58')).toBe('THERMAL_58');
    expect(service.parsePaper('EVIL')).toBe('A4');
  });
});

/// ───────────────────────────────────────────── rendered label sheets

const D = (v: string) => ({ toFixed: (digits = 2) => Number(v).toFixed(digits) });

function makeItem() {
  return {
    id: 'item-1',
    code: 'MILK',
    nameAr: 'لبن',
    nameEn: 'Milk',
    salePrice: D('10'),
    units: [
      { id: 'unit-piece', unit: 'علبة', barcode: '62210001', salePrice: D('10'), purchasePrice: D('7'), isActive: true },
      { id: 'unit-carton', unit: 'كرتونة', barcode: '62210010', salePrice: D('97'), purchasePrice: D('55.55'), isActive: true },
      { id: 'unit-nobarcode', unit: 'صندوق', barcode: null, salePrice: null, purchasePrice: null, isActive: true },
    ],
  };
}

function makeService(item: ReturnType<typeof makeItem> | null) {
  const prisma = { item: { findFirst: jest.fn(async () => item) } };
  const pdf = { render: jest.fn(async (html: string) => Buffer.from(html)) };
  const service = new BarcodeLabelsService(prisma as never, pdf as never);
  return { service, prisma, pdf };
}

const baseOptions = { paper: 'A4' as const, showPrice: true, lang: 'ar' as const, autoPrint: false };

describe('BarcodeLabelsService HTML rendering', () => {
  it('prints each unit only its own barcode, one card per copy', async () => {
    const item = makeItem();
    const { service } = makeService(item);
    const html = await service.buildHtml('company-1', 'item-1', [
      { unitId: 'unit-piece', copies: 2 },
      { unitId: 'unit-carton', copies: 1 },
    ], baseOptions);

    expect(html).toContain('<svg');
    expect(html).toContain('<rect');
    // Exactly one physical card per requested copy.
    const cards = html.split('<div class="card">').slice(1);
    expect(cards).toHaveLength(3);
    const pieceCards = cards.filter((card) => card.includes('62210001'));
    const cartonCards = cards.filter((card) => card.includes('62210010'));
    expect(pieceCards).toHaveLength(2);
    expect(cartonCards).toHaveLength(1);
    // A carton label must never carry the piece barcode and vice versa.
    expect(pieceCards.every((card) => !card.includes('62210010'))).toBe(true);
    expect(cartonCards.every((card) => !card.includes('62210001'))).toBe(true);
  });

  it('shows the independent unit sale price, never the purchase price', async () => {
    const item = makeItem();
    const { service } = makeService(item);
    const html = await service.buildHtml('company-1', 'item-1', [
      { unitId: 'unit-carton', copies: 1 },
    ], baseOptions);
    expect(html).toContain('97.00');
    expect(html).not.toContain('55.55');
    expect(html).not.toContain('purchasePrice');
  });

  it('hides the price entirely when asked, and falls back to the item price', async () => {
    const item = makeItem();
    const { service } = makeService(item);
    const hidden = await service.buildHtml('company-1', 'item-1', [
      { unitId: 'unit-carton', copies: 1 },
    ], { ...baseOptions, showPrice: false });
    expect(hidden).not.toContain('class="price"');

    const fallback = await service.buildHtml('company-1', 'item-1', [
      { unitId: 'unit-piece', copies: 1 },
    ], { ...baseOptions, showPrice: true });
    expect(fallback).toContain('10.00');
  });

  it('refuses a unit without a barcode and a unit from another item', async () => {
    const item = makeItem();
    const { service } = makeService(item);
    await expect(service.buildHtml('company-1', 'item-1', [
      { unitId: 'unit-nobarcode', copies: 1 },
    ], baseOptions)).rejects.toThrow('has no barcode');
    await expect(service.buildHtml('company-1', 'item-1', [
      { unitId: 'unit-foreign', copies: 1 },
    ], baseOptions)).rejects.toThrow('does not belong to this item');
  });

  it('errors when the item does not exist', async () => {
    const { service } = makeService(null);
    await expect(service.buildHtml('company-1', 'gone', [
      { unitId: 'unit-piece', copies: 1 },
    ], baseOptions)).rejects.toThrow('The item does not exist');
  });

  it('escapes HTML in names and switches paper CSS per size', async () => {
    const item = makeItem();
    item.nameAr = '<script>alert(1)</script>لبن';
    const { service } = makeService(item);
    const html = await service.buildHtml('company-1', 'item-1', [
      { unitId: 'unit-piece', copies: 1 },
    ], baseOptions);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');

    const thermal = await service.buildHtml('company-1', 'item-1', [
      { unitId: 'unit-piece', copies: 1 },
    ], { ...baseOptions, paper: 'THERMAL_80' });
    expect(thermal).toContain('80mm');
    const narrow = await service.buildHtml('company-1', 'item-1', [
      { unitId: 'unit-piece', copies: 1 },
    ], { ...baseOptions, paper: 'THERMAL_58' });
    expect(narrow).toContain('58mm');
  });

  it('renders Arabic RTL for ar and English LTR for en', async () => {
    const item = makeItem();
    const { service } = makeService(item);
    const ar = await service.buildHtml('company-1', 'item-1', [
      { unitId: 'unit-piece', copies: 1 },
    ], baseOptions);
    expect(ar).toContain('dir="rtl"');
    expect(ar).toContain('لبن');
    const en = await service.buildHtml('company-1', 'item-1', [
      { unitId: 'unit-piece', copies: 1 },
    ], { ...baseOptions, lang: 'en' });
    expect(en).toContain('dir="ltr"');
    expect(en).toContain('Milk');
  });

  it('renderPdf hands the built HTML to the browser PDF pipeline', async () => {
    const item = makeItem();
    const { service, pdf } = makeService(item);
    const buffer = await service.renderPdf('company-1', 'item-1', [
      { unitId: 'unit-piece', copies: 1 },
    ], baseOptions);
    expect(pdf.render).toHaveBeenCalledTimes(1);
    const html = String(pdf.render.mock.calls[0][0]);
    expect(html).toContain('62210001');
    expect(buffer.toString()).toContain('62210001');
  });
});
