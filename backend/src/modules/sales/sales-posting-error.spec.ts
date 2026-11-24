import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { salesPostingError } from './sales-posting-error';

describe('safe sales posting errors', () => {
  it.each([
    ['Not enough stock for IT-SYN Synthetic: 0.0000 available, 2.0000 requested. Record a purchase invoice first.', 'SALES_POST_BRANCH_STOCK'],
    ['Not enough stock in the available lots: 2.0000 short.', 'SALES_POST_LOT_STOCK'],
    ['Synthetic / Not enough stock in this warehouse.', 'SALES_POST_WAREHOUSE_STOCK'],
    ["Required account 1103 (accountsReceivable) does not exist in this company's chart of accounts", 'SALES_POST_ACCOUNT_MISSING'],
    ['Account 1103 is inactive', 'SALES_POST_ACCOUNT_UNAVAILABLE'],
    ['Period Synthetic is closed, so nothing can be posted on 2026-11-07', 'SALES_POST_PERIOD_CLOSED'],
    ['Item Synthetic is lot-controlled, and this branch has no warehouse to issue it from.', 'SALES_POST_WAREHOUSE_REQUIRED'],
    ['This item is lot-controlled: no lot is available to issue from.', 'SALES_POST_LOT_STOCK'],
    ['An invoice line references a missing item', 'SALES_POST_ITEM_UNAVAILABLE'],
    ['The document does not balance, so it was not posted', 'SALES_POST_UNBALANCED'],
    ['Only draft invoices can be posted (current status: POSTED)', 'SALES_POST_STATE_CHANGED'],
    ['Synthetic arbitrary business detail SQL password=private', 'SALES_POST_RULE_REJECTED'],
  ])('bounds %s to %s', (message, code) => {
    const error = salesPostingError(new BadRequestException(message)) as BadRequestException;
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual(expect.objectContaining({ code }));
    expect(JSON.stringify(error.getResponse())).not.toMatch(/Synthetic|password|1103|2026-11-07/);
  });
  it('keeps structured codes and non-400s unchanged, including credit and technical failures', () => {
    for (const error of [new BadRequestException({code:'VALIDATION_FAILED',errors:{field:'required'}}),
      new ConflictException({code:'CUSTOMER_CREDIT_LIMIT_EXCEEDED'}), new ForbiddenException('private'),
      new InternalServerErrorException('private'), new Error('private')]) expect(salesPostingError(error)).toBe(error);
  });
});
