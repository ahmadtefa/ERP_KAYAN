import type { QuotationSnapshot } from './quotation-document';

/// A copy of an offer that carries no selling price.
///
/// The print settings of a company can say "this copy shows no prices" - the
/// classic case being a quotation handed to a procurement office, or a copy
/// filed with a tender. Hiding the columns in CSS would not be enough: the
/// figures would still be in the HTML, the PDF's text layer and the clipboard,
/// which is exactly how a "hidden" price reaches the person it was hidden from.
///
/// So the copy itself is emptied, and the renderer is told to leave the price
/// columns and the totals out. The stored quotation is not touched: this
/// function never mutates its input, and the database keeps every figure.
export function redactQuotationPrices(
  content: QuotationSnapshot,
  options: { showSalePrice: boolean },
): QuotationSnapshot {
  if (options.showSalePrice) return content;

  const blank = '';

  return {
    ...content,
    hidePrices: true,
    tables: content.tables.map((table) => ({
      ...table,
      subTotal: blank,
      discountPercent: blank,
      discountAmount: blank,
      netTotal: blank,
      lines: table.lines.map((line) => ({
        ...line,
        unitPrice: blank,
        lineTotal: blank,
      })),
    })),
    totals: {
      subTotal: blank,
      discountTotal: blank,
      totalAmount: blank,
      taxRate: blank,
      taxAmount: blank,
    },
  };
}
