import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { PdfService } from '../export/pdf.service';
import { encodeCode128B, QUIET_ZONE_MODULES } from './barcode-code128';

export type LabelPaperSize = 'A4' | 'THERMAL_80' | 'THERMAL_58';

export interface LabelSpec {
  unitId: string;
  copies: number;
}

export interface LabelOptions {
  paper: LabelPaperSize;
  showPrice: boolean;
  lang: 'ar' | 'en';
  autoPrint: boolean;
}

interface PreparedLabel {
  itemName: string;
  unitName: string;
  barcode: string;
  price: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COPIES_PER_UNIT = 500;
const MAX_LABELS_PER_JOB = 2000;

/**
 * Builds printable barcode labels for an item's units.
 *
 * One unit always carries exactly its own barcode: a carton label prints the
 * carton row's barcode and a single-piece label prints the piece row's, so a
 * scanned label can never point at the wrong pack size. The barcode is drawn
 * as Code 128 vector bars — no barcode font and no network fetch — so the page
 * prints fully offline. Only the SALE price is ever offered; purchase prices
 * and costs never reach a label.
 */
@Injectable()
export class BarcodeLabelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  /** Parses `unitId:copies` query fragments, rejecting anything malformed. */
  parseSpecs(raw: string[] | string | undefined): LabelSpec[] {
    if (!raw) throw new BadRequestException('At least one label specification (unitId:copies) is required');
    const fragments = Array.isArray(raw) ? raw : [raw];
    const specs: LabelSpec[] = [];
    const seen = new Set<string>();
    for (const fragment of fragments) {
      const [unitId, copiesRaw] = String(fragment).split(':');
      if (!unitId || !UUID_RE.test(unitId) || !/^\d{1,3}$/.test(copiesRaw ?? '')) {
        throw new BadRequestException(`Malformed label specification "${fragment}". Use unitId:copies`);
      }
      const copies = Number(copiesRaw);
      if (copies < 1 || copies > MAX_COPIES_PER_UNIT) {
        throw new BadRequestException(`Copies must be between 1 and ${MAX_COPIES_PER_UNIT}`);
      }
      if (seen.has(unitId)) {
        throw new BadRequestException('Each unit may appear only once in a label job');
      }
      seen.add(unitId);
      specs.push({ unitId, copies });
    }
    const total = specs.reduce((sum, spec) => sum + spec.copies, 0);
    if (total > MAX_LABELS_PER_JOB) {
      throw new BadRequestException(`A label job cannot exceed ${MAX_LABELS_PER_JOB} labels`);
    }
    return specs;
  }

  parsePaper(value: string | undefined): LabelPaperSize {
    if (value === 'THERMAL_80' || value === 'THERMAL_58') return value;
    return 'A4';
  }

  async buildHtml(
    companyId: string,
    itemId: string,
    specs: LabelSpec[],
    options: LabelOptions,
  ): Promise<string> {
    const item = await this.loadItem(companyId, itemId);
    const labels = this.prepareLabels(item, specs, options);
    return this.renderPage(item, labels, options);
  }

  async renderPdf(
    companyId: string,
    itemId: string,
    specs: LabelSpec[],
    options: LabelOptions,
  ): Promise<Buffer> {
    const html = await this.buildHtml(companyId, itemId, specs, options);
    return this.pdf.render(html);
  }

  private async loadItem(companyId: string, itemId: string) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, companyId, deletedAt: null },
      include: { units: true },
    });
    if (!item) throw new BadRequestException('The item does not exist');
    return item;
  }

  private prepareLabels(
    item: {
      nameAr: string;
      nameEn: string;
      salePrice: { toFixed(fractionDigits?: number): string };
      units: Array<{
        id: string;
        unit: string;
        barcode: string | null;
        salePrice: { toFixed(fractionDigits?: number): string } | null;
        isActive: boolean;
      }>;
    },
    specs: LabelSpec[],
    options: LabelOptions,
  ): PreparedLabel[] {
    const labels: PreparedLabel[] = [];
    for (const spec of specs) {
      const unit = item.units.find((candidate) => candidate.id === spec.unitId);
      if (!unit) {
        throw new BadRequestException('One of the chosen units does not belong to this item');
      }
      if (!unit.barcode || unit.barcode.trim() === '') {
        throw new BadRequestException(
          `Unit "${unit.unit}" has no barcode. Assign one before printing labels.`,
        );
      }
      const price = options.showPrice
        ? (unit.salePrice ?? item.salePrice).toFixed(2)
        : null;
      const label: PreparedLabel = {
        itemName: options.lang === 'ar' ? item.nameAr || item.nameEn : item.nameEn || item.nameAr,
        unitName: unit.unit,
        barcode: unit.barcode.trim(),
        price,
      };
      for (let i = 0; i < spec.copies; i += 1) labels.push({ ...label });
    }
    return labels;
  }

  private renderPage(
    item: { code: string; nameAr: string; nameEn: string },
    labels: PreparedLabel[],
    options: LabelOptions,
  ): string {
    const cards = labels.map((label) => this.renderCard(label, options)).join('\n');
    const sizeCss =
      options.paper === 'A4'
        ? '@page { size: A4; margin: 8mm; } body { margin: 0; } .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }'
        : options.paper === 'THERMAL_80'
          ? '@page { size: 80mm auto; margin: 0; } body { margin: 0; width: 80mm; } .sheet { display: flex; flex-direction: column; gap: 4mm; padding: 4mm; }'
          : '@page { size: 58mm auto; margin: 0; } body { margin: 0; width: 58mm; } .sheet { display: flex; flex-direction: column; gap: 3mm; padding: 3mm; }';
    const title = escapeHtml(options.lang === 'ar' ? `ملصقات: ${item.nameAr}` : `Labels: ${item.nameEn}`);
    return `<!doctype html>
<html lang="${options.lang}" dir="${options.lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  ${sizeCss}
  * { box-sizing: border-box; }
  .card { border: 1px solid #000; border-radius: 2mm; padding: 3mm; text-align: center;
          font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #000; background: #fff;
          page-break-inside: avoid; }
  .item-name { font-size: 11pt; font-weight: 700; margin-bottom: 1mm; }
  .unit-name { font-size: 9pt; margin-bottom: 1.5mm; }
  .barcode { width: 100%; height: 18mm; }
  .barcode text { font-family: 'Consolas', monospace; }
  .barcode-text { font-size: 10pt; letter-spacing: 0.5mm; margin-top: 1mm; }
  .price { font-size: 11pt; font-weight: 700; margin-top: 1.5mm; }
  @media print { .card { border-color: #000; } }
</style>
${options.autoPrint ? '<script>window.addEventListener("load",()=>{setTimeout(()=>window.print(),300);});</script>' : ''}
</head>
<body>
<div class="sheet">
${cards}
</div>
</body>
</html>`;
  }

  private renderCard(label: PreparedLabel, options: LabelOptions): string {
    const encoded = encodeCode128B(label.barcode);
    const moduleWidth = 1; // user units in the SVG viewBox; the browser scales it.
    const quiet = QUIET_ZONE_MODULES * moduleWidth;
    let cursor = quiet;
    const rects = encoded.modules
      .map((mod) => {
        const width = mod.width * moduleWidth;
        const rect = mod.bar
          ? `<rect x="${cursor}" y="0" width="${width}" height="60" fill="#000"/>`
          : '';
        cursor += width;
        return rect;
      })
      .filter(Boolean)
      .join('');
    const totalWidth = cursor + quiet;
    const priceLine = label.price
      ? `<div class="price">${options.lang === 'ar' ? 'السعر' : 'Price'}: ${escapeHtml(label.price)}</div>`
      : '';
    return `<div class="card">
  <div class="item-name">${escapeHtml(label.itemName)}</div>
  <div class="unit-name">${escapeHtml(label.unitName)}</div>
  <svg class="barcode" viewBox="0 0 ${totalWidth} 74" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(label.barcode)}">
    ${rects}
    <text x="${totalWidth / 2}" y="72" text-anchor="middle" font-size="10" fill="#000">${escapeHtml(label.barcode)}</text>
  </svg>
  <div class="barcode-text">${escapeHtml(label.barcode)}</div>
  ${priceLine}
</div>`;
  }
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
