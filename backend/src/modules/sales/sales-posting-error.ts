import { BadRequestException } from '@nestjs/common';

/** Give sales-posting business refusals stable, bounded categories. Never
 * package arbitrary exception text, company names or database diagnostics.
 * Only 400s are classified; authentication, credit, concurrency and 5xx
 * errors keep their original status and handling. */
export function salesPostingError(error: unknown, mayReadAccounts = false): unknown {
  if (!(error instanceof BadRequestException)) return error;
  const body = error.getResponse();
  if (typeof body !== 'string' && typeof body === 'object' && body !== null && 'code' in body) return error;
  const message = typeof body === 'string' ? body : (body as { message?: unknown }).message;
  const text = typeof message === 'string' ? message : '';
  const rules: Array<[RegExp, string, string]> = [
    [/^Not enough stock for [\s\S]+ available, [\s\S]+ requested\. Record a purchase invoice first\.$/, 'SALES_POST_BRANCH_STOCK', 'Review available stock in the invoice branch and record the actual receipt before posting.'],
    [/Not enough stock in the available lots: \d+(?:\.\d+)? short\./, 'SALES_POST_LOT_STOCK', 'Review the available lots and expiry dates in the invoice warehouse.'],
    [/Not enough stock in (?:the selected|this) warehouse[.:]/, 'SALES_POST_WAREHOUSE_STOCK', 'Review stock in the selected warehouse.'],
    [/^Required account \S+ \(\w+\) does not exist in this company's chart of accounts$/, 'SALES_POST_ACCOUNT_MISSING', 'Ask accounting to review the required accounts in the company chart.'],
    [/^(?:Account \S+ (?:cannot receive postings|is inactive)|Accounts cannot receive postings:|One or more accounts do not exist)/, 'SALES_POST_ACCOUNT_UNAVAILABLE', 'Ask accounting to review the active posting accounts.'],
    [/^Period [\s\S]+ is closed, so nothing can be posted on \d{4}-\d{2}-\d{2}$/, 'SALES_POST_PERIOD_CLOSED', 'Ask accounting to review the invoice date and the closed fiscal period.'],
    [/lot-controlled[\s\S]+branch has no warehouse/, 'SALES_POST_WAREHOUSE_REQUIRED', 'Set up the appropriate warehouse for this branch before posting lot-controlled goods.'],
    [/This item is lot-controlled: no lot is available to issue from\.$/, 'SALES_POST_LOT_STOCK', 'Review the available lots in the invoice warehouse.'],
    [/^An invoice line references a missing item$/, 'SALES_POST_ITEM_UNAVAILABLE', 'Review the invoice items. An item is no longer available.'],
    [/^The document does not balance, so it was not posted$/, 'SALES_POST_UNBALANCED', 'Ask accounting to review the invoice totals and account setup.'],
    [/^(?:Only draft invoices can be posted|This invoice was posted by someone else)/, 'SALES_POST_STATE_CHANGED', 'Refresh the invoice list and check the current status.'],
  ];
  const match = rules.find(([pattern]) => pattern.test(text));
  const code = match?.[1] ?? 'SALES_POST_RULE_REJECTED';
  const messageSafe = match?.[2] ?? 'Posting was refused by a business rule. Keep the invoice and report this support code.';
  const account = mayReadAccounts ? /^Required account (\d{1,12}) \((accountsReceivable|salesRevenue|vatPayable|inventory|costOfGoodsSold)\)/.exec(text) : null;
  return new BadRequestException({ code, message: messageSafe,
    ...(account ? { errors: { accountCode: account[1], accountKey: account[2] } } : {}),
  });
}
