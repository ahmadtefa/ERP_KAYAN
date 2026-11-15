import { Prisma } from '@prisma/client';
import { QuotationsService } from './quotations.service';

// Fake transaction for fast failure-path regression only. PostgreSQL and HTTP
// concurrency still need independent integration coverage.
describe('quotation conversion transaction', () => {
  function setup(failAt?: 'event' | 'audit') {
    const d = (n: string) => new Prisma.Decimal(n);
    const quotation = {
      id: 'q1', companyId: 'co', status: 'ACCEPTED', convertedInvoiceId: null,
      customerId: 'customer', quotationNumber: 'Q1', discountType: null,
      discountPercent: d('0'), discountAmount: d('0'),
      subTotal: d('100'), discountTotal: d('0'), taxRate: d('0'), taxAmount: d('0'), totalAmount: d('100'),
      tables: [{ title: 'Goods', discountAmount: d('0'), lines: [{
        itemId: null, description: 'Service', quantity: d('1'), unitPrice: d('100'), lineTotal: d('100'),
      }] }],
    };
    const state = { status: 'ACCEPTED', convertedInvoiceId: null as string | null, invoices: [] as string[], events: [] as string[] };
    const update = async (target: typeof state, args: any) => {
      if (target.status !== args.where.status || target.convertedInvoiceId !== args.where.convertedInvoiceId) return {count:0};
      Object.assign(target, args.data); return {count:1};
    };
    const db: any = {
      quotation: {
        findFirst: jest.fn(async () => ({...quotation, status:state.status, convertedInvoiceId:state.convertedInvoiceId})),
        updateMany: jest.fn((args: any) => update(state,args)),
      },
      $transaction: jest.fn(async (work: (tx: any) => Promise<any>) => {
        const draft = structuredClone(state);
        const tx = {
          draft,
          quotation: {
            updateMany: (args: any) => update(draft,args),
            update: async ({data}: any) => {Object.assign(draft,data);},
          },
          quotationEvent: {create: async () => {
            if (failAt === 'event') throw new Error('event unavailable');
            draft.events.push('converted');
          }},
        };
        const result = await work(tx);
        Object.assign(state,draft);
        return result;
      }),
    };
    const invoices: any = {
      create: jest.fn(async () => { state.invoices.push('i1'); return {id:'i1',invoiceNumber:'SI1'}; }),
      createInTransaction: jest.fn(async (_co: any,_branch: any,_user: any,_dto: any,tx: any) => {
        tx.draft.invoices.push('i1'); return {id:'i1',invoiceNumber:'SI1',subTotal:d('100'),taxAmount:d('0'),totalAmount:d('100')};
      }),
      findOne: jest.fn(async () => ({id:'i1',invoiceNumber:'SI1'})),
    };
    const audit: any = {record:jest.fn(async () => {}), recordRequired:jest.fn(async () => {
      if (failAt === 'audit') throw new Error('audit unavailable');
    })};
    const service = new QuotationsService(db, {} as never, {} as never, invoices, audit);
    jest.spyOn(service as any, 'expireOverdue').mockResolvedValue(undefined);
    jest.spyOn(service, 'findOne').mockResolvedValue({id:'q1'} as never);
    return {service, state, invoices, audit, quotation};
  }

  it('commits the claim, invoice, link, event and required audits together', async () => {
    const {service,state,invoices,audit} = setup();
    const result = await service.convert('co','branch','user','q1');
    expect(result.invoice.id).toBe('i1');
    expect(state).toMatchObject({status:'CONVERTED',convertedInvoiceId:'i1',invoices:['i1'],events:['converted']});
    expect(invoices.createInTransaction).toHaveBeenCalledTimes(1);
    expect(invoices.create).not.toHaveBeenCalled();
    expect(invoices.createInTransaction.mock.calls[0][3].lines[0].taxRate).toBe('0.0000');
    expect(invoices.createInTransaction.mock.calls[0][6]).toEqual({ pricesExcludeTax: true });
    expect(audit.recordRequired).toHaveBeenCalledTimes(2);
    await expect(service.convert('co','branch','user','q1')).rejects.toThrow(/already been converted/);
    expect(state.invoices).toEqual(['i1']);
  });

  it('refuses and rolls back an invoice whose computed totals do not match the accepted quotation', async () => {
    const {service,state,quotation} = setup();
    quotation.taxRate = new Prisma.Decimal('14');
    quotation.taxAmount = new Prisma.Decimal('14');
    quotation.totalAmount = new Prisma.Decimal('114');
    await expect(service.convert('co','branch','user','q1')).rejects.toThrow(/totals differ/);
    expect(state).toEqual({status:'ACCEPTED',convertedInvoiceId:null,invoices:[],events:[]});
  });

  it('allows per-line tax rounding drift within the line-count tolerance', async () => {
    const {service,state,quotation,invoices} = setup();
    quotation.subTotal = new Prisma.Decimal('0.02');
    quotation.discountTotal = new Prisma.Decimal('0');
    quotation.taxRate = new Prisma.Decimal('5.5');
    quotation.taxAmount = new Prisma.Decimal('0.0011');
    quotation.totalAmount = new Prisma.Decimal('0.0211');
    quotation.tables[0].lines = [
      {itemId:null, description:'First service', quantity:new Prisma.Decimal('1'), unitPrice:new Prisma.Decimal('0.01'), lineTotal:new Prisma.Decimal('0.01')},
      {itemId:null, description:'Second service', quantity:new Prisma.Decimal('1'), unitPrice:new Prisma.Decimal('0.01'), lineTotal:new Prisma.Decimal('0.01')},
    ];
    invoices.createInTransaction.mockResolvedValueOnce({
      id:'i1', invoiceNumber:'SI1', subTotal:new Prisma.Decimal('0.02'),
      taxAmount:new Prisma.Decimal('0.0012'), totalAmount:new Prisma.Decimal('0.0212'),
    });

    await expect(service.convert('co','branch','user','q1')).resolves.toMatchObject({invoice:{id:'i1'}});
    expect(state.status).toBe('CONVERTED');
  });

  it.each(['event','audit'] as const)('rolls back the invoice and claim when %s fails', async failure => {
    const {service,state} = setup(failure);
    await expect(service.convert('co','branch','user','q1')).rejects.toThrow(`${failure} unavailable`);
    expect(state).toEqual({status:'ACCEPTED',convertedInvoiceId:null,invoices:[],events:[]});
  });
});
